import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import type { ParsedP12 } from "./p12";
import { gost, OID_GOST_DIGEST, OID_GOST_SIGNATURE } from "./crypto/gost";
import { rsaSign, rsaVerify, OID_SHA256, OID_SHA256_RSA } from "./crypto/rsa";

const OID_DATA = "1.2.840.113549.1.7.1";
const OID_SIGNED_DATA = "1.2.840.113549.1.7.2";
const OID_CONTENT_TYPE = "1.2.840.113549.1.9.3";
const OID_MESSAGE_DIGEST = "1.2.840.113549.1.9.4";
const OID_SIGNING_TIME = "1.2.840.113549.1.9.5";
const OID_SIGNING_CERT_V2 = "1.2.840.113549.1.9.16.2.47";

export interface SignOptions {
  detached: boolean;
  signingTime?: Date;
}

const sha256 = async (b: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(b)));
const isGost = (k: ParsedP12) => k.algorithm === "GOST2015_512";
const digestFor = async (gostKey: boolean, b: Uint8Array) => (gostKey ? gost.digest(b) : sha256(b));
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

const attr = (type: string, value: asn1js.AsnType) => new pkijs.Attribute({ type, values: [value] });

function signingCertificateV2(digestOid: string, certHash: Uint8Array, cert: pkijs.Certificate) {
  const issuerSerial = new asn1js.Sequence({
    value: [
      new asn1js.Sequence({ value: [new asn1js.Constructed({ idBlock: { tagClass: 3, tagNumber: 4 }, value: [cert.issuer.toSchema()] })] }),
      cert.serialNumber,
    ],
  });
  const essCertIdV2 = new asn1js.Sequence({
    value: [new pkijs.AlgorithmIdentifier({ algorithmId: digestOid }).toSchema(), new asn1js.OctetString({ valueHex: certHash }), issuerSerial],
  });
  return new asn1js.Sequence({ value: [new asn1js.Sequence({ value: [essCertIdV2] })] });
}

// Подписывается DER signedAttrs с тегом SET (0x31), а не [0] (RFC 5652 §5.4)
function signedAttrsDer(si: pkijs.SignerInfo): Uint8Array {
  const der = new Uint8Array(si.signedAttrs!.toSchema().toBER(false));
  der[0] = 0x31;
  return der;
}

export async function signCms(data: Uint8Array, key: ParsedP12, opts: SignOptions): Promise<Uint8Array> {
  const cert = new pkijs.Certificate({ schema: asn1js.fromBER(key.certificateDer).result });
  const gostKey = isGost(key);
  const digestOid = gostKey ? OID_GOST_DIGEST : OID_SHA256;

  const signerInfo = new pkijs.SignerInfo({
    version: 1,
    sid: new pkijs.IssuerAndSerialNumber({ issuer: cert.issuer, serialNumber: cert.serialNumber }),
    digestAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: digestOid }),
    signatureAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: gostKey ? OID_GOST_SIGNATURE : OID_SHA256_RSA }),
    signedAttrs: new pkijs.SignedAndUnsignedAttributes({
      type: 0,
      attributes: [
        attr(OID_CONTENT_TYPE, new asn1js.ObjectIdentifier({ value: OID_DATA })),
        attr(OID_SIGNING_TIME, new asn1js.UTCTime({ valueDate: opts.signingTime ?? new Date() })),
        attr(OID_MESSAGE_DIGEST, new asn1js.OctetString({ valueHex: await digestFor(gostKey, data) })),
        attr(OID_SIGNING_CERT_V2, signingCertificateV2(OID_SHA256, await sha256(key.certificateDer), cert)),
      ],
    }),
  });

  const toSign = signedAttrsDer(signerInfo);
  const signature = gostKey ? gost.sign(gost.digest(toSign), key.privateKeyPkcs8) : await rsaSign(toSign, key.privateKeyPkcs8);
  signerInfo.signature = new asn1js.OctetString({ valueHex: signature });

  const signedData = new pkijs.SignedData({
    version: 1,
    digestAlgorithms: [new pkijs.AlgorithmIdentifier({ algorithmId: digestOid })],
    encapContentInfo: new pkijs.EncapsulatedContentInfo({
      eContentType: OID_DATA,
      ...(opts.detached ? {} : { eContent: new asn1js.OctetString({ valueHex: data }) }),
    }),
    certificates: [cert],
    signerInfos: [signerInfo],
  });

  const ci = new pkijs.ContentInfo({ contentType: OID_SIGNED_DATA, content: signedData.toSchema(true) });
  return new Uint8Array(ci.toSchema().toBER(false));
}

export async function verifyCms(cms: Uint8Array, detachedData?: Uint8Array): Promise<{ valid: boolean; signerCertDer: Uint8Array }> {
  const ci = new pkijs.ContentInfo({ schema: asn1js.fromBER(cms).result });
  const sd = new pkijs.SignedData({ schema: ci.content });
  const si = sd.signerInfos[0]!;
  const cert = sd.certificates![0] as pkijs.Certificate;
  const signerCertDer = new Uint8Array(cert.toSchema().toBER(false));
  const gostKey = si.signatureAlgorithm.algorithmId === OID_GOST_SIGNATURE;

  const eContent = sd.encapContentInfo.eContent;
  const content = detachedData ?? (eContent ? new Uint8Array(eContent.getValue()) : new Uint8Array());
  const md = si.signedAttrs!.attributes.find((a) => a.type === OID_MESSAGE_DIGEST)!.values[0] as asn1js.OctetString;
  if (!equal(new Uint8Array(md.valueBlock.valueHexView), await digestFor(gostKey, content))) return { valid: false, signerCertDer };

  const toVerify = new Uint8Array(si.signedAttrs!.encodedValue);
  toVerify[0] = 0x31;
  const sig = new Uint8Array(si.signature.valueBlock.valueHexView);
  const valid = gostKey
    ? gost.verify(gost.digest(toVerify), sig, gost.publicKeyFromCert(signerCertDer))
    : await rsaVerify(toVerify, sig, signerCertDer);
  return { valid, signerCertDer };
}
