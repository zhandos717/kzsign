import forge from "node-forge";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { KzSignError } from "./errors";
import { gost } from "./crypto/gost";

export type KeyAlgorithm = "GOST2015_512" | "RSA";

export interface ParsedP12 {
  algorithm: KeyAlgorithm;
  privateKeyPkcs8: Uint8Array;
  certificateDer: Uint8Array;
  chainDer: Uint8Array[];
}

const OID_RSA = "1.2.840.113549.1.1.1";
const OID_GOST2015 = "1.2.398.3.10.1.1.2.2";
const OID_GOST2004 = "1.2.398.3.10.1.1.1.1";

const toBytes = (bin: string) => forge.util.binary.raw.decode(bin);
const toBin = (b: Uint8Array) => forge.util.binary.raw.encode(b);
const derOf = (a: forge.asn1.Asn1) => toBytes(forge.asn1.toDer(a).getBytes());
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

function isCertificate(der: Uint8Array): boolean {
  try {
    new pkijs.Certificate({ schema: asn1js.fromBER(der).result });
    return true;
  } catch {
    return false;
  }
}

// forge не разбирает ГОСТ-сертификаты: в bag.asn1 лежит либо сам сертификат, либо certBag с ним внутри OCTET STRING
function certFromBag(bagAsn1: forge.asn1.Asn1): Uint8Array {
  const whole = derOf(bagAsn1);
  if (isCertificate(whole)) return whole;
  const stack: asn1js.AsnType[] = [asn1js.fromBER(whole).result];
  while (stack.length) {
    const n = stack.pop()!;
    if (n instanceof asn1js.OctetString) {
      const b = new Uint8Array(n.valueBlock.valueHexView);
      if (b.length && isCertificate(b)) return b;
    }
    const children = (n as asn1js.Constructed).valueBlock?.value;
    if (Array.isArray(children)) stack.push(...children);
  }
  throw new KzSignError("MALFORMED_P12", "в certBag нет сертификата");
}

function keyAlgorithmOid(pkcs8: forge.asn1.Asn1): string {
  const algSeq = (pkcs8.value as forge.asn1.Asn1[])[1]!;
  const oid = (algSeq.value as forge.asn1.Asn1[])[0]!;
  return forge.asn1.derToOid(oid.value as string);
}

function publicKeyMatches(algorithm: KeyAlgorithm, keyBag: forge.pkcs12.Bag, pkcs8: Uint8Array, certDer: Uint8Array): boolean {
  try {
    if (algorithm === "RSA") {
      const cert = forge.pki.certificateFromAsn1(forge.asn1.fromDer(toBin(certDer)));
      return (cert.publicKey as forge.pki.rsa.PublicKey).n.equals((keyBag.key as forge.pki.rsa.PrivateKey).n);
    }
    return hex(gost.publicKeyFromPrivate(pkcs8)) === hex(gost.publicKeyFromCert(certDer));
  } catch {
    return false;
  }
}

/** Затирает копию закрытого ключа. Копии внутри forge и криптобиблиотек JS стереть нельзя — см. docs/decisions/0001. */
export function wipe(parsed: ParsedP12): void {
  parsed.privateKeyPkcs8.fill(0);
}

export function parseP12(der: Uint8Array, password: string): ParsedP12 {
  let asn1: forge.asn1.Asn1;
  try {
    asn1 = forge.asn1.fromDer(toBin(der));
  } catch {
    throw new KzSignError("MALFORMED_P12", "файл не является PKCS#12");
  }

  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/password|MAC|decrypt/i.test(msg)) throw new KzSignError("BAD_PASSWORD", "неверный пароль");
    throw new KzSignError("MALFORMED_P12", "не удалось разобрать PKCS#12");
  }

  const bags = p12.safeContents.flatMap((s) => s.safeBags);
  const keyBag = bags.find((b) => b.type === forge.pki.oids.pkcs8ShroudedKeyBag || b.type === forge.pki.oids.keyBag);
  if (!keyBag) throw new KzSignError("NO_KEY", "в файле нет закрытого ключа");

  // forge сам разбирает только RSA; для ГОСТ в bag.asn1 остаётся расшифрованный PKCS#8
  const pkcs8Asn1 = keyBag.key
    ? forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(keyBag.key))
    : (keyBag.asn1 as forge.asn1.Asn1 | undefined);
  if (!pkcs8Asn1) throw new KzSignError("BAD_PASSWORD", "не удалось расшифровать ключ");

  let oid: string;
  try {
    oid = keyAlgorithmOid(pkcs8Asn1);
  } catch {
    // без MAC неверный пароль даёт мусор, который иногда разбирается как ASN.1
    throw new KzSignError("BAD_PASSWORD", "не удалось расшифровать ключ");
  }
  if (oid === OID_GOST2004) throw new KzSignError("UNSUPPORTED_ALGORITHM", "ГОСТ 34.310-2004 не поддерживается");
  const algorithm: KeyAlgorithm | null = oid === OID_RSA ? "RSA" : oid === OID_GOST2015 ? "GOST2015_512" : null;
  if (!algorithm) throw new KzSignError("UNSUPPORTED_ALGORITHM", `алгоритм ${oid}`);

  const privateKeyPkcs8 = derOf(pkcs8Asn1);
  const certs = bags
    .filter((b) => b.type === forge.pki.oids.certBag)
    .map((b) => (b.cert ? derOf(forge.pki.certificateToAsn1(b.cert)) : certFromBag(b.asn1 as forge.asn1.Asn1)));
  const own = certs.find((c) => publicKeyMatches(algorithm, keyBag, privateKeyPkcs8, c));
  if (!own) {
    privateKeyPkcs8.fill(0);
    throw new KzSignError("MALFORMED_P12", "нет сертификата для закрытого ключа");
  }

  return { algorithm, privateKeyPkcs8, certificateDer: own, chainDer: certs.filter((c) => hex(c) !== hex(own)) };
}
