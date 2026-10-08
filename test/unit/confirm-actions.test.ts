import { describe, it, expect, beforeEach } from "vitest";
import { handleConfirmMessage } from "../../src/sw/confirm-actions";
import { createConfirmManager, type WindowsApi } from "../../src/sw/confirm-manager";
import { createKeystore, type Storage } from "../../src/sw/keystore";
import { createTrustedSites } from "../../src/sw/trusted-sites";
import { createSessionKeys } from "../../src/sw/session-keys";
import { openKey } from "../../src/sw/handler";
import { readFixture, FIXTURE_PASSWORD, RSA_PERSONAL } from "../helpers/fixtures";

const mem = (): Storage => {
  const m = new Map<string, unknown>();
  return { get: async (k) => structuredClone(m.get(k)), set: async (k, v) => { m.set(k, structuredClone(v)); }, remove: async (k) => { m.delete(k); }, keys: async () => [...m.keys()] };
};
const flush = () => new Promise((r) => setTimeout(r, 0));
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

let deps: Parameters<typeof handleConfirmMessage>[2];
let opened: string[];
const from = { documentId: "doc", tabId: 1 };

beforeEach(() => {
  opened = [];
  const win: WindowsApi = { open: async (u) => { opened.push(u); return 1; }, close: async () => {}, onRemoved: () => {} };
  const storage = mem();
  const keystore = createKeystore(storage, { iterations: 1000 });
  const sessionKeys = createSessionKeys(mem());
  deps = { confirm: createConfirmManager(win), keystore, trusted: createTrustedSites(mem()), sessionKeys };
});

async function ask() {
  const p = deps.confirm.ask({ origin: "https://new.kz", operation: "sign", items: [], isHash: false, firstVisit: true }, (keyId, pw) => openKey(deps, keyId, pw));
  await flush();
  return { p, token: opened[0]!.split("#")[1]! };
}

describe("сообщения окна подтверждения", () => {
  it("confirm.get без верного токена — пусто (ключи не отдаются)", async () => {
    await deps.keystore.importP12(readFixture(RSA_PERSONAL), FIXTURE_PASSWORD);
    expect(await handleConfirmMessage({ type: "confirm.get", token: "nope" }, from, deps)).toEqual({});
  });

  it("«Запомнить сайт» добавляет origin запроса в доверенные только при успешной подписи", async () => {
    const { id } = await deps.keystore.importP12(readFixture(RSA_PERSONAL), FIXTURE_PASSWORD);
    const { p, token } = await ask();
    await handleConfirmMessage({ type: "confirm.get", token }, from, deps);
    expect(await handleConfirmMessage({ type: "confirm.answer", token, answer: { keyId: id, password: "bad", trustSite: true } }, from, deps)).toMatchObject({ ok: false });
    expect(await deps.trusted.has("https://new.kz")).toBe(false);
    expect(await handleConfirmMessage({ type: "confirm.answer", token, answer: { keyId: id, password: FIXTURE_PASSWORD, trustSite: true } }, from, deps)).toEqual({ ok: true });
    expect(await deps.trusted.has("https://new.kz")).toBe(true);
    expect(await p).not.toBeNull();
  });

  it("загрузить ключ и подписать прямо из окна", async () => {
    const { p, token } = await ask();
    await handleConfirmMessage({ type: "confirm.get", token }, from, deps);
    const r = await handleConfirmMessage({ type: "confirm.import", token, file: b64(readFixture(RSA_PERSONAL)), password: FIXTURE_PASSWORD }, from, deps);
    expect(r).toEqual({ ok: true });
    expect(await deps.keystore.list()).toHaveLength(1);
    expect(await p).not.toBeNull();
  });

  it("загрузка с неверным паролем — ошибка, ключ не сохранён, окно ждёт дальше", async () => {
    const { token } = await ask();
    await handleConfirmMessage({ type: "confirm.get", token }, from, deps);
    expect(await handleConfirmMessage({ type: "confirm.import", token, file: b64(readFixture(RSA_PERSONAL)), password: "bad" }, from, deps)).toEqual({ ok: false, code: "BAD_PASSWORD" });
    expect(await deps.keystore.list()).toHaveLength(0);
    expect(deps.confirm.pending(token, from)).toBeDefined();
  });

  it("загрузка с чужим токеном не импортирует ключ", async () => {
    await ask();
    expect(await handleConfirmMessage({ type: "confirm.import", token: "nope", file: b64(readFixture(RSA_PERSONAL)), password: FIXTURE_PASSWORD }, from, deps)).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await deps.keystore.list()).toHaveLength(0);
  });
});
