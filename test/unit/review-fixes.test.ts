import { describe, it, expect } from "vitest";
import forge from "node-forge";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { signCms, verifyCms } from "../../src/core/signer";
import { parseP12, wipe } from "../../src/core/p12";
import { KzSignError } from "../../src/core/errors";
import { readFixture, FIXTURE_PASSWORD, GOST2015_INDIVIDUAL, RSA_PERSONAL, NCA_GOST2022_CA } from "../helpers/fixtures";

const data = new TextEncoder().encode("doc");
const gostKey = () => parseP12(readFixture(GOST2015_INDIVIDUAL), FIXTURE_PASSWORD);
const rsaKey = () => parseP12(readFixture(RSA_PERSONAL), FIXTURE_PASSWORD);
const codeOf = async (p: Promise<unknown>) => { try { await p; } catch (e) { return (e as KzSignError).code; } return "no error"; };

function mutate(cms: Uint8Array, fn: (sd: pkijs.SignedData) => void): Uint8Array {
  const sd = new pkijs.SignedData({ schema: new pkijs.ContentInfo({ schema: asn1js.fromBER(cms).result }).content });
  fn(sd);
  return new Uint8Array(new pkijs.ContentInfo({ contentType: "1.2.840.113549.1.7.2", content: sd.toSchema(true) }).toSchema().toBER(false));
}
const cert = (der: Uint8Array) => new pkijs.Certificate({ schema: asn1js.fromBER(der).result });

describe("verifyCms на враждебном вводе (I-1)", () => {
  it.each([[new Uint8Array([1, 2, 3])], [new Uint8Array()], [new Uint8Array([0x30, 0x03, 0x02, 0x01, 0x01])]])("мусор → MALFORMED_CMS", async (bad) => {
    expect(await codeOf(verifyCms(bad))).toBe("MALFORMED_CMS");
  });
  it("CMS без сертификатов → MALFORMED_CMS", async () => {
    const cms = mutate(await signCms(data, gostKey(), { detached: false }), (sd) => { sd.certificates = []; });
    expect(await codeOf(verifyCms(cms))).toBe("MALFORMED_CMS");
  });
});

describe("сертификат подписанта по sid (I-2)", () => {
  it("УЦ первым в списке — подпись валидна, подписант — владелец ключа", async () => {
    const k = gostKey();
    const cms = mutate(await signCms(data, k, { detached: false }), (sd) => { sd.certificates = [cert(readFixture(NCA_GOST2022_CA)), ...sd.certificates!]; });
    const r = await verifyCms(cms);
    expect(r.valid).toBe(true);
    expect(r.signerCertDer).toEqual(k.certificateDer);
  });
  it("подмена сертификата чужим → не valid", async () => {
    const cms = mutate(await signCms(data, gostKey(), { detached: false }), (sd) => { sd.certificates = [cert(rsaKey().certificateDer)]; });
    expect(await codeOf(verifyCms(cms))).toBe("MALFORMED_CMS");
  });
});

describe("алгоритмы (I-3)", () => {
  it("неизвестный алгоритм подписи → UNSUPPORTED_ALGORITHM", async () => {
    const cms = mutate(await signCms(data, rsaKey(), { detached: false }), (sd) => { sd.signerInfos[0]!.signatureAlgorithm = new pkijs.AlgorithmIdentifier({ algorithmId: "1.2.3.4" }); });
    expect(await codeOf(verifyCms(cms))).toBe("UNSUPPORTED_ALGORITHM");
  });
  it("rsaEncryption в signatureAlgorithm (как у Kalkan/OpenSSL) принимается", async () => {
    const cms = mutate(await signCms(data, rsaKey(), { detached: false }), (sd) => { sd.signerInfos[0]!.signatureAlgorithm = new pkijs.AlgorithmIdentifier({ algorithmId: "1.2.840.113549.1.1.1" }); });
    expect((await verifyCms(cms)).valid).toBe(true);
  });
});

describe("parseP12 выбирает сертификат по ключу (I-4)", () => {
  it("p12 без localKeyId, сертификат УЦ первым", () => {
    const k = rsaKey();
    const key = forge.pki.privateKeyFromAsn1(forge.asn1.fromDer(forge.util.binary.raw.encode(k.privateKeyPkcs8)));
    const own = forge.pki.certificateFromAsn1(forge.asn1.fromDer(forge.util.binary.raw.encode(k.certificateDer)));
    const other = forge.pki.certificateFromAsn1(forge.asn1.fromDer(forge.util.binary.raw.encode(parseP12(readFixture("danikarik/personal/active/AUTH_RSA256_b2c70a9ff7a5dc59de0ccc3c0ddde3437cc1f12d.p12"), FIXTURE_PASSWORD).certificateDer)));
    const p12 = forge.pkcs12.toPkcs12Asn1(key, [other, own], "pw", { generateLocalKeyId: false, algorithm: "3des" });
    const parsed = parseP12(forge.util.binary.raw.decode(forge.asn1.toDer(p12).getBytes()), "pw");
    expect(parsed.certificateDer).toEqual(k.certificateDer);
  });
});

describe("wipe (I-5)", () => {
  it("затирает PKCS#8", () => {
    const k = gostKey();
    wipe(k);
    expect(k.privateKeyPkcs8.every((b) => b === 0)).toBe(true);
  });
});
