import type { Storage } from "./keystore";
import type { WindowsApi } from "./confirm-manager";
import type { WebSocketLike } from "./policy";
import { confirmWindowBounds } from "./window-bounds";

export const chromeStorage = (area: chrome.storage.StorageArea): Storage => ({
  get: async (k) => (await area.get(k))[k],
  set: (k, v) => area.set({ [k]: v }),
  remove: (k) => area.remove(k),
  keys: async () => Object.keys(await area.get(null)),
});

export const chromeWindows = (): WindowsApi => ({
  async open(url) {
    const parent = await chrome.windows.getLastFocused().catch(() => undefined);
    const base = { url: chrome.runtime.getURL(url), type: "popup" as const, focused: true };
    const bounds = confirmWindowBounds(parent);
    // Chrome отклоняет координаты, если окно больше чем наполовину вне экрана (несколько мониторов) — тогда без них
    const created = await chrome.windows
      .create({ ...base, ...bounds })
      .catch(() => chrome.windows.create({ ...base, width: bounds.width, height: bounds.height }));
    // на macOS окно наследует полноэкранный режим родителя, если не вернуть его явно в обычный
    if (created?.id !== undefined && created.state !== "normal") await chrome.windows.update(created.id, { state: "normal" }).catch(() => {});
    return created?.id ?? -1;
  },
  close: (id) => chrome.windows.remove(id),
  onRemoved: (cb) => chrome.windows.onRemoved.addListener(cb),
});

export const openWebSocket = (url: string) => new WebSocket(url) as unknown as WebSocketLike;

// Сообщения от страниц самого расширения (окно подтверждения, popup); content scripts сюда не допускаются
export function isOwnPage(sender: chrome.runtime.MessageSender, page: string): boolean {
  return sender.id === chrome.runtime.id && !sender.tab?.url?.startsWith("http") && (sender.url ?? "").startsWith(chrome.runtime.getURL(page));
}
