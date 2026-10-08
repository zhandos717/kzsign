import { describe, it, expect, vi } from "vitest";
import { originOf, attachRouter, type Session } from "../../src/sw/router";

function fakePort(sender: Partial<chrome.runtime.MessageSender>) {
  const onMessage: ((m: unknown) => void)[] = [];
  const onDisconnect: (() => void)[] = [];
  const port = {
    name: "kzsign",
    sender,
    posted: [] as unknown[],
    disconnected: false,
    postMessage(m: unknown) { this.posted.push(m); },
    disconnect() { this.disconnected = true; },
    onMessage: { addListener: (f: (m: unknown) => void) => onMessage.push(f) },
    onDisconnect: { addListener: (f: () => void) => onDisconnect.push(f) },
    emit: (m: unknown) => onMessage.forEach((f) => f(m)),
    drop: () => onDisconnect.forEach((f) => f()),
  };
  return port;
}

function setup() {
  let connect!: (p: unknown) => void;
  const sessions: Session[] = [];
  const frames: [string, Session][] = [];
  const closed: Session[] = [];
  attachRouter({ addListener: (f: (p: unknown) => void) => { connect = f; } } as any, (s) => {
    sessions.push(s);
    return {
      onFrame: async (text) => { frames.push([text, s]); return text === "silent" ? null : `re:${text}`; },
      onClose: () => closed.push(s),
    };
  });
  return { connect: (p: ReturnType<typeof fakePort>) => connect(p), sessions, frames, closed };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("originOf", () => {
  it.each([
    [{ origin: "https://a.kz" }, "https://a.kz"],
    [{ url: "https://b.kz/x?y" }, "https://b.kz"],
    [{ origin: "http://localhost:8080" }, "http://localhost:8080"],
    [{ origin: "chrome-extension://abc" }, null],
    [{ url: "file:///etc/passwd" }, null],
    [{ origin: "null" }, null],
    [{}, null],
  ])("%j → %s", (s, o) => expect(originOf(s as chrome.runtime.MessageSender)).toBe(o));
});

describe("router", () => {
  it("origin фрейма, а не вкладки; поле origin в кадре игнорируется", async () => {
    const r = setup();
    const p = fakePort({ origin: "https://evil.kz", url: "https://evil.kz/f", tab: { id: 7, url: "https://good.kz" } as chrome.tabs.Tab, frameId: 3 });
    r.connect(p);
    p.emit({ kind: "send", text: '{"origin":"https://good.kz"}' });
    await flush();
    expect(r.sessions[0]).toMatchObject({ origin: "https://evil.kz", tabId: 7, frameId: 3 });
    expect(p.posted).toEqual([{ kind: "message", text: 're:{"origin":"https://good.kz"}' }]);
  });

  it("null от обработчика — ничего не отправляем", async () => {
    const r = setup();
    const p = fakePort({ origin: "https://a.kz" });
    r.connect(p);
    p.emit({ kind: "send", text: "silent" });
    await flush();
    expect(p.posted).toEqual([]);
  });

  it("порт без допустимого origin закрывается без сессии", () => {
    const r = setup();
    const p = fakePort({ origin: "chrome-extension://x" });
    r.connect(p);
    expect(p.disconnected).toBe(true);
    expect(r.sessions).toHaveLength(0);
  });

  it("чужое имя порта игнорируется", () => {
    const r = setup();
    const p = { ...fakePort({ origin: "https://a.kz" }), name: "other" };
    r.connect(p as any);
    expect(r.sessions).toHaveLength(0);
  });

  it("кадры не по схеме игнорируются, close и обрыв закрывают сессию", async () => {
    const r = setup();
    const p = fakePort({ origin: "https://a.kz" });
    r.connect(p);
    p.emit({ kind: "send", text: 42 });
    p.emit("junk");
    await flush();
    expect(r.frames).toHaveLength(0);
    p.emit({ kind: "close" });
    p.drop();
    expect(r.closed).toHaveLength(1);
  });

  it("session.send пушит асинхронные сообщения", () => {
    const r = setup();
    const p = fakePort({ origin: "https://a.kz" });
    r.connect(p);
    r.sessions[0]!.send("push");
    expect(p.posted).toEqual([{ kind: "message", text: "push" }]);
  });

  it("ответы сохраняют порядок запросов", async () => {
    let release!: () => void;
    let connect!: (p: unknown) => void;
    attachRouter({ addListener: (f: any) => { connect = f; } } as any, () => ({
      onFrame: async (t) => { if (t === "slow") await new Promise<void>((r) => { release = r; }); return t; },
      onClose: () => {},
    }));
    const p = fakePort({ origin: "https://a.kz" });
    connect(p);
    p.emit({ kind: "send", text: "slow" });
    p.emit({ kind: "send", text: "fast" });
    await flush();
    release();
    await flush();
    expect(p.posted.map((m: any) => m.text)).toEqual(["slow", "fast"]);
  });
});

describe("управляющие сообщения мосту", () => {
  it("session.control уходит в порт как kind:control", () => {
    let connect!: (p: unknown) => void;
    const sessions: Session[] = [];
    attachRouter({ addListener: (f: any) => { connect = f; } } as any, (s) => { sessions.push(s); return { onFrame: async () => null, onClose: () => {} }; });
    const p = fakePort({ origin: "https://a.kz", frameId: 0 });
    connect(p);
    sessions[0]!.control({ action: "confirm-show", url: "chrome-extension://x/confirm.html#t" });
    expect(p.posted).toEqual([{ kind: "control", action: "confirm-show", url: "chrome-extension://x/confirm.html#t" }]);
  });
});

it("confirm-gone от моста вызывает onConfirmGone", () => {
  let connect!: (p: unknown) => void;
  const gone = vi.fn();
  attachRouter({ addListener: (f: any) => { connect = f; } } as any, () => ({ onFrame: async () => null, onClose: () => {}, onConfirmGone: gone }));
  const p = fakePort({ origin: "https://a.kz" });
  connect(p);
  p.emit({ kind: "confirm-gone" });
  expect(gone).toHaveBeenCalled();
});
