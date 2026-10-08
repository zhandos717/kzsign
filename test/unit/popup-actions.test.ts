import { describe, it, expect } from "vitest";
import { handlePopupMessage } from "../../src/sw/popup-actions";
import { createKeystore, type Storage } from "../../src/sw/keystore";
import { verifyCms } from "../../src/core/signer";
import { readFixture, FIXTURE_PASSWORD, RSA_PERSONAL } from "../helpers/fixtures";

function memStorage(): Storage {
  const m = new Map<string, unknown>();
  return { get: async (k) => structuredClone(m.get(k)), set: async (k, v) => { m.set(k, structuredClone(v)); }, remove: async (k) => { m.delete(k); }, keys: async () => [...m.keys()] };
}
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const deps = () => { const storage = memStorage(); return { storage, keystore: createKeystore(storage, { iterations: 1000 }) }; };

describe("popup actions", () => {
  it("import → list → remove", async () => {
    const d = deps();
    const imported = (await handlePopupMessage({ type: "keys.import", file: b64(readFixture(RSA_PERSONAL)), password: FIXTURE_PASSWORD, alias: "раб" }, d)) as { key: { id: string } };
    const listed = (await handlePopupMessage({ type: "keys.list" }, d)) as { keys: { id: string; alias: string }[] };
    expect(listed.keys).toEqual([expect.objectContaining({ id: imported.key.id, alias: "раб" })]);
    await handlePopupMessage({ type: "keys.remove", id: imported.key.id }, d);
    expect(((await handlePopupMessage({ type: "keys.list" }, d)) as { keys: unknown[] }).keys).toEqual([]);
  });

  it("неверный пароль", async () => {
    expect(await handlePopupMessage({ type: "keys.import", file: b64(readFixture(RSA_PERSONAL)), password: "x" }, deps())).toEqual({ error: "BAD_PASSWORD" });
  });

  it("режим: по умолчанию auto, сохраняется, мусор отклоняется", async () => {
    const d = deps();
    expect(await handlePopupMessage({ type: "mode.get" }, d)).toEqual({ mode: "auto" });
    await handlePopupMessage({ type: "mode.set", mode: "native" }, d);
    expect(await handlePopupMessage({ type: "mode.get" }, d)).toEqual({ mode: "native" });
    expect(await handlePopupMessage({ type: "mode.set", mode: "evil" }, d)).toEqual({ error: "BAD_REQUEST" });
  });

  it("подпись файла", async () => {
    const d = deps();
    const { key } = (await handlePopupMessage({ type: "keys.import", file: b64(readFixture(RSA_PERSONAL)), password: FIXTURE_PASSWORD }, d)) as { key: { id: string } };
    const file = new TextEncoder().encode("файл");
    const r = (await handlePopupMessage({ type: "file.sign", keyId: key.id, password: FIXTURE_PASSWORD, file: b64(file), detached: true }, d)) as { cms: string };
    const cms = Uint8Array.from(atob(r.cms), (c) => c.charCodeAt(0));
    expect((await verifyCms(cms, file)).valid).toBe(true);
  });

  it("неизвестное и битое сообщение", async () => {
    expect(await handlePopupMessage({ type: "rm -rf" }, deps())).toEqual({ error: "UNKNOWN" });
    expect(await handlePopupMessage(null, deps())).toEqual({ error: "UNKNOWN" });
    expect(await handlePopupMessage({ type: "keys.import", file: "%%%", password: "x" }, deps())).toEqual({ error: "BAD_REQUEST" });
  });
});

describe("запомненные ключи в popup", () => {
  it("keys.list отдаёт открытые; file.sign без пароля по открытому ключу; keys.forget и keys.remove забывают", async () => {
    const { createSessionKeys } = await import("../../src/sw/session-keys");
    const area = memStorage();
    const d = { ...deps(), sessionKeys: createSessionKeys(area) };
    const { key } = (await handlePopupMessage({ type: "keys.import", file: b64(readFixture(RSA_PERSONAL)), password: FIXTURE_PASSWORD }, d)) as { key: { id: string } };
    expect(((await handlePopupMessage({ type: "keys.list" }, d)) as { open: string[] }).open).toEqual([]);
    await handlePopupMessage({ type: "file.sign", keyId: key.id, password: FIXTURE_PASSWORD, file: b64(new Uint8Array([1])), detached: false }, d);
    expect(((await handlePopupMessage({ type: "keys.list" }, d)) as { open: string[] }).open).toEqual([key.id]);
    const r = (await handlePopupMessage({ type: "file.sign", keyId: key.id, file: b64(new Uint8Array([2])), detached: false }, d)) as { cms?: string };
    expect(r.cms).toBeTruthy();
    await handlePopupMessage({ type: "keys.forget" }, d);
    expect(await handlePopupMessage({ type: "file.sign", keyId: key.id, file: b64(new Uint8Array([2])), detached: false }, d)).toEqual({ error: "NEED_PASSWORD" });
    await handlePopupMessage({ type: "file.sign", keyId: key.id, password: FIXTURE_PASSWORD, file: b64(new Uint8Array([1])), detached: false }, d);
    await handlePopupMessage({ type: "keys.remove", id: key.id }, d);
    expect(await d.sessionKeys.ids()).toEqual([]);
  });
});
