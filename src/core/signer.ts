import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import type { ParsedP12 } from "./p12";
import { KzSignError } from "./errors";
import type { TspClient } from "./tsp";
import { gost, OID_GOST_DIGEST, OID_GOST_SIGNATURE } from "./crypto/gost";
import { rsaSign, rsaVerify, OID_SHA256, OID_SHA256_RSA } from "./crypto/rsa";

const OID_DATA = "1.2.840.113549.1.7.1";
const OID_SIGNED_DATA = "1.2.840.113549.1.7.2";
const OID_CONTENT_TYPE = "1.2.840.113549.1.9.3";
const OID_MESSAGE_DIGEST = "1.2.840.113549.1.9.4";
const OID_SIGNING_TIME = "1.2.840.113549.1.9.5";
const OID_SIGNING_CERT_V2 = "1.2.840.113549.1.9.16.2.47";
const OID_SIGNATURE_TIMESTAMP = "1.2.840.113549.1.9.16.2.14";

export interface SignOptions {
  detached: boolean;
  signingTime?: Date;
  /** CAdES-T: метка времени над значением подписи; ошибка TSA — ошибка подписи */
  tsp?: TspClient;
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
  if (opts.tsp) {
    const token = await opts.tsp(await digestFor(gostKey, signature), gostKey);
    signerInfo.unsignedAttrs = new pkijs.SignedAndUnsignedAttributes({
      type: 1,
      attributes: [attr(OID_SIGNATURE_TIMESTAMP, asn1js.fromBER(token).result)],
    });
  }

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

  if (!opts.detached && data.length) signedData.encapContentInfo.eContent = new asn1js.OctetString({ valueHex: data });

  const ci = new pkijs.ContentInfo({ contentType: OID_SIGNED_DATA, content: signedData.toSchema(true) });
  return new Uint8Array(ci.toSchema().toBER(false));
}

const OID_RSA_ENCRYPTION = "1.2.840.113549.1.1.1";

type Engine = "GOST" | "RSA";
const ENGINES: Record<string, Engine> = {
  [`${OID_GOST_DIGEST}|${OID_GOST_SIGNATURE}`]: "GOST",
  [`${OID_SHA256}|${OID_SHA256_RSA}`]: "RSA",
  [`${OID_SHA256}|${OID_RSA_ENCRYPTION}`]: "RSA",
};

function malformed(why: string): never {
  throw new KzSignError("MALFORMED_CMS", why);
}

function parseBer(der: Uint8Array) {
  const r = asn1js.fromBER(der);
  if (r.offset === -1) malformed("не ASN.1");
  return r.result;
}

function signerCertificate(sd: pkijs.SignedData, si: pkijs.SignerInfo): pkijs.Certificate {
  if (!(si.sid instanceof pkijs.IssuerAndSerialNumber)) malformed("поддерживается только sid IssuerAndSerialNumber");
  const sid = si.sid;
  const cert = (sd.certificates ?? []).find(
    (c): c is pkijs.Certificate => c instanceof pkijs.Certificate && c.issuer.isEqual(sid.issuer) && c.serialNumber.isEqual(sid.serialNumber),
  );
  return cert ?? malformed("в CMS нет сертификата подписанта");
}

function attribute(si: pkijs.SignerInfo, type: string): asn1js.AsnType | undefined {
  return si.signedAttrs?.attributes.find((a) => a.type === type)?.values[0];
}

// ESSCertIDv2 → hash; сверяем, что подписан именно этот сертификат
async function essCertMatches(si: pkijs.SignerInfo, certDer: Uint8Array): Promise<boolean> {
  const ess = attribute(si, OID_SIGNING_CERT_V2) as asn1js.Sequence | undefined;
  if (!ess) return true;
  const certId = ((ess.valueBlock.value[0] as asn1js.Sequence).valueBlock.value[0] as asn1js.Sequence).valueBlock.value;
  const first = certId[0];
  // hashAlgorithm в ESSCertIDv2 необязателен (DEFAULT sha256, RFC 5035)
  const [algOid, hash] =
    first instanceof asn1js.OctetString
      ? [OID_SHA256, first]
      : [((first as asn1js.Sequence).valueBlock.value[0] as asn1js.ObjectIdentifier).valueBlock.toString(), certId[1] as asn1js.OctetString];
  if (algOid !== OID_SHA256) return false;
  return equal(new Uint8Array(hash.valueBlock.valueHexView), await sha256(certDer));
}

export async function verifyCms(cms: Uint8Array, detachedData?: Uint8Array): Promise<{ valid: boolean; signerCertDer: Uint8Array }> {
  try {
    const ci = new pkijs.ContentInfo({ schema: parseBer(cms) });
    if (ci.contentType !== OID_SIGNED_DATA) malformed("не SignedData");
    const sd = new pkijs.SignedData({ schema: ci.content });
    if (sd.signerInfos.length !== 1) malformed("ожидается ровно один подписант");
    const si = sd.signerInfos[0]!;
    if (!si.signedAttrs) malformed("нет signedAttrs");

    const engine = ENGINES[`${si.digestAlgorithm.algorithmId}|${si.signatureAlgorithm.algorithmId}`];
    if (!engine) throw new KzSignError("UNSUPPORTED_ALGORITHM", `${si.digestAlgorithm.algorithmId} / ${si.signatureAlgorithm.algorithmId}`);
    const gostKey = engine === "GOST";

    const cert = signerCertificate(sd, si);
    const signerCertDer = new Uint8Array(cert.toSchema().toBER(false));

    const eContent = sd.encapContentInfo.eContent;
    if (detachedData && eContent) malformed("данные переданы и внутри CMS, и отдельно");
    const content = detachedData ?? (eContent ? new Uint8Array(eContent.getValue()) : malformed("detached-подпись без данных"));

    const md = attribute(si, OID_MESSAGE_DIGEST);
    if (!(md instanceof asn1js.OctetString)) malformed("нет messageDigest");
    if (!equal(new Uint8Array(md.valueBlock.valueHexView), await digestFor(gostKey, content))) return { valid: false, signerCertDer };
    if (!(await essCertMatches(si, signerCertDer))) return { valid: false, signerCertDer };

    const toVerify = new Uint8Array(si.signedAttrs.encodedValue);
    toVerify[0] = 0x31;
    const sig = new Uint8Array(si.signature.valueBlock.valueHexView);
    const valid = gostKey
      ? gost.verify(gost.digest(toVerify), sig, gost.publicKeyFromCert(signerCertDer))
      : await rsaVerify(toVerify, sig, signerCertDer);
    return { valid, signerCertDer };
  } catch (e) {
    if (e instanceof KzSignError) throw e;
    throw new KzSignError("MALFORMED_CMS", "не удалось разобрать CMS");
  }
}
