import type { Storage } from "./keystore";

// Сайты, которые пользователь отметил как знакомые: на них окно не предупреждает «видим впервые».
// Подписывать без подтверждения это не разрешает.
const KEY = "kzsign.trusted";

export interface TrustedSite {
  origin: string;
  since: number;
}

const isOrigin = (o: string) => {
  try {
    const u = new URL(o);
    return (u.protocol === "https:" || u.protocol === "http:") && u.origin === o;
  } catch {
    return false;
  }
};

export function createTrustedSites(storage: Storage, now: () => number = Date.now) {
  const load = async () => ((await storage.get(KEY)) as TrustedSite[] | undefined) ?? [];
  return {
    async has(origin: string) {
      return (await load()).some((s) => s.origin === origin);
    },
    async add(origin: string) {
      const list = await load();
      if (!isOrigin(origin) || list.some((s) => s.origin === origin)) return;
      await storage.set(KEY, [...list, { origin, since: now() }]);
    },
    async remove(origin: string) {
      await storage.set(KEY, (await load()).filter((s) => s.origin !== origin));
    },
    list: load,
  };
}
