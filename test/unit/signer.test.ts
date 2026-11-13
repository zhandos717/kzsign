import { describe, it, expect } from "vitest";
import { signCms, verifyCms } from "../../src/core/signer";
import { parseP12 } from "../../src/core/p12";
import { readFixture, FIXTURE_PASSWORD, GOST2015_INDIVIDUAL, GOST2015_INDIVIDUAL_REVOKED, RSA_PERSONAL } from "../helpers/fixtures";

const data = new TextEncoder().encode("Договор №1");
const keys = {
  gost: parseP12(readFixture(GOST2015_INDIVIDUAL), FIXTURE_PASSWORD),
  rsa: parseP12(readFixture(RSA_PERSONAL), FIXTURE_PASSWORD),
};

describe.each(Object.entries(keys))("signCms %s", (_, key) => {
  it("attached: проверяется и содержит данные", async () => {
    const cms = await signCms(data, key, { detached: false });
    const r = await verifyCms(cms);
    expect(r.valid).toBe(true);
    expect(r.signerCertDer).toEqual(key.certificateDer);
    expect(Buffer.from(cms).includes(Buffer.from(data))).toBe(true);
  });
  it("attached: данные лежат простым OCTET STRING, как у NCALayer", async () => {
    const cms = Buffer.from(await signCms(data, key, { detached: false }));
    const at = cms.indexOf(Buffer.from(data));
    expect(cms[at - 2]).toBe(0x04);
    expect(cms[at - 1]).toBe(data.length);
  });
  it("detached: без данных внутри, проверяется с внешними данными", async () => {
    const cms = await signCms(data, key, { detached: true });
    expect(Buffer.from(cms).includes(Buffer.from(data))).toBe(false);
    expect((await verifyCms(cms, data)).valid).toBe(true);
    expect((await verifyCms(cms, new Uint8Array([1]))).valid).toBe(false);
  });
  it("пустые данные подписываются", async () => {
    expect((await verifyCms(await signCms(new Uint8Array(), key, { detached: false }))).valid).toBe(true);
  });
});

it("отозванный ключ подписывает: OCSP — не задача ядра", async () => {
  const k = parseP12(readFixture(GOST2015_INDIVIDUAL_REVOKED), FIXTURE_PASSWORD);
  expect((await verifyCms(await signCms(data, k, { detached: false }))).valid).toBe(true);
});

it("ГОСТ: messageDigest — Стрибог-512 в обычном порядке байтов (как у Kalkan/NCANode)", async () => {
  const { streebog512 } = await import("@li0ard/streebog");
  const asn1js = await import("asn1js");
  const pkijs = await import("pkijs");
  const cms = await signCms(data, keys.gost, { detached: true });
  const sd = new pkijs.SignedData({ schema: new pkijs.ContentInfo({ schema: asn1js.fromBER(cms).result }).content });
  const md = sd.signerInfos[0]!.signedAttrs!.attributes.find((a) => a.type === "1.2.840.113549.1.9.4")!.values[0] as InstanceType<typeof asn1js.OctetString>;
  expect(Buffer.from(md.valueBlock.valueHexView).toString("hex")).toBe(Buffer.from(streebog512(data)).toString("hex"));
});

it.each(Object.entries(keys))("%s: SigningCertificateV2 — SHA-256 сертификата подписанта (иначе NCANode: CERT_HASH_MISMATCH)", async (_, key) => {
  const asn1js = await import("asn1js");
  const pkijs = await import("pkijs");
  const cms = await signCms(data, key, { detached: true });
  const sd = new pkijs.SignedData({ schema: new pkijs.ContentInfo({ schema: asn1js.fromBER(cms).result }).content });
  const ess = sd.signerInfos[0]!.signedAttrs!.attributes.find((a) => a.type === "1.2.840.113549.1.9.16.2.47")!.values[0] as any;
  const certId = ess.valueBlock.value[0].valueBlock.value[0];
  const [alg, hash] = certId.valueBlock.value;
  expect(alg.valueBlock.value[0].valueBlock.toString()).toBe("2.16.840.1.101.3.4.2.1");
  const expected = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(key.certificateDer)));
  expect(Buffer.from(hash.valueBlock.valueHexView).equals(Buffer.from(expected))).toBe(true);
});
