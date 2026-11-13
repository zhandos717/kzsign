export type SignRequest = { kind: "sign"; format: "cms" | "xml"; data: Uint8Array[]; detached: boolean; isHash: boolean; batch: boolean };
export type Parsed =
  | { kind: "heartbeat"; reply: string }
  | { kind: "tokens" }
  | { kind: "keyInfo" }
  | SignRequest
  | { kind: "unsupported"; reason: string }
  | { kind: "legacy"; method: string }
  | { kind: "invalid"; reason: string };
export type Dialect = "common" | "basics" | "legacy";
export interface Request {
  dialect: Dialect;
  parsed: Parsed;
  tsa: boolean;
}

export const HELLO = '{"result":{"version":"1.4"}}';

const COMMON = "kz.gov.pki.knca.commonUtils";
const BASICS = "kz.gov.pki.knca.basics";
const UNSUPPORTED_COMMON = new Set(["createCAdESFromFile", "signXmlByElementId", "getKeys", "loadSlotList"]);

const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

function fromBase64(s: unknown): Uint8Array | null {
  if (typeof s !== "string") return null;
  const clean = s.replace(/\s+/g, "");
  if (!B64.test(clean) || clean.length % 4 === 1) return null;
  try {
    return Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export function toBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

const pem = (b: Uint8Array) => `-----BEGIN CMS-----\n${toBase64(b).match(/.{1,64}/g)!.join("\n")}\n-----END CMS-----`;
const isFalse = (v: unknown) => v === false || v === "false";
const isTrue = (v: unknown) => v === true || v === "true";

const invalid = (dialect: Dialect, reason: string): Request => ({ dialect, parsed: { kind: "invalid", reason }, tsa: false });

const xmlBytes = (x: unknown) => (typeof x === "string" && x.trim() ? new TextEncoder().encode(x) : null);

function parseCommon(method: string, args: unknown): Request {
  const req = (parsed: Parsed): Request => ({ dialect: "common", parsed, tsa: false });
  if (method === "getActiveTokens") return req({ kind: "tokens" });
  if (method === "signXml" || method === "signXmls") {
    if (!Array.isArray(args) || args.length < 3) return invalid("common", "args");
    const items = method === "signXmls" ? (Array.isArray(args[2]) ? args[2] : null) : [args[2]];
    const data = items?.map(xmlBytes);
    if (!data?.length || data.some((d) => !d)) return invalid("common", "xml");
    return req({ kind: "sign", format: "xml", data: data as Uint8Array[], isHash: false, detached: false, batch: method === "signXmls" });
  }
  if (method === "getKeyInfo") return req({ kind: "keyInfo" });
  if (UNSUPPORTED_COMMON.has(method)) return req({ kind: "unsupported", reason: method });
  const sign = { createCAdESFromBase64: false, createCMSSignatureFromBase64: false, createCAdESFromBase64Hash: true } as Record<string, boolean>;
  if (!(method in sign)) return req({ kind: "unsupported", reason: method });
  if (!Array.isArray(args) || args.length < 3) return invalid("common", "args");
  const data = fromBase64(args[2]);
  if (!data) return invalid("common", "base64");
  const isHash = sign[method]!;
  return req({ kind: "sign", format: "cms", data: [data], isHash, detached: isHash || isFalse(args[3]), batch: false });
}

function parseBasics(method: string, args: unknown): Request {
  if (method !== "sign") return { dialect: "basics", parsed: { kind: "unsupported", reason: method }, tsa: false };
  if (!args || typeof args !== "object") return invalid("basics", "args");
  const a = args as { format?: unknown; data?: unknown; signingParams?: Record<string, unknown> };
  const format = a.format ?? "cms";
  if (format !== "cms" && format !== "xml") return { dialect: "basics", parsed: { kind: "unsupported", reason: String(format) }, tsa: false };
  const items = Array.isArray(a.data) ? a.data : [a.data];
  const sp = a.signingParams ?? {};
  if (format === "xml") {
    const data = items.map(xmlBytes);
    if (!data.length || data.some((d) => !d)) return invalid("basics", "xml");
    return { dialect: "basics", parsed: { kind: "sign", format: "xml", data: data as Uint8Array[], isHash: false, detached: false, batch: Array.isArray(a.data) }, tsa: false };
  }
  const decode = isTrue(sp.decode) ? fromBase64 : (s: unknown) => (typeof s === "string" ? new TextEncoder().encode(s) : null);
  const data = items.map(decode);
  if (!data.length || data.some((d) => !d)) return invalid("basics", "base64");
  const isHash = isTrue(sp.digested);
  return {
    dialect: "basics",
    parsed: { kind: "sign", format: "cms", data: data as Uint8Array[], isHash, detached: isHash || isFalse(sp.encapsulate), batch: Array.isArray(a.data) },
    tsa: typeof sp.tsaProfile === "object" && sp.tsaProfile !== null,
  };
}

export function parseFrame(text: string): Request {
  if (text === "--heartbeat--" || text === "{}") return { dialect: "common", parsed: { kind: "heartbeat", reply: text }, tsa: false };
  let msg: unknown;
  try {
    msg = JSON.parse(text);
  } catch {
    return invalid("common", "json");
  }
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return invalid("common", "json");
  const { module, method, args } = msg as { module?: unknown; method?: unknown; args?: unknown };
  if (typeof method !== "string") return invalid(module === BASICS ? "basics" : "common", "method");
  if (module === undefined) return { dialect: "legacy", parsed: { kind: "legacy", method }, tsa: false };
  if (module === COMMON) return parseCommon(method, args);
  if (module === BASICS) return parseBasics(method, args);
  return { dialect: "basics", parsed: { kind: "unsupported", reason: String(module) }, tsa: false };
}

export function ok(req: Request, value: unknown): string {
  if (req.parsed.kind === "heartbeat") return req.parsed.reply;
  if (req.parsed.kind === "sign" && req.parsed.format === "xml") {
    const xmls = value as string[];
    const out = req.parsed.batch ? xmls : xmls[0];
    return req.dialect === "common" ? JSON.stringify({ code: "200", responseObject: out }) : JSON.stringify({ status: true, body: { result: out } });
  }
  if (req.parsed.kind === "sign") {
    const cms = value as Uint8Array[];
    if (req.dialect === "common") return JSON.stringify({ code: "200", responseObject: toBase64(cms[0]!) });
    const result = req.parsed.batch ? cms.map(pem) : pem(cms[0]!);
    return JSON.stringify({ status: true, body: { result } });
  }
  return req.dialect === "basics" ? JSON.stringify({ status: true, body: { result: value } }) : JSON.stringify({ code: "200", responseObject: value });
}

export function fail(req: Request, code: string, message: string): string {
  if (req.dialect === "legacy" && req.parsed.kind === "legacy") return JSON.stringify({ errorCode: `java.lang.NoSuchMethodException.${req.parsed.method}` });
  if (req.dialect === "basics") return JSON.stringify({ status: false, code, message, details: "", body: {} });
  return JSON.stringify({ code: "500", message });
}
