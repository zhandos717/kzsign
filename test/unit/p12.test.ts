import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { describe, it, expect } from "vitest";
import { parseP12 } from "../../src/core/p12";
import { KzSignError } from "../../src/core/errors";
import { readFixture, FIXTURE_PASSWORD, GOST2015_INDIVIDUAL, RSA_PERSONAL, GOST2004_ORG } from "../helpers/fixtures";

const errorOf = (fn: () => unknown) => { try { fn(); } catch (e) { return e; } throw new Error("no error"); };

describe("parseP12", () => {
  it("ГОСТ 2015", () => {
    const p = parseP12(readFixture(GOST2015_INDIVIDUAL), FIXTURE_PASSWORD);
    expect(p.algorithm).toBe("GOST2015_512");
    expect(p.certificateDer[0]).toBe(0x30);
    expect(p.privateKeyPkcs8[0]).toBe(0x30);
  });
  it("RSA", () => {
    expect(parseP12(readFixture(RSA_PERSONAL), FIXTURE_PASSWORD).algorithm).toBe("RSA");
  });
  it("неверный пароль → BAD_PASSWORD", () => {
    for (const f of [RSA_PERSONAL, GOST2015_INDIVIDUAL]) {
      const e = errorOf(() => parseP12(readFixture(f), "wrong"));
      expect(e).toBeInstanceOf(KzSignError);
      expect((e as KzSignError).code).toBe("BAD_PASSWORD");
    }
  });
  it("ГОСТ 2004 → UNSUPPORTED_ALGORITHM", () => {
    expect((errorOf(() => parseP12(readFixture(GOST2004_ORG), FIXTURE_PASSWORD)) as KzSignError).code).toBe("UNSUPPORTED_ALGORITHM");
  });
  it("мусор → MALFORMED_P12", () => {
    expect((errorOf(() => parseP12(new Uint8Array([1, 2, 3]), "x")) as KzSignError).code).toBe("MALFORMED_P12");
  });
  it("ошибка не содержит пароль", () => {
    expect(String(errorOf(() => parseP12(readFixture(RSA_PERSONAL), "secret-pass")))).not.toContain("secret-pass");
  });
  it("сертификат пользователя (ИИН в subject), а не УЦ", () => {
    const p = parseP12(readFixture(GOST2015_INDIVIDUAL), FIXTURE_PASSWORD);
    const cert = new pkijs.Certificate({ schema: asn1js.fromBER(p.certificateDer).result });
    const sn = cert.subject.typesAndValues.find((t) => t.type === "2.5.4.5");
    expect(String(sn?.value.valueBlock.value)).toMatch(/^IIN\d{12}$/);
  });
});
