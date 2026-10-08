import { describe, it, expect } from "vitest";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { gost } from "../../src/core/crypto/gost";
import { parseP12 } from "../../src/core/p12";
import { readFixture, FIXTURE_PASSWORD, GOST2015_INDIVIDUAL, NCA_GOST2022_CA } from "../helpers/fixtures";

const p = parseP12(readFixture(GOST2015_INDIVIDUAL), FIXTURE_PASSWORD);

describe("gost", () => {
  it("проверяет подпись тестового УЦ на сертификате (оракул НУЦ)", () => {
    const leaf = new pkijs.Certificate({ schema: asn1js.fromBER(p.certificateDer).result });
    const caPub = gost.publicKeyFromCert(readFixture(NCA_GOST2022_CA));
    const sig = new Uint8Array(leaf.signatureValue.valueBlock.valueHexView);
    expect(gost.verify(gost.digest(new Uint8Array(leaf.tbsView)), sig, caPub)).toBe(true);
  });
  it("подпись своим ключом проверяется открытым ключом сертификата", () => {
    const d = gost.digest(new TextEncoder().encode("hello"));
    expect(d.length).toBe(64);
    const s = gost.sign(d, p.privateKeyPkcs8);
    expect(s.length).toBe(128);
    expect(gost.verify(d, s, gost.publicKeyFromCert(p.certificateDer))).toBe(true);
  });
  it("испорченная подпись не проходит", () => {
    const d = gost.digest(new Uint8Array([1]));
    const s = gost.sign(d, p.privateKeyPkcs8);
    s[0] = s[0]! ^ 0xff;
    expect(gost.verify(d, s, gost.publicKeyFromCert(p.certificateDer))).toBe(false);
  });
  it("подписи недетерминированы (случайный k)", () => {
    const d = gost.digest(new Uint8Array([1]));
    expect(gost.sign(d, p.privateKeyPkcs8)).not.toEqual(gost.sign(d, p.privateKeyPkcs8));
  });
});
