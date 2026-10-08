import { describe, it, expect } from "vitest";
import { rsaSign, rsaVerify } from "../../src/core/crypto/rsa";
import { parseP12 } from "../../src/core/p12";
import { readFixture, FIXTURE_PASSWORD, RSA_PERSONAL } from "../helpers/fixtures";

describe("rsa", () => {
  it("sign → verify по сертификату", async () => {
    const p = parseP12(readFixture(RSA_PERSONAL), FIXTURE_PASSWORD);
    const data = new TextEncoder().encode("hello");
    const sig = await rsaSign(data, p.privateKeyPkcs8);
    expect(await rsaVerify(data, sig, p.certificateDer)).toBe(true);
    expect(await rsaVerify(new Uint8Array([0]), sig, p.certificateDer)).toBe(false);
  });
});
