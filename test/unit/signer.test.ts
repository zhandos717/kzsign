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
