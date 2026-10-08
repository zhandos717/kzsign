import { describe, it, expect, vi, beforeEach } from "vitest";
import { createConfirmManager, makePreview, describeItems, type WindowsApi } from "../../src/sw/confirm-manager";
import { KzSignError } from "../../src/core/errors";

function fakeWindows() {
  let next = 1;
  const removed: ((id: number) => void)[] = [];
  const api = {
    opened: [] as { id: number; url: string }[],
    closed: [] as number[],
    open: vi.fn(async (url: string) => { const id = next++; api.opened.push({ id, url }); return id; }),
    close: vi.fn(async (id: number) => { api.closed.push(id); }),
    onRemoved: (cb: (id: number) => void) => removed.push(cb),
    userCloses: (id: number) => removed.forEach((f) => f(id)),
  };
  return api satisfies WindowsApi & Record<string, unknown>;
}

const req = { origin: "https://a.kz", operation: "sign" as const, items: [], isHash: false };
const tokenOf = (url: string) => url.split("#")[1]!;
const flush = () => new Promise((r) => setTimeout(r, 0));

let win: ReturnType<typeof fakeWindows>;
beforeEach(() => { win = fakeWindows(); });

describe("confirm-manager", () => {
  it("успешное подтверждение: verify вызывается, окно закрывается", async () => {
    const m = createConfirmManager(win);
    const verify = vi.fn(async (keyId: string, pw: string) => `${keyId}:${pw}`);
    const p = m.ask(req, verify);
    await flush();
    const t = tokenOf(win.opened[0]!.url);
    expect(t).toMatch(/^[0-9a-f]{32}$/);
    expect(win.opened[0]!.url).toMatch(/^confirm\.html#/);
    expect(m.pending(t)).toEqual(req);
    expect(await m.answer(t, { keyId: "k", password: "p" })).toEqual({ ok: true });
    expect(await p).toBe("k:p");
    expect(win.closed).toEqual([1]);
  });

  it("неверный пароль: окно остаётся, ошибка уходит в окно", async () => {
    const m = createConfirmManager(win);
    let tries = 0;
    const p = m.ask(req, async () => { if (tries++ === 0) throw new KzSignError("PIN_LOCKED", "x", 4); return "ok"; });
    await flush();
    const t = tokenOf(win.opened[0]!.url);
    expect(await m.answer(t, { keyId: "k", password: "bad" })).toEqual({ ok: false, code: "PIN_LOCKED", retryAfterSec: 4 });
    expect(win.closed).toEqual([]);
    expect(await m.answer(t, { keyId: "k", password: "good" })).toEqual({ ok: true });
    expect(await p).toBe("ok");
  });

  it("отмена кнопкой", async () => {
    const m = createConfirmManager(win);
    const p = m.ask(req, async () => "never");
    await flush();
    await m.answer(tokenOf(win.opened[0]!.url), { cancel: true });
    expect(await p).toBeNull();
    expect(win.closed).toEqual([1]);
  });

  it("пользователь закрыл окно крестиком", async () => {
    const m = createConfirmManager(win);
    const p = m.ask(req, async () => "never");
    await flush();
    win.userCloses(1);
    expect(await p).toBeNull();
  });

  it("таймаут", async () => {
    vi.useFakeTimers();
    const m = createConfirmManager(win, 120_000);
    const p = m.ask(req, async () => "never");
    await vi.advanceTimersByTimeAsync(120_001);
    expect(await p).toBeNull();
    expect(win.closed).toEqual([1]);
    vi.useRealTimers();
  });

  it("два запроса — окна по очереди, у каждого свой результат", async () => {
    const m = createConfirmManager(win);
    const a = m.ask({ ...req, origin: "https://a.kz" }, async (k) => `A:${k}`);
    const b = m.ask({ ...req, origin: "https://b.kz" }, async (k) => `B:${k}`);
    await flush();
    expect(win.opened).toHaveLength(1);
    const ta = tokenOf(win.opened[0]!.url);
    expect(m.pending(ta)!.origin).toBe("https://a.kz");
    await m.answer(ta, { keyId: "1", password: "x" });
    await flush();
    expect(win.opened).toHaveLength(2);
    const tb = tokenOf(win.opened[1]!.url);
    expect(m.pending(tb)!.origin).toBe("https://b.kz");
    await m.answer(tb, { keyId: "2", password: "x" });
    expect(await a).toBe("A:1");
    expect(await b).toBe("B:2");
  });

  it("чужой или старый токен игнорируется", async () => {
    const m = createConfirmManager(win);
    const p = m.ask(req, async () => "ok");
    await flush();
    expect(await m.answer("deadbeef", { keyId: "k", password: "p" })).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(m.pending("deadbeef")).toBeUndefined();
    const t = tokenOf(win.opened[0]!.url);
    await m.answer(t, { keyId: "k", password: "p" });
    await p;
    expect(await m.answer(t, { keyId: "k", password: "p" })).toEqual({ ok: false, code: "NOT_FOUND" });
  });
});

describe("makePreview / describeItems", () => {
  it("текст — превью, не больше 2000 символов", () => {
    expect(makePreview(new TextEncoder().encode("Договор\nстрока\t2"))!.text).toBe("Договор\nстрока\t2");
    expect(makePreview(new TextEncoder().encode("я".repeat(3000)))!.text.length).toBe(2000);
  });
  it("бинарные данные и управляющие символы — без превью", () => {
    expect(makePreview(new Uint8Array([0xff, 0xfe, 0x00]))).toBeUndefined();
    expect(makePreview(new TextEncoder().encode("a\u0000b"))).toBeUndefined();
    expect(makePreview(new TextEncoder().encode("a" + String.fromCharCode(0x202e) + "b"))).toBeUndefined();
  });
  it("describeItems: размер и SHA-256", async () => {
    const [d] = await describeItems([new TextEncoder().encode("abc")]);
    expect(d).toEqual({ size: 3, sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", preview: { text: "abc", truncated: false, total: 3 } });
  });
});
