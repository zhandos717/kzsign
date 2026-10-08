import { it, expect } from "vitest";
import { createTrustedSites } from "../../src/sw/trusted-sites";
import type { Storage } from "../../src/sw/keystore";

const mem = (): Storage => {
  const m = new Map<string, unknown>();
  return { get: async (k) => structuredClone(m.get(k)), set: async (k, v) => { m.set(k, structuredClone(v)); }, remove: async (k) => { m.delete(k); }, keys: async () => [...m.keys()] };
};

it("сайт неизвестен → запомнили → известен; удаление; только http(s) origin", async () => {
  const t = createTrustedSites(mem(), () => 5);
  expect(await t.has("https://egov.kz")).toBe(false);
  await t.add("https://egov.kz");
  await t.add("https://egov.kz");
  expect(await t.has("https://egov.kz")).toBe(true);
  expect(await t.has("https://evil-egov.kz")).toBe(false);
  expect(await t.list()).toEqual([{ origin: "https://egov.kz", since: 5 }]);
  await t.add("javascript:alert(1)");
  await t.add("https://a.kz/path?x");
  expect((await t.list()).map((s) => s.origin)).toEqual(["https://egov.kz"]);
  await t.remove("https://egov.kz");
  expect(await t.list()).toEqual([]);
});
