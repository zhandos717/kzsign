import type { Storage } from "./keystore";
import type { WindowsApi } from "./confirm-manager";
import type { WebSocketLike } from "./policy";

export const chromeStorage = (area: chrome.storage.StorageArea): Storage => ({
  get: async (k) => (await area.get(k))[k],
  set: (k, v) => area.set({ [k]: v }),
  remove: (k) => area.remove(k),
  keys: async () => Object.keys(await area.get(null)),
});

export const chromeWindows = (): WindowsApi => ({
  open: async (url) => (await chrome.windows.create({ url: chrome.runtime.getURL(url), type: "popup", width: 540, height: 680, focused: true }))?.id ?? -1,
  close: (id) => chrome.windows.remove(id),
  onRemoved: (cb) => chrome.windows.onRemoved.addListener(cb),
});

export const openWebSocket = (url: string) => new WebSocket(url) as unknown as WebSocketLike;

// Сообщения от страниц самого расширения (окно подтверждения, popup); content scripts сюда не допускаются
export function isOwnPage(sender: chrome.runtime.MessageSender, page: string): boolean {
  return sender.id === chrome.runtime.id && !sender.tab?.url?.startsWith("http") && (sender.url ?? "").startsWith(chrome.runtime.getURL(page));
}
