import type { createConfirmManager, Answer, Caller } from "./confirm-manager";
import type { createKeystore } from "./keystore";
import type { createTrustedSites } from "./trusted-sites";
import type { createSessionKeys } from "./session-keys";
import { KzSignError } from "../core/errors";

export interface ConfirmDeps {
  confirm: ReturnType<typeof createConfirmManager>;
  keystore: ReturnType<typeof createKeystore>;
  trusted: ReturnType<typeof createTrustedSites>;
  sessionKeys?: ReturnType<typeof createSessionKeys>;
}

const fromB64 = (s: unknown): Uint8Array | null => {
  if (typeof s !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) return null;
  try {
    return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
};

// Сообщения окна подтверждения. Отправитель уже проверен (isOwnPage), токен и документ проверяет confirm-manager.
export async function handleConfirmMessage(msg: Record<string, unknown>, from: Caller, deps: ConfirmDeps): Promise<unknown> {
  const token = String(msg.token ?? "");
  switch (msg.type) {
    case "confirm.ping":
      return { ok: true };
    case "confirm.fallback":
      await deps.confirm.fallback(token, from);
      return { ok: true };
    case "confirm.get": {
      const req = deps.confirm.pending(token, from);
      return req ? { req, keys: await deps.keystore.list(), open: (await deps.sessionKeys?.ids()) ?? [] } : {};
    }
    case "confirm.answer": {
      const answer = msg.answer as Answer;
      const origin = deps.confirm.pending(token, from)?.origin;
      const r = await deps.confirm.answer(token, answer, from);
      if (r.ok && origin && "keyId" in answer && answer.trustSite) await deps.trusted.add(origin);
      return r;
    }
    case "confirm.import": {
      const req = deps.confirm.pending(token, from);
      if (!req) return { ok: false, code: "NOT_FOUND" };
      const file = fromB64(msg.file);
      if (!file || typeof msg.password !== "string") return { ok: false, code: "BAD_REQUEST" };
      try {
        const meta = await deps.keystore.importP12(file, msg.password, typeof msg.alias === "string" ? msg.alias : undefined);
        const r = await deps.confirm.answer(token, { keyId: meta.id, password: msg.password }, from);
        if (r.ok && msg.trustSite === true) await deps.trusted.add(req.origin);
        return r;
      } catch (e) {
        return { ok: false, code: e instanceof KzSignError ? e.code : "INTERNAL" };
      }
    }
    default:
      return { error: "UNKNOWN" };
  }
}
