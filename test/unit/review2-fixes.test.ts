import { describe, it, expect, vi } from "vitest";
import { createConfirmManager, makePreview, type WindowsApi } from "../../src/sw/confirm-manager";
import { createKeystore, type Storage } from "../../src/sw/keystore";
import { readFixture, FIXTURE_PASSWORD, RSA_PERSONAL } from "../helpers/fixtures";

function fakeWindows() {
  let n = 1;
  const opened: string[] = [];
  const closed: number[] = [];
  const api: WindowsApi = { open: async (u) => { opened.push(u); return n++; }, close: async (id) => { closed.push(id); }, onRemoved: () => {} };
  return { api, opened, closed };
}
const req = { origin: "https://a.kz", operation: "sign" as const, items: [], isHash: false };
const flush = () => new Promise((r) => setTimeout(r, 0));
const tokenOf = (u: string) => u.split("#")[1]!;

describe("очередь подтверждений (ревью #2)", () => {
  it("закрытие сессии снимает её запросы из очереди и закрывает активное окно", async () => {
    const w = fakeWindows();
    const m = createConfirmManager(w.api);
    const A = {}, B = {};
    const a1 = m.ask(req, async () => 1, { session: A });
    const b1 = m.ask({ ...req, origin: "https://b.kz" }, async () => 2, { session: B });
    await flush();
    m.cancelSession(A);
    expect(await a1).toBeNull();
    expect(w.closed).toEqual([1]);
    await flush();
    expect(m.pending(tokenOf(w.opened[1]!))!.origin).toBe("https://b.kz");
    void b1;
  });

  it("не больше одного ожидающего запроса на сессию", async () => {
    const m = createConfirmManager(fakeWindows().api);
    const S = {};
    void m.ask(req, async () => 1, { session: S });
    expect(await m.ask(req, async () => 2, { session: S })).toBeNull();
  });

  it("общий лимит очереди", async () => {
    const m = createConfirmManager(fakeWindows().api);
    for (let i = 0; i < 5; i++) void m.ask(req, async () => i, { session: {} });
    expect(await m.ask(req, async () => 99, { session: {} })).toBeNull();
  });
});

describe("confirm answer (ревью #3, #4)", () => {
  it("второй answer, пока идёт verify, отклоняется", async () => {
    const w = fakeWindows();
    const m = createConfirmManager(w.api);
    let release!: () => void;
    const verify = vi.fn(() => new Promise<number>((r) => { release = () => r(1); }));
    void m.ask(req, verify);
    await flush();
    const t = tokenOf(w.opened[0]!);
    const first = m.answer(t, { keyId: "k", password: "a" });
    expect(await m.answer(t, { keyId: "k", password: "b" })).toEqual({ ok: false, code: "BUSY" });
    release();
    expect(await first).toEqual({ ok: true });
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("результат verify, опоздавший после отмены, освобождается через dispose", async () => {
    const w = fakeWindows();
    const m = createConfirmManager(w.api);
    let release!: () => void;
    const secret = { wiped: false };
    const dispose = vi.fn((v: typeof secret) => { v.wiped = true; });
    const p = m.ask(req, () => new Promise<typeof secret>((r) => { release = () => r(secret); }), { dispose });
    await flush();
    const t = tokenOf(w.opened[0]!);
    const late = m.answer(t, { keyId: "k", password: "a" });
    m.cancelSession(undefined);
    await m.answer(t, { cancel: true });
    release();
    await late;
    expect(await p).toBeNull();
    expect(secret.wiped).toBe(true);
  });
});

describe("keystore: параллельные попытки (ревью #3)", () => {
  it("10 параллельных неверных unlock считаются все", async () => {
    const m = new Map<string, unknown>();
    const storage: Storage = { get: async (k) => structuredClone(m.get(k)), set: async (k, v) => { m.set(k, structuredClone(v)); }, remove: async (k) => { m.delete(k); }, keys: async () => [...m.keys()] };
    const ks = createKeystore(storage, { iterations: 1000, now: () => 0 });
    const { id } = await ks.importP12(readFixture(RSA_PERSONAL), FIXTURE_PASSWORD);
    const codes = await Promise.all(Array.from({ length: 10 }, () => ks.unlock(id, "bad").then(() => "ok", (e) => e.code)));
    expect(codes.filter((c) => c === "BAD_PASSWORD")).toHaveLength(5);
    expect(codes.filter((c) => c === "PIN_LOCKED")).toHaveLength(5);
  });
});

describe("превью (ревью #5)", () => {
  it("обрезка помечается", () => {
    expect(makePreview(new TextEncoder().encode("a".repeat(2500)))).toEqual({ text: "a".repeat(2000), truncated: true, total: 2500 });
    expect(makePreview(new TextEncoder().encode("abc"))).toEqual({ text: "abc", truncated: false, total: 3 });
  });
  it.each([0x200b, 0xfeff, 0x2028].map((c) => "a" + String.fromCharCode(c) + "b").concat(["a" + "\n".repeat(50) + "b"]))("подозрительный текст без превью: %j", (t) => {
    expect(makePreview(new TextEncoder().encode(t))).toBeUndefined();
  });
});
