import { describe, it, expect } from "vitest";
import { createSessionKeys } from "../../src/sw/session-keys";
import { parseP12 } from "../../src/core/p12";
import { signCms, verifyCms } from "../../src/core/signer";
import { readFixture, FIXTURE_PASSWORD, GOST2015_INDIVIDUAL } from "../helpers/fixtures";

function memArea() {
  const m = new Map<string, unknown>();
  return {
    m,
    get: async (k: string) => structuredClone(m.get(k)),
    set: async (k: string, v: unknown) => { m.set(k, structuredClone(v)); },
    remove: async (k: string) => { m.delete(k); },
    keys: async () => [...m.keys()],
  };
}

describe("session-keys", () => {
  it("запомненный ключ подписывает; get отдаёт копию, которую можно затереть", async () => {
    const area = memArea();
    const sk = createSessionKeys(area);
    await sk.remember("k1", parseP12(readFixture(GOST2015_INDIVIDUAL), FIXTURE_PASSWORD));
    const a = (await sk.get("k1"))!;
    a.privateKeyPkcs8.fill(0);
    const b = (await sk.get("k1"))!;
    expect(b.privateKeyPkcs8.some((x) => x !== 0)).toBe(true);
    expect((await verifyCms(await signCms(new Uint8Array([1]), b, { detached: false }))).valid).toBe(true);
  });

  it("пароль не хранится", async () => {
    const area = memArea();
    const sk = createSessionKeys(area);
    await sk.remember("k1", parseP12(readFixture(GOST2015_INDIVIDUAL), FIXTURE_PASSWORD));
    expect(JSON.stringify([...area.m.values()])).not.toContain(FIXTURE_PASSWORD);
  });

  it("forget одного и всех; список открытых", async () => {
    const sk = createSessionKeys(memArea());
    const p = parseP12(readFixture(GOST2015_INDIVIDUAL), FIXTURE_PASSWORD);
    await sk.remember("k1", p);
    await sk.remember("k2", p);
    expect((await sk.ids()).sort()).toEqual(["k1", "k2"]);
    await sk.forget("k1");
    expect(await sk.get("k1")).toBeNull();
    await sk.forget();
    expect(await sk.ids()).toEqual([]);
  });

  it("неизвестный ключ → null", async () => {
    expect(await createSessionKeys(memArea()).get("nope")).toBeNull();
  });
});
