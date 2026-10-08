import { describe, it, expect, beforeAll, vi } from "vitest";
import { createSessionFactory, type ConfirmLike } from "../../src/sw/handler";
import { createKeystore, type Storage } from "../../src/sw/keystore";
import { verifyCms } from "../../src/core/signer";
import type { ParsedP12 } from "../../src/core/p12";
import type { Session } from "../../src/sw/router";
import { readFixture, FIXTURE_PASSWORD, GOST2015_INDIVIDUAL } from "../helpers/fixtures";

function memStorage(): Storage {
  const m = new Map<string, unknown>();
  return { get: async (k) => structuredClone(m.get(k)), set: async (k, v) => { m.set(k, structuredClone(v)); }, remove: async (k) => { m.delete(k); }, keys: async () => [...m.keys()] };
}

const ks = createKeystore(memStorage(), { iterations: 1000 });
let keyId: string;
const unlocked: ParsedP12[] = [];
const keystore = { ...ks, unlock: async (id: string, pw: string) => { const k = await ks.unlock(id, pw); unlocked.push(k); return k; } };
beforeAll(async () => { keyId = (await ks.importP12(readFixture(GOST2015_INDIVIDUAL), FIXTURE_PASSWORD)).id; });

const approve: ConfirmLike = { ask: vi.fn(async (_req, verify) => verify(keyId, FIXTURE_PASSWORD)) };
const reject: ConfirmLike = { ask: vi.fn(async () => null) };

function session(confirm: ConfirmLike, extra: Partial<Parameters<typeof createSessionFactory>[0]> = {}) {
  const pushed: string[] = [];
  const s: Session = { origin: "https://a.kz", tabId: 1, frameId: 0, send: (t) => pushed.push(t), control: () => {} };
  const h = createSessionFactory({ keystore, confirm, getMode: async () => "extension", ...extra })(s);
  return { h, pushed };
}

const common = (method: string, args: unknown[] = []) => JSON.stringify({ module: "kz.gov.pki.knca.commonUtils", method, args });
const b64 = (s: string) => btoa(s);
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const unpem = (p: string) => unb64(p.replace(/-----[A-Z ]+-----|\n/g, ""));

describe("handler (режим extension)", () => {
  it("createCAdESFromBase64 → валидный CMS, ключ затёрт", async () => {
    const { h } = session(approve);
    const res = JSON.parse((await h.onFrame(common("createCAdESFromBase64", ["PKCS12", "SIGNATURE", b64("hello"), true])))!);
    expect(res.code).toBe("200");
    expect((await verifyCms(unb64(res.responseObject))).valid).toBe(true);
    expect(unlocked.at(-1)!.privateKeyPkcs8.every((b) => b === 0)).toBe(true);
    const req = (approve.ask as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0];
    expect(req).toMatchObject({ origin: "https://a.kz", operation: "sign", items: [{ size: 5, preview: { text: "hello", truncated: false, total: 5 } }] });
  });

  it("отказ → action.canceled", async () => {
    const { h } = session(reject);
    expect(JSON.parse((await h.onFrame(common("createCAdESFromBase64", ["PKCS12", "SIGNATURE", b64("x"), true])))!)).toEqual({ code: "500", message: "action.canceled" });
  });

  it("basics sign пачкой → два валидных PEM", async () => {
    const { h } = session(approve);
    const frame = JSON.stringify({ module: "kz.gov.pki.knca.basics", method: "sign", args: { format: "cms", data: [b64("a"), b64("b")], signingParams: { encapsulate: "true" } } });
    const res = JSON.parse((await h.onFrame(frame))!);
    expect(res.status).toBe(true);
    for (const p of res.body.result) expect((await verifyCms(unpem(p))).valid).toBe(true);
  });

  it("basics: отказ → CANCELED", async () => {
    const { h } = session(reject);
    const frame = JSON.stringify({ module: "kz.gov.pki.knca.basics", method: "sign", args: { format: "cms", data: b64("a") } });
    expect(JSON.parse((await h.onFrame(frame))!)).toMatchObject({ status: false, code: "CANCELED" });
  });

  it("getKeyInfo через подтверждение", async () => {
    const { h } = session(approve);
    const res = JSON.parse((await h.onFrame(common("getKeyInfo", ["PKCS12"])))!);
    expect(res.code).toBe("200");
    expect(res.responseObject).toMatchObject({ keyId, algorithm: "ECGOST3410-2015-512", subjectCn: expect.any(String), pem: expect.stringMatching(/^-----BEGIN CERTIFICATE-----/) });
    const keyInfoAsk = (approve.ask as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0];
    expect(keyInfoAsk.operation).toBe("keyInfo");
  });

  it("heartbeat и getActiveTokens без окна", async () => {
    const confirm: ConfirmLike = { ask: vi.fn() };
    const { h } = session(confirm);
    expect(await h.onFrame("--heartbeat--")).toBe("--heartbeat--");
    expect(JSON.parse((await h.onFrame(common("getActiveTokens")))!)).toEqual({ code: "200", responseObject: [] });
    expect(confirm.ask).not.toHaveBeenCalled();
  });

  it("хэш-режим: detached над байтами хэша", async () => {
    const { h } = session(approve);
    const hash = new Uint8Array(32).fill(9);
    const res = JSON.parse((await h.onFrame(common("createCAdESFromBase64Hash", ["PKCS12", "SIGNATURE", btoa(String.fromCharCode(...hash))])))!);
    expect((await verifyCms(unb64(res.responseObject), hash)).valid).toBe(true);
  });

  it("неподдерживаемое и мусор — ошибки протокола без окна", async () => {
    const confirm: ConfirmLike = { ask: vi.fn() };
    const { h } = session(confirm);
    expect(JSON.parse((await h.onFrame(common("signXml", ["PKCS12", "SIGNATURE", "<a/>", "", ""])))!)).toEqual({ code: "500", message: "method.not.supported" });
    expect(JSON.parse((await h.onFrame("garbage"))!)).toMatchObject({ code: "500" });
    expect(confirm.ask).not.toHaveBeenCalled();
  });

  it("ошибка TSA → ошибка подписи", async () => {
    const { h } = session(approve, { tsp: async () => { throw new Error("down"); } });
    const frame = JSON.stringify({ module: "kz.gov.pki.knca.basics", method: "sign", args: { format: "cms", data: b64("a"), signingParams: { tsaProfile: {} } } });
    expect(JSON.parse((await h.onFrame(frame))!)).toMatchObject({ status: false, code: "SIGN_ERROR" });
  });
});

describe("handler (режим native)", () => {
  it("кадры уходят в настоящий NCALayer, первое version-сообщение проглатывается", async () => {
    let onMsg!: (t: string) => void;
    const sent: string[] = [];
    const native = { alive: async () => true, connect: (m: (t: string) => void) => { onMsg = m; return { send: (t: string) => sent.push(t), close: vi.fn() }; } };
    const { h, pushed } = session(approve, { getMode: async () => "native", native });
    expect(await h.onFrame(common("getActiveTokens"))).toBeNull();
    onMsg('{"result":{"version":"1.4"}}');
    onMsg('{"code":"200","responseObject":[]}');
    expect(sent).toEqual([common("getActiveTokens")]);
    expect(pushed).toEqual(['{"code":"200","responseObject":[]}']);
  });
});

describe("запомненный ключ (до закрытия браузера)", () => {
  function memArea() {
    const m = new Map<string, unknown>();
    return { get: async (k: string) => structuredClone(m.get(k)), set: async (k: string, v: unknown) => { m.set(k, structuredClone(v)); }, remove: async (k: string) => { m.delete(k); }, keys: async () => [...m.keys()] };
  }

  it("первая подпись с паролем запоминает ключ, вторая проходит без пароля", async () => {
    const { createSessionKeys } = await import("../../src/sw/session-keys");
    const sessionKeys = createSessionKeys(memArea());
    const answers: (string | undefined)[] = [FIXTURE_PASSWORD, undefined];
    const confirm: ConfirmLike = { ask: vi.fn(async (_req, verify) => verify(keyId, answers.shift())) };
    const { h } = session(confirm, { sessionKeys });
    const frame = common("createCAdESFromBase64", ["PKCS12", "SIGNATURE", b64("x"), true]);
    expect(JSON.parse((await h.onFrame(frame))!).code).toBe("200");
    expect(await sessionKeys.ids()).toEqual([keyId]);
    const second = JSON.parse((await h.onFrame(frame))!);
    expect(second.code).toBe("200");
    expect((await verifyCms(unb64(second.responseObject))).valid).toBe(true);
  });

  it("без пароля и без запомненного ключа → NEED_PASSWORD, окно остаётся", async () => {
    const { createSessionKeys } = await import("../../src/sw/session-keys");
    let verifyErr: unknown;
    const confirm: ConfirmLike = { ask: vi.fn(async (_req, verify) => { try { await verify(keyId, undefined); } catch (e) { verifyErr = e; } return null; }) };
    const { h } = session(confirm, { sessionKeys: createSessionKeys(memArea()) });
    await h.onFrame(common("createCAdESFromBase64", ["PKCS12", "SIGNATURE", b64("x"), true]));
    expect((verifyErr as { code: string }).code).toBe("NEED_PASSWORD");
  });
});

describe("история подписей", () => {
  function memArea() {
    const m = new Map<string, unknown>();
    return { get: async (k: string) => structuredClone(m.get(k)), set: async (k: string, v: unknown) => { m.set(k, structuredClone(v)); }, remove: async (k: string) => { m.delete(k); }, keys: async () => [...m.keys()] };
  }

  it("подпись, отмена и ошибка попадают в историю; getKeyInfo — нет", async () => {
    const { createHistory } = await import("../../src/sw/history");
    const history = createHistory(memArea());
    const frame = common("createCAdESFromBase64", ["PKCS12", "SIGNATURE", Buffer.from("Договор").toString("base64"), true]);
    await session(approve, { history }).h.onFrame(frame);
    await session(reject, { history }).h.onFrame(frame);
    const tspFrame = JSON.stringify({ module: "kz.gov.pki.knca.basics", method: "sign", args: { format: "cms", data: b64("a"), signingParams: { tsaProfile: {} } } });
    await session(approve, { history, tsp: async () => { throw new Error("down"); } }).h.onFrame(tspFrame);
    await session(approve, { history }).h.onFrame(common("getKeyInfo", ["PKCS12"]));

    const list = await history.list();
    expect(list.map((e) => e.status)).toEqual(["error", "canceled", "signed"]);
    const signed = list[2]!;
    expect(signed).toMatchObject({ source: "site", origin: "https://a.kz", tsa: false, key: { alias: expect.any(String), iin: expect.stringMatching(/^\d{12}$/) } });
    expect(signed.items[0]).toMatchObject({ size: new TextEncoder().encode("Договор").length, isHash: false, text: "Договор" });
    expect(list[0]).toMatchObject({ tsa: true, errorCode: "SIGN_ERROR" });
    expect(list[1]!.key).toBeUndefined();
  });
});
