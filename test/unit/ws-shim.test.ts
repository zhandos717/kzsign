// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { installShim } from "../../src/page/ws-shim";
import { HELLO } from "../../src/sw/proto";

type Msg = { id: string; kind: string; text?: string; code?: number };
let bridge: MessagePort;
let received: Msg[];
let NativeWS: ReturnType<typeof vi.fn>;
let connects: number;

const tick = () => new Promise((r) => setTimeout(r, 10));

beforeEach(() => {
  received = [];
  connects = 0;
  NativeWS = vi.fn(function (this: any, url: string) { this.url = url; this.native = true; });
  const win = { WebSocket: NativeWS } as unknown as Window;
  installShim(win, () => {
    connects++;
    const ch = new MessageChannel();
    bridge = ch.port2;
    bridge.onmessage = (e) => received.push(e.data);
    return ch.port1;
  });
  (globalThis as any).WS = (win as any).WebSocket;
});

const WS = () => (globalThis as any).WS;
const reply = (m: Msg) => bridge.postMessage(m);

describe("ws-shim", () => {
  it("перехватывает NCALayer, шлёт open и HELLO", async () => {
    const ws = new (WS())("wss://127.0.0.1:13579/");
    const msgs: string[] = [];
    let opened = false;
    ws.onopen = () => { opened = true; };
    ws.addEventListener("message", (e: MessageEvent) => msgs.push(e.data));
    await tick();
    expect(opened).toBe(true);
    expect(ws.readyState).toBe(1);
    expect(msgs[0]).toBe(HELLO);
    expect(received[0]).toMatchObject({ kind: "open" });
  });

  it("send уходит в порт, ответ приходит в onmessage", async () => {
    const ws = new (WS())("ws://localhost:13579");
    const got: string[] = [];
    ws.onmessage = (e: MessageEvent) => got.push(e.data);
    await tick();
    ws.send("ping");
    await tick();
    const sent = received.find((m) => m.kind === "send")!;
    expect(sent.text).toBe("ping");
    reply({ id: sent.id, kind: "message", text: "pong" });
    await tick();
    expect(got).toEqual([HELLO, "pong"]);
  });

  it.each(["wss://example.com", "ws://127.0.0.1:1234", "wss://evil.kz/127.0.0.1:13579"])("не трогает %s", (url) => {
    const ws = new (WS())(url);
    expect(NativeWS).toHaveBeenCalledWith(url, undefined);
    expect(ws.native).toBe(true);
  });

  it("closed от bridge → readyState 3 и onclose с кодом", async () => {
    const ws = new (WS())("wss://127.0.0.1:13579");
    let code = 0;
    ws.onclose = (e: CloseEvent) => { code = e.code; };
    await tick();
    reply({ id: received[0]!.id, kind: "closed", code: 1006 });
    await tick();
    expect(ws.readyState).toBe(3);
    expect(code).toBe(1006);
  });

  it("после закрытия новый сокет работает через тот же канал", async () => {
    const a = new (WS())("wss://127.0.0.1:13579");
    await tick();
    reply({ id: received[0]!.id, kind: "closed", code: 1006 });
    await tick();
    const b = new (WS())("wss://127.0.0.1:13579");
    await tick();
    expect(b.readyState).toBe(1);
    expect(received.filter((m) => m.kind === "open")).toHaveLength(2);
    expect(connects).toBe(1);
    void a;
  });

  it("константы и instanceof", () => {
    const W = WS();
    expect(W.OPEN).toBe(1);
    expect(new W("wss://127.0.0.1:13579") instanceof W).toBe(true);
    expect(new W("wss://example.com") instanceof W).toBe(true);
  });

  it("close() со стороны сайта уходит в bridge", async () => {
    const ws = new (WS())("wss://127.0.0.1:13579");
    await tick();
    ws.close();
    await tick();
    expect(received.some((m) => m.kind === "close")).toBe(true);
    expect(ws.readyState).toBe(3);
  });
});
