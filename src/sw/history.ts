import type { Storage } from "./keystore";

// Журнал подписей хранит только сведения: ни документы, ни сами подписи сюда не попадают.
const KEY = "kzsign.history";
const LIMIT = 500;
const TEXT_LIMIT = 200;

export interface HistoryItem {
  size: number;
  sha256: string;
  isHash: boolean;
  text?: string;
}
export interface HistoryInput {
  source: "site" | "file";
  origin?: string;
  fileName?: string;
  status: "signed" | "canceled" | "error";
  errorCode?: string;
  tsa: boolean;
  key?: { alias: string; iin?: string; bin?: string };
  items: HistoryItem[];
}
export interface HistoryEntry extends HistoryInput {
  id: string;
  at: number;
}

const pick = (e: HistoryInput): HistoryInput => ({
  source: e.source,
  origin: e.origin,
  fileName: e.fileName,
  status: e.status,
  errorCode: e.errorCode,
  tsa: e.tsa,
  key: e.key && { alias: e.key.alias, iin: e.key.iin, bin: e.key.bin },
  items: e.items.map((i) => ({ size: i.size, sha256: i.sha256, isHash: i.isHash, text: i.text?.slice(0, TEXT_LIMIT) })),
});

const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");

export function createHistory(storage: Storage, now: () => number = Date.now) {
  const load = async () => ((await storage.get(KEY)) as HistoryEntry[] | undefined) ?? [];
  // записи добавляются из параллельных запросов — сериализуем, чтобы не потерять ни одну
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>) => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  };

  return {
    add: (e: HistoryInput) =>
      serial(async () => {
        const list = await load();
        list.unshift({ ...pick(e), id: newId(), at: now() });
        await storage.set(KEY, list.slice(0, LIMIT));
      }),

    async list(query = ""): Promise<HistoryEntry[]> {
      const q = query.trim().toLowerCase();
      const list = await load();
      if (!q) return list;
      return list.filter((e) => [e.origin, e.fileName, e.key?.alias, e.key?.iin, e.key?.bin].some((v) => v?.toLowerCase().includes(q)));
    },

    remove: (id: string) => serial(async () => storage.set(KEY, (await load()).filter((e) => e.id !== id))),
    clear: () => serial(async () => storage.remove(KEY)),
  };
}
