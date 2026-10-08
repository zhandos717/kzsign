import type { BridgeToShim, ShimToBridge } from "../page/ws-shim";
import { PORT_NAME } from "../sw/router";

export function installBridge(win: Window, runtime: typeof chrome.runtime): void {
  win.addEventListener("message", (e: MessageEvent) => {
    if (e.source !== win || e.data?.__kzsign !== "hello" || !e.ports[0]) return;
    serve(e.ports[0], runtime);
  });
}

function serve(shim: MessagePort, runtime: typeof chrome.runtime): void {
  const sockets = new Map<string, chrome.runtime.Port>();
  shim.onmessage = (e: MessageEvent<ShimToBridge>) => {
    const m = e.data;
    if (!m || typeof m.id !== "string") return;
    if (m.kind === "open") {
      if (sockets.has(m.id)) return;
      const port = runtime.connect({ name: PORT_NAME });
      sockets.set(m.id, port);
      port.onMessage.addListener((r: { kind: string; text: string }) => {
        if (r?.kind === "message") shim.postMessage({ id: m.id, kind: "message", text: r.text } satisfies BridgeToShim);
      });
      port.onDisconnect.addListener(() => {
        sockets.delete(m.id);
        shim.postMessage({ id: m.id, kind: "closed", code: 1006 } satisfies BridgeToShim);
      });
    } else if (m.kind === "send") {
      sockets.get(m.id)?.postMessage({ kind: "send", text: m.text });
    } else if (m.kind === "close") {
      const port = sockets.get(m.id);
      sockets.delete(m.id);
      port?.postMessage({ kind: "close" });
      port?.disconnect();
    }
  };
}
