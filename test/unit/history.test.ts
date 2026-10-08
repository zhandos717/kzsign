import { describe, it, expect } from "vitest";
import { createHistory, type HistoryInput } from "../../src/sw/history";
import type { Storage } from "../../src/sw/keystore";

function mem(): Storage & { m: Map<string, unknown> } {
  const m = new Map<string, unknown>();
  return { m, get: async (k) => structuredClone(m.get(k)), set: async (k, v) => { m.set(k, structuredClone(v)); }, remove: async (k) => { m.delete(k); }, keys: async () => [...m.keys()] };
}
const entry = (o: Partial<HistoryInput> = {}): HistoryInput => ({ source: "site", origin: "https://a.kz", status: "signed", tsa: false, key: { alias: "ТЕСТОВ", iin: "123456789011" }, items: [{ size: 3, sha256: "ab", isHash: false, text: "abc" }], ...o });

describe("history", () => {
  it("новые сверху, со временем и id", async () => {
    let t = 1000;
    const h = createHistory(mem(), () => t);
    await h.add(entry({ origin: "https://a.kz" }));
    t = 2000;
    await h.add(entry({ origin: "https://b.kz" }));
    const list = await h.list();
    expect(list.map((e) => e.origin)).toEqual(["https://b.kz", "https://a.kz"]);
    expect(list[0]!.at).toBe(2000);
    expect(list[0]!.id).not.toBe(list[1]!.id);
  });

  it("хранит не больше 500 записей", async () => {
    const h = createHistory(mem());
    for (let i = 0; i < 505; i++) await h.add(entry({ origin: `https://s${i}.kz` }));
    const list = await h.list();
    expect(list).toHaveLength(500);
    expect(list[0]!.origin).toBe("https://s504.kz");
  });

  it("текст обрезается до 200 символов, бинарное — без текста", async () => {
    const h = createHistory(mem());
    await h.add(entry({ items: [{ size: 900, sha256: "x", isHash: false, text: "я".repeat(900) }, { size: 5, sha256: "y", isHash: true }] }));
    const [e] = await h.list();
    expect(e!.items[0]!.text).toHaveLength(200);
    expect(e!.items[1]!.text).toBeUndefined();
  });

  it("поиск по сайту, ИИН, имени файла", async () => {
    const h = createHistory(mem());
    await h.add(entry({ origin: "https://egov.kz" }));
    await h.add(entry({ source: "file", origin: undefined, fileName: "договор.pdf" }));
    expect((await h.list("egov")).map((e) => e.origin)).toEqual(["https://egov.kz"]);
    expect((await h.list("ДОГОВОР"))[0]!.fileName).toBe("договор.pdf");
    expect(await h.list("123456789011")).toHaveLength(2);
  });

  it("удаление записи и очистка", async () => {
    const s = mem();
    const h = createHistory(s);
    await h.add(entry());
    await h.add(entry());
    const [first] = await h.list();
    await h.remove(first!.id);
    expect(await h.list()).toHaveLength(1);
    await h.clear();
    expect(await h.list()).toEqual([]);
  });

  it("в хранилище нет поля с подписью или документом целиком", async () => {
    const s = mem();
    const h = createHistory(s);
    await h.add({ ...entry(), cms: new Uint8Array(10), data: new Uint8Array(10) } as unknown as HistoryInput);
    const raw = JSON.stringify([...s.m.values()]);
    expect(raw).not.toMatch(/"cms"|"data"/);
  });
});
