import type { createKeystore, Storage } from "./keystore";
import type { Mode } from "./policy";
import { signCms } from "../core/signer";
import { wipe } from "../core/p12";
import { KzSignError } from "../core/errors";
import { toBase64 } from "./proto";
import { openKey } from "./handler";
import type { createSessionKeys } from "./session-keys";
import type { createHistory } from "./history";
import type { createTrustedSites } from "./trusted-sites";
import { keyLabel } from "./handler";
import { describeItems } from "./confirm-manager";

const MODES: Mode[] = ["auto", "extension", "native"];

function fromB64(s: unknown): Uint8Array | null {
  if (typeof s !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) return null;
  try {
    return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export async function handlePopupMessage(
  msg: unknown,
  deps: {
    keystore: ReturnType<typeof createKeystore>;
    storage: Storage;
    sessionKeys?: ReturnType<typeof createSessionKeys>;
    history?: ReturnType<typeof createHistory>;
    trusted?: ReturnType<typeof createTrustedSites>;
  },
): Promise<unknown> {
  const m = (msg ?? {}) as Record<string, unknown>;
  const { keystore, storage } = deps;
  try {
    switch (m.type) {
      case "keys.list":
        return { keys: await keystore.list(), open: (await deps.sessionKeys?.ids()) ?? [] };
      case "keys.forget":
        await deps.sessionKeys?.forget(typeof m.id === "string" ? m.id : undefined);
        return { ok: true };
      case "keys.import": {
        const file = fromB64(m.file);
        if (!file || typeof m.password !== "string") return { error: "BAD_REQUEST" };
        return { key: await keystore.importP12(file, m.password, typeof m.alias === "string" ? m.alias : undefined) };
      }
      case "keys.remove":
        if (typeof m.id !== "string") return { error: "BAD_REQUEST" };
        await keystore.remove(m.id);
        await deps.sessionKeys?.forget(m.id);
        return { ok: true };
      case "mode.get":
        return { mode: ((await storage.get("kzsign.mode")) as Mode | undefined) ?? "auto" };
      case "mode.set":
        if (!MODES.includes(m.mode as Mode)) return { error: "BAD_REQUEST" };
        await storage.set("kzsign.mode", m.mode);
        return { ok: true };
      case "file.sign": {
        const file = fromB64(m.file);
        if (!file || typeof m.keyId !== "string") return { error: "BAD_REQUEST" };
        const [item] = await describeItems([file]);
        const key = await keyLabel(deps, m.keyId);
        const record = (status: "signed" | "error", errorCode?: string) =>
          deps.history
            ?.add({
              source: "file",
              fileName: typeof m.fileName === "string" ? m.fileName.slice(0, 255) : undefined,
              status,
              errorCode,
              tsa: false,
              key,
              items: [{ size: item!.size, sha256: item!.sha256, isHash: false, text: item!.preview?.text }],
            })
            .catch(() => {});
        try {
          const parsed = await openKey(deps, m.keyId, typeof m.password === "string" && m.password !== "" ? m.password : undefined);
          try {
            const cms = toBase64(await signCms(file, parsed, { detached: m.detached === true }));
            await record("signed");
            return { cms };
          } finally {
            wipe(parsed);
          }
        } catch (e) {
          await record("error", e instanceof KzSignError ? e.code : "SIGN_ERROR");
          throw e;
        }
      }
      case "history.list":
        return { entries: (await deps.history?.list(typeof m.query === "string" ? m.query : "")) ?? [] };
      case "history.remove":
        if (typeof m.id !== "string") return { error: "BAD_REQUEST" };
        await deps.history?.remove(m.id);
        return { ok: true };
      case "sites.list":
        return { sites: (await deps.trusted?.list()) ?? [] };
      case "sites.remove":
        if (typeof m.origin !== "string") return { error: "BAD_REQUEST" };
        await deps.trusted?.remove(m.origin);
        return { ok: true };
      case "history.clear":
        await deps.history?.clear();
        return { ok: true };
      default:
        return { error: "UNKNOWN" };
    }
  } catch (e) {
    if (e instanceof KzSignError) return { error: e.code, ...(e.retryAfterSec ? { retryAfterSec: e.retryAfterSec } : {}) };
    return { error: "INTERNAL" };
  }
}
