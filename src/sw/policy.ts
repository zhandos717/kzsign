export type Mode = "auto" | "extension" | "native";

export interface WebSocketLike {
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: ((e: { code: number }) => void) | null;
  onerror: (() => void) | null;
  send(t: string): void;
  close(): void;
}

export async function decide(mode: Mode, hasKeys: boolean, nativeAlive: () => Promise<boolean>): Promise<"extension" | "native"> {
  if (mode === "extension") return "extension";
  if (mode === "native") return "native";
  if (hasKeys) return "extension";
  return (await nativeAlive()) ? "native" : "extension";
}

const URLS = ["wss://127.0.0.1:13579/", "ws://127.0.0.1:13579/"];
const PROBE_TIMEOUT_MS = 1500;

function probe(open: (url: string) => WebSocketLike, url: string): Promise<boolean> {
  return new Promise((resolve) => {
    let ws: WebSocketLike;
    const done = (v: boolean) => {
      clearTimeout(timer);
      try { ws.close(); } catch { /* уже закрыт */ }
      resolve(v);
    };
    const timer = setTimeout(() => done(false), PROBE_TIMEOUT_MS);
    try {
      ws = open(url);
    } catch {
      clearTimeout(timer);
      resolve(false);
      return;
    }
    ws.onopen = () => done(true);
    ws.onerror = () => done(false);
    ws.onclose = () => done(false);
  });
}

export function createNativeProxy(open: (url: string) => WebSocketLike, ttlMs = 60_000, now = () => Date.now()) {
  let cache: { value: boolean; at: number } | null = null;
  let url = URLS[0]!;

  return {
    async alive(): Promise<boolean> {
      if (cache && now() - cache.at < ttlMs) return cache.value;
      let value = false;
      for (const u of URLS) {
        if (await probe(open, u)) {
          url = u;
          value = true;
          break;
        }
      }
      cache = { value, at: now() };
      return value;
    },

    connect(onMessage: (t: string) => void, onClose: (code: number) => void) {
      const ws = open(url);
      const backlog: string[] = [];
      let opened = false;
      ws.onopen = () => {
        opened = true;
        backlog.splice(0).forEach((t) => ws.send(t));
      };
      ws.onmessage = (e) => onMessage(String(e.data));
      ws.onclose = (e) => onClose(e.code);
      ws.onerror = () => {};
      return {
        send: (t: string) => (opened ? ws.send(t) : backlog.push(t)),
        close: () => ws.close(),
      };
    },
  };
}
