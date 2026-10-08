import { describe, it, expect, vi, afterEach } from "vitest";
import { createConfirmManager, type WindowsApi, type InlinePresenter } from "../../src/sw/confirm-manager";

afterEach(() => vi.useRealTimers());

function setup(inlineOk = true) {
  const win = { opened: [] as string[], closed: [] as number[] };
  const windows: WindowsApi = { open: async (u) => { win.opened.push(u); return win.opened.length; }, close: async (id) => { win.closed.push(id); }, onRemoved: () => {} };
  const inline = { shown: [] as string[], hidden: 0 };
  const presenter: InlinePresenter = async (url) => {
    if (!inlineOk) return null;
    inline.shown.push(url);
    return { close: () => { inline.hidden++; } };
  };
  const m = createConfirmManager(windows, 120_000, presenter);
  return { m, win, inline };
}

const req = { origin: "https://a.kz", operation: "sign" as const, items: [], isHash: false };
const flush = () => new Promise((r) => setTimeout(r, 0));
const tok = (u: string) => u.split("#")[1]!;

describe("окно подтверждения на странице", () => {
  it("показывается на странице, окно Chrome не открывается; ответ закрывает оверлей", async () => {
    const { m, win, inline } = setup();
    const p = m.ask(req, async () => "ok", { session: {} });
    await flush();
    expect(inline.shown).toHaveLength(1);
    expect(win.opened).toHaveLength(0);
    const t = tok(inline.shown[0]!);
    m.pending(t);
    await m.answer(t, { keyId: "k", password: "p" });
    expect(await p).toBe("ok");
    expect(inline.hidden).toBe(1);
  });

  it("iframe не загрузился за 2 с → отдельное окно с тем же токеном", async () => {
    vi.useFakeTimers();
    const { m, win, inline } = setup();
    void m.ask(req, async () => "ok", { session: {} });
    await vi.advanceTimersByTimeAsync(2001);
    expect(inline.hidden).toBe(1);
    expect(win.opened).toHaveLength(1);
    expect(tok(win.opened[0]!)).toBe(tok(inline.shown[0]!));
    expect(m.pending(tok(win.opened[0]!))).toEqual(req);
  });

  it("iframe загрузился (pending вызван) → окно не открывается", async () => {
    vi.useFakeTimers();
    const { m, win, inline } = setup();
    void m.ask(req, async () => "ok", { session: {} });
    await vi.advanceTimersByTimeAsync(10);
    m.pending(tok(inline.shown[0]!));
    await vi.advanceTimersByTimeAsync(3000);
    expect(win.opened).toHaveLength(0);
  });

  it("iframe сообщил, что не может проверить видимость → отдельное окно", async () => {
    const { m, win, inline } = setup();
    void m.ask(req, async () => "ok", { session: {} });
    await flush();
    const t = tok(inline.shown[0]!);
    m.pending(t);
    await m.fallback(t);
    expect(inline.hidden).toBe(1);
    expect(tok(win.opened[0]!)).toBe(t);
  });

  it("fallback с чужим токеном игнорируется", async () => {
    const { m, win } = setup();
    void m.ask(req, async () => "ok", { session: {} });
    await flush();
    await m.fallback("nope");
    expect(win.opened).toHaveLength(0);
  });

  it("презентер отказал (запрос из вложенного фрейма) → сразу окно", async () => {
    const { m, win } = setup(false);
    void m.ask(req, async () => "ok", { session: {} });
    await flush();
    expect(win.opened).toHaveLength(1);
  });
});

describe("ревью безопасности окна на странице", () => {
  const from = (documentId: string, tabId = 7) => ({ documentId, tabId });

  it("#4 токен привязывается к первому документу, запросившему его; чужой документ получает NOT_FOUND", async () => {
    const { m, inline } = setup();
    const p = m.ask(req, async () => "ok", { session: {}, tabId: 7 });
    await flush();
    const t = tok(inline.shown[0]!);
    expect(m.pending(t, from("doc-A"))).toEqual(req);
    expect(m.pending(t, from("doc-B"))).toBeUndefined();
    expect(await m.answer(t, { keyId: "k", password: "p" }, from("doc-B"))).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await m.answer(t, { keyId: "k", password: "p" }, from("doc-A"))).toEqual({ ok: true });
    expect(await p).toBe("ok");
  });

  it("#4 окно на странице может открыть только вкладка, запросившая подпись", async () => {
    const { m, inline } = setup();
    void m.ask(req, async () => "ok", { session: {}, tabId: 7 });
    await flush();
    expect(m.pending(tok(inline.shown[0]!), from("doc-X", 99))).toBeUndefined();
  });

  it("#4 после перехода в отдельное окно привязка сбрасывается (новый документ — окно расширения)", async () => {
    const { m, inline, win } = setup();
    void m.ask(req, async () => "ok", { session: {}, tabId: 7 });
    await flush();
    const t = tok(inline.shown[0]!);
    m.pending(t, from("doc-inline"));
    await m.fallback(t, from("doc-other"));
    expect(win.opened).toHaveLength(0);
    await m.fallback(t, from("doc-inline"));
    expect(win.opened).toHaveLength(1);
    expect(m.pending(t, from("doc-window", 123))).toEqual(req);
  });

  it("#3 страница удалила оверлей → отдельное окно", async () => {
    const { m, inline, win } = setup();
    const S = {};
    void m.ask(req, async () => "ok", { session: S, tabId: 7 });
    await flush();
    m.pending(tok(inline.shown[0]!), from("doc-A"));
    await m.fallbackSession(S);
    expect(win.opened).toHaveLength(1);
  });

  it("#3 не больше 2 запросов с одной вкладки", async () => {
    const { m } = setup();
    void m.ask(req, async () => 1, { session: {}, tabId: 7 });
    void m.ask(req, async () => 2, { session: {}, tabId: 7 });
    expect(await m.ask(req, async () => 3, { session: {}, tabId: 7 })).toBeNull();
  });
});
