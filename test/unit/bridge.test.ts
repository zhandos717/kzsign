// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
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

describe("оверлей подтверждения", () => {
  function setup() {
    const listeners: ((m: unknown) => void)[] = [];
    const port = { onMessage: { addListener: (f: (m: unknown) => void) => listeners.push(f) }, onDisconnect: { addListener: () => {} }, postMessage: () => {}, disconnect: () => {} };
    const runtime = { connect: () => port } as unknown as typeof chrome.runtime;
    installBridge(window, runtime);
    const ch = new MessageChannel();
    window.dispatchEvent(new MessageEvent("message", { data: { __kzsign: "hello" }, source: window, ports: [ch.port2] }));
    ch.port1.postMessage({ id: "s1", kind: "open" });
    return { send: (m: unknown) => listeners.forEach((f) => f(m)) };
  }

  it("confirm-show: оверлей в закрытом shadow root, iframe расширения, скрипты страницы до него не дотягиваются", async () => {
    const { send } = setup();
    await tick();
    send({ kind: "control", action: "confirm-show", url: "chrome-extension://abc/confirm.html#tok" });
    const host = document.querySelector("kzsign-confirm") as HTMLElement;
    expect(host).not.toBeNull();
    expect(host.shadowRoot).toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
    expect(host.getAttribute("style")).toContain("!important");
    send({ kind: "control", action: "confirm-hide" });
    expect(document.querySelector("kzsign-confirm")).toBeNull();
  });

  it("confirm-show с чужим URL игнорируется", async () => {
    const { send } = setup();
    await tick();
    send({ kind: "control", action: "confirm-show", url: "https://evil.kz/" });
    expect(document.querySelector("kzsign-confirm")).toBeNull();
  });
});

it("#3 страница удалила оверлей → мост сообщает SW (confirm-gone)", async () => {
  const listeners: ((m: unknown) => void)[] = [];
  const posted: unknown[] = [];
  const port = { onMessage: { addListener: (f: (m: unknown) => void) => listeners.push(f) }, onDisconnect: { addListener: () => {} }, postMessage: (m: unknown) => posted.push(m), disconnect: () => {} };
  installBridge(window, { connect: () => port } as unknown as typeof chrome.runtime);
  const ch = new MessageChannel();
  window.dispatchEvent(new MessageEvent("message", { data: { __kzsign: "hello" }, source: window, ports: [ch.port2] }));
  ch.port1.postMessage({ id: "s9", kind: "open" });
  await tick();
  listeners.forEach((f) => f({ kind: "control", action: "confirm-show", url: "chrome-extension://abc/confirm.html#t" }));
  document.querySelector("kzsign-confirm")!.remove();
  await tick();
  expect(posted).toContainEqual({ kind: "confirm-gone" });
});
