import * as asn1js from "asn1js";
import * as pkijs from "pkijs";

export const OID_SHA256 = "2.16.840.1.101.3.4.2.1";
export const OID_SHA256_RSA = "1.2.840.113549.1.1.11";

// WebCrypto в TS 5.7+ не принимает Uint8Array<ArrayBufferLike>
const buf = (b: Uint8Array) => new Uint8Array(b) as Uint8Array<ArrayBuffer>;

const ALG = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

export async function rsaSign(data: Uint8Array, pkcs8: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("pkcs8", buf(pkcs8), ALG, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign(ALG, key, buf(data)));
}

export async function rsaVerify(data: Uint8Array, signature: Uint8Array, certDer: Uint8Array): Promise<boolean> {
  const cert = new pkijs.Certificate({ schema: asn1js.fromBER(certDer).result });
  const spki = cert.subjectPublicKeyInfo.toSchema().toBER(false);
  const key = await crypto.subtle.importKey("spki", spki, ALG, false, ["verify"]);
  return crypto.subtle.verify(ALG, key, buf(signature), buf(data));
}
