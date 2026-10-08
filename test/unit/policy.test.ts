import { describe, it, expect, vi, afterEach } from "vitest";
import { decide, createNativeProxy, type WebSocketLike } from "../../src/sw/policy";

afterEach(() => vi.useRealTimers());

class FakeWs implements WebSocketLike {
  static instances: FakeWs[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  closed = false;
  constructor(public url: string) { FakeWs.instances.push(this); }
  send(t: string) { this.sent.push(t); }
  close() { this.closed = true; }
}

describe("decide", () => {
  const alive = (v: boolean) => vi.fn(async () => v);
  it("extension — без проверки native", async () => {
    const a = alive(true);
    expect(await decide("extension", false, a)).toBe("extension");
    expect(a).not.toHaveBeenCalled();
  });
  it("native", async () => expect(await decide("native", true, alive(false))).toBe("native"));
  it("auto + ключи → extension", async () => expect(await decide("auto", true, alive(true))).toBe("extension"));
  it("auto без ключей, native жив → native", async () => expect(await decide("auto", false, alive(true))).toBe("native"));
  it("auto без ключей, native мёртв → extension", async () => expect(await decide("auto", false, alive(false))).toBe("extension"));
});

describe("native proxy", () => {
  it("alive: открылся → true, сокет закрыт, кэш 60 с", async () => {
    FakeWs.instances = [];
    const p = createNativeProxy((u) => new FakeWs(u));
    const r = p.alive();
    FakeWs.instances[0]!.onopen!();
    expect(await r).toBe(true);
    expect(FakeWs.instances[0]!.closed).toBe(true);
    expect(await p.alive()).toBe(true);
    expect(FakeWs.instances).toHaveLength(1);
  });

  it("alive: wss не отвечает, ws ошибка → false за 1.5 с", async () => {
    vi.useFakeTimers();
    FakeWs.instances = [];
    const p = createNativeProxy((u) => new FakeWs(u));
    const r = p.alive();
    await vi.advanceTimersByTimeAsync(1500);
    FakeWs.instances[1]?.onerror?.();
    await vi.advanceTimersByTimeAsync(1500);
    expect(await r).toBe(false);
    expect(FakeWs.instances[0]!.url).toBe("wss://127.0.0.1:13579/");
  });

  it("connect пересылает кадры в обе стороны и close", async () => {
    FakeWs.instances = [];
    const p = createNativeProxy((u) => new FakeWs(u));
    const got: string[] = [];
    let closedWith = 0;
    const c = p.connect((t) => got.push(t), (code) => { closedWith = code; });
    c.send("early");
    const ws = FakeWs.instances[0]!;
    ws.onopen!();
    expect(ws.sent).toEqual(["early"]);
    ws.onmessage!({ data: "hello" });
    expect(got).toEqual(["hello"]);
    ws.onclose!({ code: 1006 });
    expect(closedWith).toBe(1006);
    c.close();
    expect(ws.closed).toBe(true);
  });
});
