// @vitest-environment happy-dom
import { it, expect } from "vitest";
import { installBridge } from "../../src/content/bridge";

const tick = () => new Promise((r) => setTimeout(r, 10));

it("расширение перезагружено (контекст недействителен) → сайт получает closed, а не висит", async () => {
  const runtime = { connect: () => { throw new Error("Extension context invalidated."); } } as unknown as typeof chrome.runtime;
  installBridge(window, runtime);
  const ch = new MessageChannel();
  const got: unknown[] = [];
  ch.port1.onmessage = (e) => got.push(e.data);
  window.dispatchEvent(new MessageEvent("message", { data: { __kzsign: "hello" }, source: window, ports: [ch.port2] }));
  ch.port1.postMessage({ id: "s1", kind: "open" });
  await tick();
  expect(got).toEqual([{ id: "s1", kind: "closed", code: 1006 }]);
});
