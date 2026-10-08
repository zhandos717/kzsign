import { HELLO } from "../sw/proto";

const INSTALLED = Symbol.for("kzsign.shim");
const NCA_HOSTS = new Set(["127.0.0.1", "localhost"]);

export type ShimToBridge = { id: string; kind: "open" | "close" } | { id: string; kind: "send"; text: string };
export type BridgeToShim = { id: string; kind: "message"; text: string } | { id: string; kind: "closed"; code: number };

function isNcaLayer(url: string, base: string): boolean {
  try {
    const u = new URL(url, base);
    return (u.protocol === "ws:" || u.protocol === "wss:") && NCA_HOSTS.has(u.hostname) && u.port === "13579";
  } catch {
    return false;
  }
}

export function installShim(win: Window, connect: () => MessagePort): void {
  const w = win as Window & { [INSTALLED]?: boolean; WebSocket: typeof WebSocket };
  if (w[INSTALLED]) return;
  w[INSTALLED] = true;

  const Native = w.WebSocket;
  const sockets = new Map<string, Fake>();
  let port: MessagePort | null = null;

  const channel = () => {
    if (!port) {
      port = connect();
      port.onmessage = (e: MessageEvent<BridgeToShim>) => {
        const s = sockets.get(e.data?.id);
        if (!s) return;
        if (e.data.kind === "message") s._message(e.data.text);
        else if (e.data.kind === "closed") s._closed(e.data.code);
      };
    }
    return port;
  };

  // Свой реестр слушателей: поведение EventTarget с on*-свойствами различается между окружениями
  class Listeners {
    private readonly map = new Map<string, Set<EventListenerOrEventListenerObject>>();
    addEventListener(type: string, fn: EventListenerOrEventListenerObject | null): void {
      if (!fn) return;
      if (!this.map.has(type)) this.map.set(type, new Set());
      this.map.get(type)!.add(fn);
    }
    removeEventListener(type: string, fn: EventListenerOrEventListenerObject | null): void {
      if (fn) this.map.get(type)?.delete(fn);
    }
    dispatchEvent(e: Event): boolean {
      for (const fn of [...(this.map.get(e.type) ?? [])]) {
        try {
          if (typeof fn === "function") fn.call(this, e);
          else fn.handleEvent(e);
        } catch (err) {
          queueMicrotask(() => { throw err; });
        }
      }
      return true;
    }
  }

  class Fake extends Listeners {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSING = 2;
    readonly CLOSED = 3;

    readonly url!: string;
    readonly protocol = "";
    readonly extensions = "";
    binaryType: BinaryType = "blob";
    bufferedAmount = 0;
    readyState = 0;
    private readonly handlers = new Map<string, EventListener>();
    private readonly id = crypto.randomUUID();

    constructor(url: string | URL, protocols?: string | string[]) {
      const href = String(url);
      if (!isNcaLayer(href, w.location?.href ?? "http://localhost/")) {
        return new Native(href, protocols) as unknown as Fake;
      }
      super();
      this.url = href;
      sockets.set(this.id, this);
      queueMicrotask(() => {
        channel().postMessage({ id: this.id, kind: "open" } satisfies ShimToBridge);
        this.readyState = 1;
        this.fire("open", new Event("open"));
        this._message(HELLO);
      });
    }

    send(data: string): void {
      if (this.readyState !== 1) throw new DOMException("WebSocket is not open", "InvalidStateError");
      channel().postMessage({ id: this.id, kind: "send", text: String(data) } satisfies ShimToBridge);
    }

    close(): void {
      if (this.readyState >= 2) return;
      channel().postMessage({ id: this.id, kind: "close" } satisfies ShimToBridge);
      this._closed(1000);
    }

    _message(text: string): void {
      if (this.readyState !== 1) return;
      this.fire("message", new MessageEvent("message", { data: text, origin: new URL(this.url).origin }));
    }

    _closed(code: number): void {
      if (this.readyState === 3) return;
      this.readyState = 3;
      sockets.delete(this.id);
      const e = new Event("close");
      Object.defineProperties(e, { code: { value: code }, wasClean: { value: code === 1000 }, reason: { value: "" } });
      this.fire("close", e);
    }

    private fire(_type: "open" | "message" | "close" | "error", e: Event): void {
      this.dispatchEvent(e);
    }

    // on* как у настоящего WebSocket: присваивание заменяет слушателя, а не добавляет второй
    private setHandler(type: string, fn: unknown): void {
      const old = this.handlers.get(type);
      if (old) this.removeEventListener(type, old);
      this.handlers.delete(type);
      if (typeof fn === "function") {
        this.handlers.set(type, fn as EventListener);
        this.addEventListener(type, fn as EventListener);
      }
    }
    get onopen() { return this.handlers.get("open") ?? null; }
    set onopen(fn) { this.setHandler("open", fn); }
    get onmessage() { return this.handlers.get("message") ?? null; }
    set onmessage(fn) { this.setHandler("message", fn); }
    get onclose() { return this.handlers.get("close") ?? null; }
    set onclose(fn) { this.setHandler("close", fn); }
    get onerror() { return this.handlers.get("error") ?? null; }
    set onerror(fn) { this.setHandler("error", fn); }

    static [Symbol.hasInstance](x: unknown): boolean {
      return Function.prototype[Symbol.hasInstance].call(Fake, x) || x instanceof Native;
    }
  }

  w.WebSocket = Fake as unknown as typeof WebSocket;
}
