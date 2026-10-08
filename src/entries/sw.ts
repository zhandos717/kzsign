import { attachRouter } from "../sw/router";
import { createSessionFactory } from "../sw/handler";
import { createKeystore } from "../sw/keystore";
import { createConfirmManager, type Answer } from "../sw/confirm-manager";
import { createNativeProxy, type Mode } from "../sw/policy";
import { httpTsp } from "../core/tsp";
import { chromeStorage, chromeWindows, openWebSocket, isOwnPage } from "../sw/chrome-adapters";
import { handlePopupMessage } from "../sw/popup-actions";

const storage = chromeStorage(chrome.storage.local);
const keystore = createKeystore(storage);
const confirm = createConfirmManager(chromeWindows());
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
      if (msg.type === "confirm.get") return { req: confirm.pending(msg.token), keys: await keystore.list() };
      if (msg.type === "confirm.answer") return confirm.answer(String(msg.token), msg.answer as Answer);
    }
    if (isOwnPage(sender, "popup.html")) return handlePopupMessage(msg, { keystore, storage });
    return { error: "FORBIDDEN" };
  };
  run().then(reply, () => reply({ error: "INTERNAL" }));
  return true;
});
