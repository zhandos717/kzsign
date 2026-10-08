export interface Session {
  origin: string;
  tabId: number;
  frameId: number;
  send(text: string): void;
}
export interface SessionHandler {
  onFrame(text: string): Promise<string | null>;
  onClose(): void;
}
export type SessionFactory = (s: Session) => SessionHandler;

export const PORT_NAME = "kzsign";

export function originOf(sender: chrome.runtime.MessageSender): string | null {
  const raw = sender.origin ?? sender.url;
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}

type Frame = { kind: "send"; text: string } | { kind: "close" };
const isFrame = (m: unknown): m is Frame =>
  !!m && typeof m === "object" && (((m as Frame).kind === "send" && typeof (m as { text?: unknown }).text === "string") || (m as Frame).kind === "close");

export function attachRouter(onConnect: Pick<typeof chrome.runtime.onConnect, "addListener">, factory: SessionFactory): void {
  onConnect.addListener((port: chrome.runtime.Port) => {
    if (port.name !== PORT_NAME) return;
    const origin = port.sender ? originOf(port.sender) : null;
    if (!origin) {
      port.disconnect();
      return;
    }

    let alive = true;
    const post = (text: string) => { if (alive) port.postMessage({ kind: "message", text }); };
    const handler = factory({ origin, tabId: port.sender?.tab?.id ?? -1, frameId: port.sender?.frameId ?? -1, send: post });
    const close = () => {
      if (!alive) return;
      alive = false;
      handler.onClose();
    };

    // кадры одного сокета обрабатываются строго по очереди, как в настоящем NCALayer
    let queue = Promise.resolve();
    port.onMessage.addListener((m: unknown) => {
      if (!isFrame(m)) return;
      if (m.kind === "close") return close();
      queue = queue.then(async () => {
        const reply = await handler.onFrame(m.text).catch(() => null);
        if (reply !== null) post(reply);
      });
    });
    port.onDisconnect.addListener(close);
  });
}
