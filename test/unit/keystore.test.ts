import { describe, it, expect, beforeEach } from "vitest";
import { createKeystore, type Storage } from "../../src/sw/keystore";
import { signCms, verifyCms } from "../../src/core/signer";
import { KzSignError } from "../../src/core/errors";
import { readFixture, FIXTURE_PASSWORD, GOST2015_INDIVIDUAL, RSA_PERSONAL, GOST2004_ORG } from "../helpers/fixtures";

function memStorage(): Storage & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async (k) => structuredClone(data.get(k)),
    set: async (k, v) => { data.set(k, structuredClone(v)); },
    remove: async (k) => { data.delete(k); },
    keys: async () => [...data.keys()],
  };
}

const errCode = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as KzSignError; } throw new Error("no error"); };

let storage: ReturnType<typeof memStorage>;
let clock: number;
let ks: ReturnType<typeof createKeystore>;
beforeEach(() => {
  storage = memStorage();
  clock = 1_000_000;
  ks = createKeystore(storage, { iterations: 1000, now: () => clock });
});

describe("keystore", () => {
  it("импорт ГОСТ и RSA, метаданные", async () => {
    const g = await ks.importP12(readFixture(GOST2015_INDIVIDUAL), FIXTURE_PASSWORD);
    const r = await ks.importP12(readFixture(RSA_PERSONAL), FIXTURE_PASSWORD, "мой RSA");
    expect(g).toMatchObject({ algorithm: "GOST2015_512", iin: expect.stringMatching(/^\d{12}$/) });
    expect(g.subjectCn.length).toBeGreaterThan(0);
    expect(g.notAfter).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(r.alias).toBe("мой RSA");
    expect((await ks.list()).map((k) => k.id).sort()).toEqual([g.id, r.id].sort());
  });

  it("в хранилище нет пароля и открытого ключа", async () => {
    await ks.importP12(readFixture(RSA_PERSONAL), FIXTURE_PASSWORD);
    const dump = JSON.stringify([...storage.data.values()]);
    expect(dump).not.toContain(FIXTURE_PASSWORD);
    const p12b64 = Buffer.from(readFixture(RSA_PERSONAL)).toString("base64");
    expect(dump).not.toContain(p12b64.slice(100, 160));
  });

  it("неверный пароль при импорте", async () => {
    expect((await errCode(ks.importP12(readFixture(RSA_PERSONAL), "bad"))).code).toBe("BAD_PASSWORD");
    expect(storage.data.size).toBe(0);
  });

  it("ГОСТ 2004 не импортируется", async () => {
    expect((await errCode(ks.importP12(readFixture(GOST2004_ORG), FIXTURE_PASSWORD))).code).toBe("UNSUPPORTED_ALGORITHM");
  });

  it("повторный импорт — тот же id", async () => {
    const a = await ks.importP12(readFixture(GOST2015_INDIVIDUAL), FIXTURE_PASSWORD);
    const b = await ks.importP12(readFixture(GOST2015_INDIVIDUAL), FIXTURE_PASSWORD);
    expect(b.id).toBe(a.id);
    expect(await ks.list()).toHaveLength(1);
  });

  it("unlock → ключ подписывает", async () => {
    const m = await ks.importP12(readFixture(GOST2015_INDIVIDUAL), FIXTURE_PASSWORD);
    const key = await ks.unlock(m.id, FIXTURE_PASSWORD);
    const data = new TextEncoder().encode("x");
    expect((await verifyCms(await signCms(data, key, { detached: false }))).valid).toBe(true);
  });

  it("лимит попыток: 5 неудач → блок 1 с, потом сброс", async () => {
    const m = await ks.importP12(readFixture(RSA_PERSONAL), FIXTURE_PASSWORD);
    for (let i = 0; i < 5; i++) expect((await errCode(ks.unlock(m.id, "bad"))).code).toBe("BAD_PASSWORD");
    const locked = await errCode(ks.unlock(m.id, FIXTURE_PASSWORD));
    expect(locked.code).toBe("PIN_LOCKED");
    expect(locked.retryAfterSec).toBe(1);
    clock += 1000;
    await ks.unlock(m.id, FIXTURE_PASSWORD);
    expect((await errCode(ks.unlock(m.id, "bad"))).code).toBe("BAD_PASSWORD");
  });

  it("задержка растёт и ограничена 900 с", async () => {
    const m = await ks.importP12(readFixture(RSA_PERSONAL), FIXTURE_PASSWORD);
    const delays: number[] = [];
    for (let i = 0; i < 20; i++) {
      const e = await errCode(ks.unlock(m.id, "bad"));
      if (e.code === "PIN_LOCKED") { delays.push(e.retryAfterSec!); clock += e.retryAfterSec! * 1000; i--; }
      if (delays.length >= 12) break;
    }
    expect(delays.slice(0, 4)).toEqual([1, 2, 4, 8]);
    expect(Math.max(...delays)).toBe(900);
  }, 30_000);

  it("испорченный шифротекст → MALFORMED_P12", async () => {
    const m = await ks.importP12(readFixture(RSA_PERSONAL), FIXTURE_PASSWORD);
    const k = [...storage.data.keys()].find((x) => x.startsWith("kzsign.key."))!;
    const rec = storage.data.get(k) as { ct: string };
    rec.ct = "A" + rec.ct.slice(1);
    expect((await errCode(ks.unlock(m.id, FIXTURE_PASSWORD))).code).toBe("MALFORMED_P12");
  });

  it("неизвестный id → NOT_FOUND", async () => {
    expect((await errCode(ks.unlock("nope", "x"))).code).toBe("NOT_FOUND");
  });

  it("remove удаляет ключ и счётчик", async () => {
    const m = await ks.importP12(readFixture(RSA_PERSONAL), FIXTURE_PASSWORD);
    await errCode(ks.unlock(m.id, "bad"));
    await ks.remove(m.id);
    expect(await ks.list()).toEqual([]);
    expect(storage.data.size).toBe(0);
  });
});
