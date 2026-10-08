import { installShim } from "../page/ws-shim";

// Канал создаётся лениво: к первому new WebSocket() bridge уже слушает
installShim(window, () => {
  const ch = new MessageChannel();
  window.postMessage({ __kzsign: "hello" }, location.origin === "null" ? "*" : location.origin, [ch.port2]);
  return ch.port1;
});
