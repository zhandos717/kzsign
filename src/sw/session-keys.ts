import type { ParsedP12 } from "../core/p12";
import type { Storage } from "./keystore";
import { toBase64 } from "./proto";

// Ключи, открытые паролем в этой сессии браузера. Хранилище — chrome.storage.session: только в памяти,
// очищается при закрытии Chrome, недоступно content scripts. Пароль не хранится — только расшифрованный ключ.
const PREFIX = "kzsign.open.";

interface Stored {
  algorithm: ParsedP12["algorithm"];
  pkcs8: string;
  cert: string;
  chain: string[];
}

const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function createSessionKeys(area: Storage) {
  return {
    async remember(keyId: string, key: ParsedP12): Promise<void> {
      await area.set(PREFIX + keyId, {
        algorithm: key.algorithm,
        pkcs8: toBase64(key.privateKeyPkcs8),
        cert: toBase64(key.certificateDer),
        chain: key.chainDer.map(toBase64),
      } satisfies Stored);
    },

    async get(keyId: string): Promise<ParsedP12 | null> {
      const s = (await area.get(PREFIX + keyId)) as Stored | undefined;
      if (!s) return null;
      return { algorithm: s.algorithm, privateKeyPkcs8: fromB64(s.pkcs8), certificateDer: fromB64(s.cert), chainDer: s.chain.map(fromB64) };
    },

    async ids(): Promise<string[]> {
      return (await area.keys()).filter((k) => k.startsWith(PREFIX)).map((k) => k.slice(PREFIX.length));
    },

    async forget(keyId?: string): Promise<void> {
      const ids = keyId ? [keyId] : await this.ids();
      await Promise.all(ids.map((id) => area.remove(PREFIX + id)));
    },
  };
}
