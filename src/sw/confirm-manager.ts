import { KzSignError, type ErrorCode } from "../core/errors";

export interface ConfirmItem {
  size: number;
  sha256: string;
  preview?: string;
}
export interface ConfirmRequest {
  origin: string;
  operation: "keyInfo" | "sign";
  items: ConfirmItem[];
  isHash: boolean;
}
export type Answer = { keyId: string; password: string } | { cancel: true };
export type AnswerResult = { ok: true } | { ok: false; code: ErrorCode | "INTERNAL"; retryAfterSec?: number };
export interface WindowsApi {
  open(url: string): Promise<number>;
  close(id: number): Promise<void>;
  onRemoved(cb: (id: number) => void): void;
}

const PREVIEW_LIMIT = 2000;
// управляющие символы (кроме \t\n\r) и bidi-переключатели позволяют показать в окне не тот текст, что подписывается
const UNSAFE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‎‏‪-‮⁦-⁩]/;

export function makePreview(data: Uint8Array): string | undefined {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return undefined;
  }
  if (UNSAFE.test(text)) return undefined;
  return text.length > PREVIEW_LIMIT ? text.slice(0, PREVIEW_LIMIT) + "…" : text;
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export async function describeItems(items: Uint8Array[]): Promise<ConfirmItem[]> {
  return Promise.all(
    items.map(async (d) => ({ size: d.length, sha256: hex(await crypto.subtle.digest("SHA-256", new Uint8Array(d))), preview: makePreview(d) })),
  );
}

interface Job {
  req: ConfirmRequest;
  verify: (keyId: string, password: string) => Promise<unknown>;
  done: (v: unknown) => void;
}

export function createConfirmManager(win: WindowsApi, timeoutMs = 120_000) {
  const queue: Job[] = [];
  let active: { job: Job; token: string; windowId: number | null; timer: ReturnType<typeof setTimeout> } | null = null;

  win.onRemoved((id) => {
    if (active && active.windowId === id) finish(null, false);
  });

  function finish(value: unknown, closeWindow = true) {
    if (!active) return;
    const { job, windowId, timer } = active;
    clearTimeout(timer);
    active = null;
    if (closeWindow && windowId !== null) void win.close(windowId).catch(() => {});
    job.done(value);
    void pump();
  }

  async function pump() {
    if (active || !queue.length) return;
    const job = queue.shift()!;
    const token = hex(crypto.getRandomValues(new Uint8Array(16)).buffer);
    active = { job, token, windowId: null, timer: setTimeout(() => finish(null), timeoutMs) };
    const current = active;
    try {
      const id = await win.open(`confirm.html#${token}`);
      if (active === current) current.windowId = id;
      else void win.close(id).catch(() => {});
    } catch {
      if (active === current) finish(null, false);
    }
  }

  return {
    ask<T>(req: ConfirmRequest, verify: (keyId: string, password: string) => Promise<T>): Promise<T | null> {
      return new Promise<T | null>((resolve) => {
        queue.push({ req, verify, done: resolve as (v: unknown) => void });
        void pump();
      });
    },

    pending(token: string): ConfirmRequest | undefined {
      return active && active.token === token ? active.job.req : undefined;
    },

    async answer(token: string, a: Answer): Promise<AnswerResult> {
      if (!active || active.token !== token) return { ok: false, code: "NOT_FOUND" };
      if ("cancel" in a) {
        finish(null);
        return { ok: true };
      }
      const current = active;
      try {
        const value = await current.job.verify(a.keyId, a.password);
        if (active !== current) return { ok: false, code: "NOT_FOUND" };
        finish(value);
        return { ok: true };
      } catch (e) {
        if (e instanceof KzSignError) return { ok: false, code: e.code, ...(e.retryAfterSec ? { retryAfterSec: e.retryAfterSec } : {}) };
        return { ok: false, code: "INTERNAL" };
      }
    },
  };
}
