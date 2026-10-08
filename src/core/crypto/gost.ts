import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { ID_GOSTR3410_2012_512_PARAM_SET_A as CURVE, sign as curveSign, verify as curveVerify } from "@li0ard/gostcurves";
import { streebog512 } from "@li0ard/streebog";

// Параметры и порядок байтов НУЦ подтверждены на подписи тестового УЦ: docs/decisions/0001-gost-engine.md
export const OID_GOST_DIGEST = "1.2.398.3.10.1.3.3";
export const OID_GOST_SIGNATURE = "1.2.398.3.10.1.1.2.3.2";

export interface GostEngine {
  /** Стрибог-512 в обычном порядке байтов, как в CMS messageDigest; sign/verify сами разворачивают его в число little-endian */
  digest(data: Uint8Array): Uint8Array;
  sign(digest: Uint8Array, pkcs8: Uint8Array): Uint8Array;
  verify(digest: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean;
  publicKeyFromCert(certDer: Uint8Array): Uint8Array;
}

const reverse = (b: Uint8Array) => Uint8Array.from(b).reverse();
const reverseHalves = (b: Uint8Array) => {
  const h = b.length / 2;
  return Uint8Array.from([...reverse(b.subarray(0, h)), ...reverse(b.subarray(h))]);
};

function privateScalar(pkcs8: Uint8Array): Uint8Array {
  const info = new pkijs.PrivateKeyInfo({ schema: asn1js.fromBER(pkcs8).result });
  const inner = asn1js.fromBER(info.privateKey.valueBlock.valueHexView).result as asn1js.OctetString;
  return new Uint8Array(inner.valueBlock.valueHexView);
}

export const gost: GostEngine = {
  digest: (data) => streebog512(data),

  sign(digest, pkcs8) {
    const scalar = reverse(privateScalar(pkcs8));
    try {
      return reverseHalves(curveSign(CURVE, scalar, reverse(digest)));
    } finally {
      scalar.fill(0);
    }
  },

  verify(digest, signature, publicKey) {
    try {
      return curveVerify(CURVE, Uint8Array.from([4, ...reverseHalves(publicKey)]), reverse(digest), reverseHalves(signature));
    } catch {
      return false;
    }
  },

  publicKeyFromCert(certDer) {
    const cert = new pkijs.Certificate({ schema: asn1js.fromBER(certDer).result });
    const bits = cert.subjectPublicKeyInfo.subjectPublicKey.valueBlock.valueHexView;
    return new Uint8Array((asn1js.fromBER(bits).result as asn1js.OctetString).valueBlock.valueHexView);
  },
};
