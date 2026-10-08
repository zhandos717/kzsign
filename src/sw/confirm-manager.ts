import { KzSignError, type ErrorCode } from "../core/errors";

export interface Preview {
  text: string;
  truncated: boolean;
  total: number;
}
export interface ConfirmItem {
  size: number;
  sha256: string;
  preview?: Preview;
}
export interface ConfirmRequest {
  origin: string;
  operation: "keyInfo" | "sign";
  items: ConfirmItem[];
  isHash: boolean;
}
export type Answer = { keyId: string; password?: string } | { cancel: true };
export type AnswerResult = { ok: true } | { ok: false; code: ErrorCode | "INTERNAL" | "BUSY"; retryAfterSec?: number };
export interface WindowsApi {
  open(url: string): Promise<number>;
  close(id: number): Promise<void>;
  onRemoved(cb: (id: number) => void): void;
}

const PREVIEW_LIMIT = 2000;
// управляющие, bidi- и невидимые символы, а также длинные пустые промежутки позволяют показать в окне не тот текст, что подписывается
const UNSAFE_RANGES: [number, number][] = [
  [0x00, 0x08], [0x0b, 0x0c], [0x0e, 0x1f], [0x7f, 0x7f],
  [0x200b, 0x200f], [0x2028, 0x2029], [0x202a, 0x202e], [0x2060, 0x2069], [0xfeff, 0xfeff],
];
const BLANK_RUN = /(?:[ \t\r]*\n){20,}/;
const isUnsafe = (text: string) =>
  BLANK_RUN.test(text) || [...text].some((ch) => { const c = ch.codePointAt(0)!; return UNSAFE_RANGES.some(([a, b]) => c >= a && c <= b); });
const MAX_QUEUE = 5;

export function makePreview(data: Uint8Array): Preview | undefined {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return undefined;
  }
  if (isUnsafe(text)) return undefined;
  return { text: text.slice(0, PREVIEW_LIMIT), truncated: text.length > PREVIEW_LIMIT, total: text.length };
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export async function describeItems(items: Uint8Array[]): Promise<ConfirmItem[]> {
  return Promise.all(
    items.map(async (d) => ({ size: d.length, sha256: hex(await crypto.subtle.digest("SHA-256", new Uint8Array(d))), preview: makePreview(d) })),
  );
}

interface Job {
  req: ConfirmRequest;
  verify: (keyId: string, password: string | undefined) => Promise<unknown>;
  done: (v: unknown) => void;
  session?: object;
  dispose?: (v: unknown) => void;
  tabId?: number;
}
/** Кто обращается к окну подтверждения: документ (sender.documentId) и вкладка */
export interface Caller {
  documentId?: string;
  tabId?: number;
}
export interface AskOptions<T> {
  /** вкладка, откуда пришёл запрос: лимит запросов на вкладку и проверка, что окно на странице открыто именно там */
  tabId?: number;
  /** запросы одной сессии (сокета): не больше одного в очереди, снимаются при её закрытии */
  session?: object;
  /** освобождает результат verify, если он пришёл после отмены */
  dispose?: (v: T) => void;
}

export interface InlineHandle {
  close(): void;
}
/** Показать окно подтверждения прямо на странице запросившей сессии; null — нельзя, нужно отдельное окно */
export type InlinePresenter = (url: string, session: object | undefined) => Promise<InlineHandle | null>;

const INLINE_LOAD_TIMEOUT_MS = 2000;
const MAX_PER_TAB = 2;

export function createConfirmManager(win: WindowsApi, timeoutMs = 120_000, inline?: InlinePresenter) {
  const queue: Job[] = [];
  let active: {
    job: Job;
    token: string;
    windowId: number | null;
    inline: InlineHandle | null;
    seen: boolean;
    owner: string | null;
    timer: ReturnType<typeof setTimeout>;
    verifying: boolean;
  } | null = null;

  win.onRemoved((id) => {
    if (active && active.windowId === id) finish(null, false);
  });

  function finish(value: unknown, closeWindow = true) {
    if (!active) return;
    const { job, windowId, timer } = active;
    clearTimeout(timer);
    active.inline?.close();
    active = null;
    if (closeWindow && windowId !== null) void win.close(windowId).catch(() => {});
    job.done(value);
    void pump();
  }

  async function pump() {
    if (active || !queue.length) return;
    const job = queue.shift()!;
    const token = hex(crypto.getRandomValues(new Uint8Array(16)).buffer);
    active = { job, token, windowId: null, inline: null, seen: false, owner: null, timer: setTimeout(() => finish(null), timeoutMs), verifying: false };
    const current = active;
    const url = `confirm.html#${token}`;
    const handle = inline ? await inline(url, job.session).catch(() => null) : null;
    if (active !== current) return handle?.close();
    if (handle) {
      current.inline = handle;
      // iframe может не загрузиться (CSP страницы, ошибка) — тогда отдельное окно
      setTimeout(() => { if (active === current && !current.seen) void toWindow(current); }, INLINE_LOAD_TIMEOUT_MS);
      return;
    }
    await toWindow(current);
  }

  async function toWindow(current: NonNullable<typeof active>) {
    current.inline?.close();
    current.inline = null;
    current.seen = false;
    current.owner = null;
    try {
      const id = await win.open(`confirm.html#${current.token}`);
      if (active === current) current.windowId = id;
      else void win.close(id).catch(() => {});
    } catch {
      if (active === current) finish(null, false);
    }
  }

  return {
    ask<T>(req: ConfirmRequest, verify: (keyId: string, password: string | undefined) => Promise<T>, opts: AskOptions<T> = {}): Promise<T | null> {
      const all = [...queue, ...(active ? [active.job] : [])];
      if (all.length >= MAX_QUEUE) return Promise.resolve(null);
      if (opts.session && all.some((j) => j.session === opts.session)) return Promise.resolve(null);
      if (opts.tabId !== undefined && all.filter((j) => j.tabId === opts.tabId).length >= MAX_PER_TAB) return Promise.resolve(null);
      return new Promise<T | null>((resolve) => {
        queue.push({ req, verify, done: resolve as (v: unknown) => void, session: opts.session, dispose: opts.dispose as ((v: unknown) => void) | undefined, tabId: opts.tabId });
        void pump();
      });
    },

    cancelSession(session: object | undefined): void {
      if (!session) return;
      for (let i = queue.length - 1; i >= 0; i--) {
        if (queue[i]!.session === session) queue.splice(i, 1)[0]!.done(null);
      }
      if (active?.job.session === session) finish(null);
    },

    // Токен привязывается к первому документу, открывшему окно: даже узнав токен, другая страница не сможет ответить.
    // Окно на странице должно открыться в той же вкладке, откуда пришёл запрос.
    pending(token: string, from: Caller = {}): ConfirmRequest | undefined {
      if (!active || active.token !== token) return undefined;
      if (active.inline && active.job.tabId !== undefined && from.tabId !== active.job.tabId) return undefined;
      const who = from.documentId ?? "";
      if (active.owner !== null && active.owner !== who) return undefined;
      active.owner = who;
      active.seen = true;
      return active.job.req;
    },

    /** страница убрала оверлей — показываем запрос этой сессии в отдельном окне */
    async fallbackSession(session: object): Promise<void> {
      if (active && active.job.session === session && active.inline) await toWindow(active);
    },

    /** окно на странице не может подтвердить свою видимость — показываем отдельное окно */
    async fallback(token: string, from: Caller = {}): Promise<void> {
      if (!active || active.token !== token || !active.inline) return;
      if (active.owner !== null && active.owner !== (from.documentId ?? "")) return;
      await toWindow(active);
    },

    async answer(token: string, a: Answer, from: Caller = {}): Promise<AnswerResult> {
      if (!active || active.token !== token) return { ok: false, code: "NOT_FOUND" };
      if (active.owner !== null && active.owner !== (from.documentId ?? "")) return { ok: false, code: "NOT_FOUND" };
      if ("cancel" in a) {
        finish(null);
        return { ok: true };
      }
      const current = active;
      if (current.verifying) return { ok: false, code: "BUSY" };
      current.verifying = true;
      try {
        const value = await current.job.verify(a.keyId, typeof a.password === "string" && a.password !== "" ? a.password : undefined);
        if (active !== current) {
          current.job.dispose?.(value);
          return { ok: false, code: "NOT_FOUND" };
        }
        finish(value);
        return { ok: true };
      } catch (e) {
        if (e instanceof KzSignError) return { ok: false, code: e.code, ...(e.retryAfterSec ? { retryAfterSec: e.retryAfterSec } : {}) };
        return { ok: false, code: "INTERNAL" };
      } finally {
        current.verifying = false;
      }
    },
  };
}
