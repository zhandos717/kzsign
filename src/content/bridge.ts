import type { BridgeToShim, ShimToBridge } from "../page/ws-shim";
import { PORT_NAME } from "../sw/router";

const HOST_TAG = "kzsign-confirm";
let overlay: { host: HTMLElement; watcher: MutationObserver; port: chrome.runtime.Port } | null = null;

const important = (css: Record<string, string>) => Object.entries(css).map(([k, v]) => `${k}:${v} !important`).join(";");

// Окно подтверждения — iframe расширения (другой origin) в закрытом shadow root: скрипты страницы не видят ни токен в URL,
// ни содержимое окна; перекрытие и прозрачность ловит trackVisibility внутри самого iframe
function showConfirm(url: unknown, runtime: typeof chrome.runtime, port: chrome.runtime.Port): void {
  let u: URL;
  try {
    u = new URL(String(url));
  } catch {
    return;
  }
  if (u.protocol !== "chrome-extension:" || u.pathname !== "/confirm.html" || (runtime.id && u.host !== runtime.id)) return;
  hideConfirm();
  const host = document.createElement(HOST_TAG);
  host.setAttribute("style", important({ position: "fixed", inset: "0", "z-index": "2147483647", display: "flex", "align-items": "center", "justify-content": "center", background: "rgba(10,20,35,.45)", margin: "0", padding: "0", border: "0", opacity: "1", transform: "none", filter: "none", visibility: "visible", "pointer-events": "auto", cursor: "default" }));
  const root = host.attachShadow({ mode: "closed" });
  const frame = document.createElement("iframe");
  frame.src = u.href;
  frame.setAttribute("style", important({ width: "480px", height: "680px", "max-width": "calc(100vw - 24px)", "max-height": "calc(100vh - 24px)", border: "0", "border-radius": "14px", "box-shadow": "0 18px 50px rgba(0,0,0,.35)", background: "#fff", opacity: "1", transform: "none", filter: "none" }));
  frame.setAttribute("allow", "");
  root.append(frame);
  const parent = document.documentElement ?? document.body;
  parent.append(host);
  // страница может удалить оверлей, чтобы запрос висел невидимым — тогда SW покажет отдельное окно
  const watcher = new MutationObserver(() => {
    if (overlay?.host === host && !host.isConnected) {
      overlay.watcher.disconnect();
      overlay = null;
      try { port.postMessage({ kind: "confirm-gone" }); } catch { /* порт уже закрыт */ }
    }
  });
  watcher.observe(document, { childList: true, subtree: true });
  overlay = { host, watcher, port };
}

function hideConfirm(): void {
  if (!overlay) return;
  overlay.watcher.disconnect();
  overlay.host.remove();
  overlay = null;
}

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
      let port: chrome.runtime.Port;
      try {
        port = runtime.connect({ name: PORT_NAME });
      } catch {
        // расширение перезагрузили, а вкладку нет: старый content script отрезан от новой версии
        shim.postMessage({ id: m.id, kind: "closed", code: 1006 } satisfies BridgeToShim);
        return;
      }
      sockets.set(m.id, port);
      port.onMessage.addListener((r: { kind: string; text: string; action?: string; url?: string }) => {
        if (r?.kind === "message") shim.postMessage({ id: m.id, kind: "message", text: r.text } satisfies BridgeToShim);
        else if (r?.kind === "control" && r.action === "confirm-show") showConfirm(r.url, runtime, port);
        else if (r?.kind === "control" && r.action === "confirm-hide") hideConfirm();
      });
      port.onDisconnect.addListener(() => {
        hideConfirm();
        sockets.delete(m.id);
        shim.postMessage({ id: m.id, kind: "closed", code: 1006 } satisfies BridgeToShim);
      });
    } else if (m.kind === "send") {
      try {
        sockets.get(m.id)?.postMessage({ kind: "send", text: m.text });
      } catch {
        sockets.delete(m.id);
        shim.postMessage({ id: m.id, kind: "closed", code: 1006 } satisfies BridgeToShim);
      }
    } else if (m.kind === "close") {
      const port = sockets.get(m.id);
      sockets.delete(m.id);
      port?.postMessage({ kind: "close" });
      port?.disconnect();
    }
  };
}
