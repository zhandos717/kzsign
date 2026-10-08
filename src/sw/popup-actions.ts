import type { createKeystore, Storage } from "./keystore";
import type { Mode } from "./policy";
import { signCms } from "../core/signer";
import { wipe } from "../core/p12";
import { KzSignError } from "../core/errors";
import { toBase64 } from "./proto";

const MODES: Mode[] = ["auto", "extension", "native"];

function fromB64(s: unknown): Uint8Array | null {
  if (typeof s !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) return null;
  try {
    return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export async function handlePopupMessage(msg: unknown, deps: { keystore: ReturnType<typeof createKeystore>; storage: Storage }): Promise<unknown> {
  const m = (msg ?? {}) as Record<string, unknown>;
  const { keystore, storage } = deps;
  try {
    switch (m.type) {
      case "keys.list":
        return { keys: await keystore.list() };
      case "keys.import": {
        const file = fromB64(m.file);
        if (!file || typeof m.password !== "string") return { error: "BAD_REQUEST" };
        return { key: await keystore.importP12(file, m.password, typeof m.alias === "string" ? m.alias : undefined) };
      }
      case "keys.remove":
        if (typeof m.id !== "string") return { error: "BAD_REQUEST" };
        await keystore.remove(m.id);
        return { ok: true };
      case "mode.get":
        return { mode: ((await storage.get("kzsign.mode")) as Mode | undefined) ?? "auto" };
      case "mode.set":
        if (!MODES.includes(m.mode as Mode)) return { error: "BAD_REQUEST" };
        await storage.set("kzsign.mode", m.mode);
        return { ok: true };
      case "file.sign": {
        const file = fromB64(m.file);
        if (!file || typeof m.keyId !== "string" || typeof m.password !== "string") return { error: "BAD_REQUEST" };
        const key = await keystore.unlock(m.keyId, m.password);
        try {
          return { cms: toBase64(await signCms(file, key, { detached: m.detached === true })) };
        } finally {
          wipe(key);
        }
      }
      default:
        return { error: "UNKNOWN" };
    }
  } catch (e) {
    if (e instanceof KzSignError) return { error: e.code, ...(e.retryAfterSec ? { retryAfterSec: e.retryAfterSec } : {}) };
    return { error: "INTERNAL" };
  }
}
