import { describe, it, expect } from "vitest";
import { parseFrame, ok, fail, HELLO } from "../../src/sw/proto";

const common = (method: string, args: unknown[] = []) => JSON.stringify({ module: "kz.gov.pki.knca.commonUtils", method, args });
const basics = (args: unknown) => JSON.stringify({ module: "kz.gov.pki.knca.basics", method: "sign", args });
const hi = new TextEncoder().encode("hi");

describe("parseFrame", () => {
  it("HELLO", () => expect(JSON.parse(HELLO)).toEqual({ result: { version: "1.4" } }));
  it("heartbeat текстом и JSON", () => {
    expect(parseFrame("--heartbeat--").parsed).toEqual({ kind: "heartbeat", reply: "--heartbeat--" });
    expect(parseFrame("{}").parsed).toEqual({ kind: "heartbeat", reply: "{}" });
  });
  it("getActiveTokens", () => {
    const r = parseFrame(common("getActiveTokens"));
    expect(r.parsed.kind).toBe("tokens");
    expect(JSON.parse(ok(r, []))).toEqual({ code: "200", responseObject: [] });
  });
  it("getKeyInfo", () => expect(parseFrame(common("getKeyInfo", ["PKCS12"])).parsed.kind).toBe("keyInfo"));
  it("createCAdESFromBase64 attached", () => {
    expect(parseFrame(common("createCAdESFromBase64", ["PKCS12", "SIGNATURE", "aGk=", true])).parsed).toEqual({ kind: "sign", data: [hi], detached: false, isHash: false, batch: false });
  });
  it("createCAdESFromBase64 detached", () => {
    expect(parseFrame(common("createCAdESFromBase64", ["PKCS12", "SIGNATURE", "aGk=", false])).parsed).toMatchObject({ detached: true });
  });
  it("createCMSSignatureFromBase64", () => {
    expect(parseFrame(common("createCMSSignatureFromBase64", ["PKCS12", "SIGNATURE", "aGk=", true])).parsed).toMatchObject({ kind: "sign", detached: false });
  });
  it("createCAdESFromBase64Hash", () => {
    expect(parseFrame(common("createCAdESFromBase64Hash", ["PKCS12", "SIGNATURE", "aGk="])).parsed).toMatchObject({ kind: "sign", isHash: true, detached: true });
  });
  it("basics sign пачкой, detached, ответ PEM", () => {
    const r = parseFrame(basics({ format: "cms", data: ["aGk=", "aGk="], signingParams: { encapsulate: "false" } }));
    expect(r.parsed).toEqual({ kind: "sign", data: [hi, hi], detached: true, isHash: false, batch: true });
    const res = JSON.parse(ok(r, [new Uint8Array(100), new Uint8Array(1)]));
    expect(res.status).toBe(true);
    expect(res.body.result).toHaveLength(2);
    expect(res.body.result[0]).toMatch(/^-----BEGIN CMS-----\n[A-Za-z0-9+/=\n]+\n-----END CMS-----$/);
    expect(res.body.result[0].split("\n")[1]).toHaveLength(64);
  });
  it("basics sign одиночный → строка", () => {
    const r = parseFrame(basics({ format: "cms", data: "aGk=", signingParams: { digested: "true" } }));
    expect(r.parsed).toMatchObject({ isHash: true, batch: false });
    expect(typeof JSON.parse(ok(r, [new Uint8Array(3)])).body.result).toBe("string");
  });
  it("basics xml → UNSUPPORTED_FORMAT", () => {
    const r = parseFrame(basics({ format: "xml", data: "<a/>" }));
    expect(r.parsed.kind).toBe("unsupported");
    expect(JSON.parse(fail(r, "UNSUPPORTED_FORMAT", "xml"))).toMatchObject({ status: false, code: "UNSUPPORTED_FORMAT", body: {} });
  });
  it("signXml → method.not.supported", () => {
    const r = parseFrame(common("signXml", ["PKCS12", "SIGNATURE", "<a/>", "", ""]));
    expect(r.parsed.kind).toBe("unsupported");
    expect(JSON.parse(fail(r, "500", "method.not.supported"))).toEqual({ code: "500", message: "method.not.supported" });
  });
  it("старый applet без module", () => {
    const r = parseFrame(JSON.stringify({ method: "foo", args: [] }));
    expect(r.parsed).toEqual({ kind: "legacy", method: "foo" });
    expect(JSON.parse(fail(r, "", ""))).toEqual({ errorCode: "java.lang.NoSuchMethodException.foo" });
  });
  it.each(["не json", '{"module":"kz.gov.pki.knca.commonUtils"}', common("createCAdESFromBase64", ["PKCS12", "SIGNATURE", "%%%", true]), common("createCAdESFromBase64", ["PKCS12"]), "null", "[]"])(
    "мусор не роняет: %s",
    (t) => {
      const r = parseFrame(t);
      expect(r.parsed.kind).toBe("invalid");
      expect(() => JSON.parse(fail(r, "500", "bad"))).not.toThrow();
    },
  );
  it("неизвестный модуль", () => {
    const r = parseFrame(JSON.stringify({ module: "x.y", method: "z" }));
    expect(r.parsed.kind).toBe("unsupported");
    expect(JSON.parse(fail(r, "MODULE_NOT_FOUND", "x.y"))).toMatchObject({ status: false, code: "MODULE_NOT_FOUND" });
  });
});

describe("basics: decode=false — данные обычным текстом", () => {
  it("строка без base64 кодируется в UTF-8", () => {
    const r = parseFrame(JSON.stringify({ module: "kz.gov.pki.knca.basics", method: "sign", args: { format: "cms", data: "Привет, мир", signingParams: { decode: false } } }));
    expect(r.parsed).toMatchObject({ kind: "sign", data: [new TextEncoder().encode("Привет, мир")] });
  });
  it("decode по умолчанию — base64", () => {
    const r = parseFrame(JSON.stringify({ module: "kz.gov.pki.knca.basics", method: "sign", args: { format: "cms", data: "aGk=", signingParams: {} } }));
    expect(r.parsed).toMatchObject({ data: [new TextEncoder().encode("hi")] });
  });
});
