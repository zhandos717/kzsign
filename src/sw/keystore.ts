import { parseP12, wipe, type KeyAlgorithm, type ParsedP12 } from "../core/p12";
import { KzSignError } from "../core/errors";
import { certInfo } from "../core/cert-info";
import { toBase64 } from "./proto";

export interface KeyMeta {
  id: string;
  alias: string;
  algorithm: KeyAlgorithm;
  subjectCn: string;
  iin?: string;
  bin?: string;
  notAfter: string;
  fingerprint: string;
}
export interface Storage {
  get(k: string): Promise<unknown>;
  set(k: string, v: unknown): Promise<void>;
  remove(k: string): Promise<void>;
  keys(): Promise<string[]>;
}
interface Record_ {
  meta: KeyMeta;
  salt: string;
  iv: string;
  ct: string;
  verifier: string;
}
interface PinState {
  fails: number;
  until: number;
}

const KEY = "kzsign.key.";
const PIN = "kzsign.pin.";
const FREE_ATTEMPTS = 5;
const MAX_DELAY_SEC = 900;

const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const ab = (b: Uint8Array) => new Uint8Array(b) as Uint8Array<ArrayBuffer>;
const hexOf = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

// 64 байта из PBKDF2: первые 32 — ключ AES-GCM, вторые 32 — проверка пароля (отличаем неверный пароль от порчи данных)
async function derive(password: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: ab(salt), iterations }, base, 512));
  const aes = await crypto.subtle.importKey("raw", bits.subarray(0, 32), "AES-GCM", false, ["encrypt", "decrypt"]);
  const verifier = hexOf(await crypto.subtle.digest("SHA-256", bits.subarray(32)));
  bits.fill(0);
  return { aes, verifier };
}

export function createKeystore(storage: Storage, opts: { iterations?: number; now?: () => number } = {}) {
  const iterations = opts.iterations ?? 600_000;
  const now = opts.now ?? Date.now;
  // попытки по одному ключу строго по очереди: иначе параллельные unlock читают один и тот же счётчик неудач
  const locks = new Map<string, Promise<unknown>>();
  const serial = <T>(id: string, fn: () => Promise<T>): Promise<T> => {
    const run = (locks.get(id) ?? Promise.resolve()).then(fn, fn);
    locks.set(id, run.catch(() => {}));
    return run;
  };

  async function load(id: string): Promise<Record_> {
    const rec = (await storage.get(KEY + id)) as Record_ | undefined;
    if (!rec) throw new KzSignError("NOT_FOUND", "ключ не найден");
    return rec;
  }

  async function checkLock(id: string) {
    const s = ((await storage.get(PIN + id)) as PinState | undefined) ?? { fails: 0, until: 0 };
    if (now() < s.until) throw new KzSignError("PIN_LOCKED", "слишком много попыток", Math.ceil((s.until - now()) / 1000));
    return s;
  }

  async function registerFail(id: string, s: PinState) {
    const fails = s.fails + 1;
    const delay = fails >= FREE_ATTEMPTS ? Math.min(MAX_DELAY_SEC, 2 ** (fails - FREE_ATTEMPTS)) : 0;
    await storage.set(PIN + id, { fails, until: delay ? now() + delay * 1000 : 0 });
  }

  return {
    async importP12(file: Uint8Array, password: string, alias?: string): Promise<KeyMeta> {
      const parsed = parseP12(file, password);
      try {
        const info = certInfo(parsed.certificateDer);
        const fingerprint = hexOf(await crypto.subtle.digest("SHA-256", ab(parsed.certificateDer)));
        const id = fingerprint.slice(0, 16);
        const meta: KeyMeta = { id, alias: alias || info.subjectCn, algorithm: parsed.algorithm, subjectCn: info.subjectCn, iin: info.iin, bin: info.bin, notAfter: info.notAfter, fingerprint };
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const { aes, verifier } = await derive(password, salt, iterations);
        const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, ab(file)));
        await storage.set(KEY + id, { meta, salt: toBase64(salt), iv: toBase64(iv), ct: toBase64(ct), verifier } satisfies Record_);
        return meta;
      } finally {
        wipe(parsed);
      }
    },

    async list(): Promise<KeyMeta[]> {
      const ids = (await storage.keys()).filter((k) => k.startsWith(KEY));
      const recs = await Promise.all(ids.map((k) => storage.get(k) as Promise<Record_>));
      return recs.map((r) => r.meta);
    },

    async remove(id: string): Promise<void> {
      await storage.remove(KEY + id);
      await storage.remove(PIN + id);
    },

    unlock(id: string, password: string): Promise<ParsedP12> {
      return serial(id, () => unlockNow(id, password));
    },
  };

  async function unlockNow(id: string, password: string): Promise<ParsedP12> {
      const rec = await load(id);
      const pin = await checkLock(id);
      const { aes, verifier } = await derive(password, fromB64(rec.salt), iterations);
      if (verifier !== rec.verifier) {
        await registerFail(id, pin);
        throw new KzSignError("BAD_PASSWORD", "неверный пароль");
      }
      let file: Uint8Array;
      try {
        file = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: ab(fromB64(rec.iv)) }, aes, ab(fromB64(rec.ct))));
      } catch {
        throw new KzSignError("MALFORMED_P12", "хранилище повреждено");
      }
      await storage.remove(PIN + id);
      try {
        return parseP12(file, password);
      } finally {
        file.fill(0);
      }
  }
}
