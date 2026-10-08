import { parseFrame, ok, fail, toBase64, type Request, type SignRequest } from "./proto";
import type { Session, SessionFactory } from "./router";
import type { createKeystore } from "./keystore";
import { describeItems, type ConfirmRequest, type AskOptions } from "./confirm-manager";
import { decide, type Mode } from "./policy";
import { signCms } from "../core/signer";
import { wipe, type ParsedP12 } from "../core/p12";
import { certInfo } from "../core/cert-info";
import { KzSignError } from "../core/errors";
import type { TspClient } from "../core/tsp";
import type { createSessionKeys } from "./session-keys";

export interface ConfirmLike {
  ask<T>(req: ConfirmRequest, verify: (keyId: string, password: string | undefined) => Promise<T>, opts?: AskOptions<T>): Promise<T | null>;
  cancelSession?(session: object): void;
  fallbackSession?(session: object): Promise<void>;
}
interface NativeLike {
  alive(): Promise<boolean>;
  connect(onMessage: (t: string) => void, onClose: (code: number) => void): { send(t: string): void; close(): void };
}
export interface HandlerDeps {
  keystore: ReturnType<typeof createKeystore>;
  confirm: ConfirmLike;
  getMode: () => Promise<Mode>;
  native?: NativeLike;
  tsp?: TspClient;
  /** ключи, открытые паролем до закрытия браузера */
  sessionKeys?: ReturnType<typeof createSessionKeys>;
}

const VERSION_MSG = /^\s*\{\s*"result"\s*:\s*\{\s*"version"/;
const ALGORITHM_NAMES = { GOST2015_512: "ECGOST3410-2015-512", RSA: "RSA" } as const;

const pemCert = (der: Uint8Array) => `-----BEGIN CERTIFICATE-----\n${toBase64(der).match(/.{1,64}/g)!.join("\n")}\n-----END CERTIFICATE-----`;

function canceled(req: Request): string {
  return req.dialect === "basics" ? fail(req, "CANCELED", "action.canceled") : fail(req, "500", "action.canceled");
}

function unsupported(req: Request, reason: string): string {
  if (req.dialect !== "basics") return fail(req, "500", "method.not.supported");
  if (reason.includes(".")) return fail(req, "MODULE_NOT_FOUND", reason);
  return fail(req, ["xml", "raw"].includes(reason) ? "UNSUPPORTED_FORMAT" : "UNKNOWN_METHOD", reason);
}

export async function openKey(deps: Pick<HandlerDeps, "keystore" | "sessionKeys">, keyId: string, password: string | undefined): Promise<ParsedP12> {
  if (password === undefined) {
    const remembered = await deps.sessionKeys?.get(keyId);
    if (!remembered) throw new KzSignError("NEED_PASSWORD", "нужен пароль");
    return remembered;
  }
  const key = await deps.keystore.unlock(keyId, password);
  await deps.sessionKeys?.remember(keyId, key);
  return key;
}

async function withKey<T>(deps: HandlerDeps, s: Session, req: ConfirmRequest, use: (key: ParsedP12, keyId: string) => Promise<T>): Promise<T | null> {
  const unlocked = await deps.confirm.ask(req, async (keyId, password) => ({ key: await openKey(deps, keyId, password), keyId }), {
    session: s,
    tabId: s.tabId,
    dispose: (v) => wipe(v.key),
  });
  if (!unlocked) return null;
  try {
    return await use(unlocked.key, unlocked.keyId);
  } finally {
    wipe(unlocked.key);
  }
}

async function sign(deps: HandlerDeps, s: Session, req: Request, p: SignRequest): Promise<string> {
  const items = await describeItems(p.data);
  try {
    const cms = await withKey(deps, s, { origin: s.origin, operation: "sign", items, isHash: p.isHash }, async (key) => {
      const out: Uint8Array[] = [];
      for (const data of p.data) out.push(await signCms(data, key, { detached: p.detached, tsp: req.tsa ? deps.tsp : undefined }));
      return out;
    });
    return cms ? ok(req, cms) : canceled(req);
  } catch (e) {
    const code = e instanceof KzSignError ? e.code : "SIGN_ERROR";
    return req.dialect === "basics" ? fail(req, "SIGN_ERROR", code) : fail(req, "500", code);
  }
}

async function keyInfo(deps: HandlerDeps, s: Session, req: Request): Promise<string> {
  const info = await withKey(deps, s, { origin: s.origin, operation: "keyInfo", items: [], isHash: false }, async (key, keyId) => {
    const meta = (await deps.keystore.list()).find((k) => k.id === keyId);
    const c = certInfo(key.certificateDer);
    return {
      alias: meta?.alias ?? c.subjectCn,
      keyId,
      algorithm: ALGORITHM_NAMES[key.algorithm],
      subjectCn: c.subjectCn,
      subjectDn: c.subjectDn,
      issuerCn: c.issuerCn,
      issuerDn: c.issuerDn,
      serialNumber: c.serialNumber,
      certNotBefore: String(Date.parse(c.notBefore)),
      certNotAfter: String(Date.parse(c.notAfter)),
      pem: pemCert(key.certificateDer),
    };
  });
  return info ? ok(req, info) : canceled(req);
}

async function handleLocally(deps: HandlerDeps, s: Session, req: Request): Promise<string> {
  const p = req.parsed;
  switch (p.kind) {
    case "heartbeat":
      return p.reply;
    case "tokens":
      return ok(req, []);
    case "keyInfo":
      return keyInfo(deps, s, req);
    case "sign":
      return sign(deps, s, req, p);
    case "unsupported":
      return unsupported(req, p.reason);
    case "legacy":
      return fail(req, "", "");
    case "invalid":
      return fail(req, "INVALID_REQUEST", p.reason);
  }
}

export function createSessionFactory(deps: HandlerDeps): SessionFactory {
  return (s) => {
    let route: Promise<"extension" | "native"> | null = null;
    let native: { send(t: string): void; close(): void } | null = null;
    let swallowVersion = true;

    const nativeChannel = () => {
      if (!native) {
        swallowVersion = true;
        native = deps.native!.connect(
          (t) => {
            // страница уже получила приветствие от shim
            if (swallowVersion && VERSION_MSG.test(t)) { swallowVersion = false; return; }
            swallowVersion = false;
            s.send(t);
          },
          () => { native = null; },
        );
      }
      return native;
    };

    return {
      async onFrame(text) {
        const req = parseFrame(text);
        if (req.parsed.kind === "heartbeat") return req.parsed.reply;
        route ??= (async () => {
          if (!deps.native) return "extension";
          return decide(await deps.getMode(), (await deps.keystore.list()).length > 0, () => deps.native!.alive());
        })();
        if ((await route) === "native") {
          nativeChannel().send(text);
          return null;
        }
        return handleLocally(deps, s, req);
      },
      onConfirmGone() {
        void deps.confirm.fallbackSession?.(s);
      },
      onClose() {
        deps.confirm.cancelSession?.(s);
        native?.close();
        native = null;
      },
    };
  };
}
