import { attachRouter, type Session } from "../sw/router";
import { createSessionFactory } from "../sw/handler";
import { createKeystore } from "../sw/keystore";
import { createConfirmManager, type Answer } from "../sw/confirm-manager";
import { createNativeProxy, type Mode } from "../sw/policy";
import { httpTsp } from "../core/tsp";
import { chromeStorage, chromeWindows, openWebSocket, isOwnPage } from "../sw/chrome-adapters";
import { handlePopupMessage } from "../sw/popup-actions";

const storage = chromeStorage(chrome.storage.local);
const keystore = createKeystore(storage);
// Окно на странице — только в верхнем фрейме: во вложенном iframe его легко обрезать или спрятать
const confirm = createConfirmManager(chromeWindows(), 120_000, async (url, session) => {
  const s = session as Session | undefined;
  if (!s || s.frameId !== 0) return null;
  s.control({ action: "confirm-show", url: chrome.runtime.getURL(url) });
  return { close: () => s.control({ action: "confirm-hide" }) };
});
const getMode = async () => ((await storage.get("kzsign.mode")) as Mode | undefined) ?? "auto";

attachRouter(
  chrome.runtime.onConnect,
  createSessionFactory({ keystore, confirm, getMode, native: createNativeProxy(openWebSocket), tsp: httpTsp((...a) => fetch(...a)) }),
);

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const run = async () => {
    if (msg?.type?.startsWith("confirm.")) {
      if (!isOwnPage(sender, "confirm.html")) return { error: "FORBIDDEN" };
      if (msg.type === "confirm.ping") return { ok: true };
      const from = { documentId: (sender as { documentId?: string }).documentId, tabId: sender.tab?.id };
      if (msg.type === "confirm.fallback") return confirm.fallback(String(msg.token), from).then(() => ({ ok: true }));
      if (msg.type === "confirm.get") {
        const req = confirm.pending(String(msg.token), from);
        return req ? { req, keys: await keystore.list() } : {};
      }
      if (msg.type === "confirm.answer") return confirm.answer(String(msg.token), msg.answer as Answer, from);
    }
    if (isOwnPage(sender, "popup.html")) return handlePopupMessage(msg, { keystore, storage });
    return { error: "FORBIDDEN" };
  };
  run().then(reply, () => reply({ error: "INTERNAL" }));
  return true;
});
