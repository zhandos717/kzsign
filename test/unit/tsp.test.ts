import { describe, it, expect, vi } from "vitest";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { buildTimeStampReq, parseTimeStampResp, httpTsp } from "../../src/core/tsp";
import { signCms, verifyCms } from "../../src/core/signer";
import { gost, OID_GOST_DIGEST } from "../../src/core/crypto/gost";
import { parseP12 } from "../../src/core/p12";
import { readFixture, FIXTURE_PASSWORD, GOST2015_INDIVIDUAL, RSA_PERSONAL } from "../helpers/fixtures";

const OID_SHA256 = "2.16.840.1.101.3.4.2.1";
const nonce = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

function fakeResp(opts: { status?: number; nonce?: Uint8Array; imprint: Uint8Array; hashOid: string }): Uint8Array {
  const tst = new pkijs.TSTInfo({
    version: 1,
    policy: "1.2.3",
    messageImprint: new pkijs.MessageImprint({ hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: opts.hashOid }), hashedMessage: new asn1js.OctetString({ valueHex: opts.imprint }) }),
    serialNumber: new asn1js.Integer({ value: 1 }),
    genTime: new Date(),
    nonce: new asn1js.Integer({ valueHex: opts.nonce ?? nonce }),
  });
  const sd = new pkijs.SignedData({
    version: 3,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: "1.2.840.113549.1.9.16.1.4", eContent: new asn1js.OctetString({ valueHex: tst.toSchema().toBER(false) }) }),
    signerInfos: [],
  });
  const token = new pkijs.ContentInfo({ contentType: "1.2.840.113549.1.7.2", content: sd.toSchema(true) });
  const resp = new pkijs.TimeStampResp({ status: new pkijs.PKIStatusInfo({ status: opts.status ?? 0 }), timeStampToken: token });
  return new Uint8Array(resp.toSchema().toBER(false));
}

describe("TSP", () => {
  it("запрос: алгоритм, nonce, certReq", () => {
    const imprint = new Uint8Array(64).fill(7);
    const req = new pkijs.TimeStampReq({ schema: asn1js.fromBER(buildTimeStampReq(imprint, true, nonce)).result });
    expect(req.messageImprint.hashAlgorithm.algorithmId).toBe(OID_GOST_DIGEST);
    expect(new Uint8Array(req.messageImprint.hashedMessage.valueBlock.valueHexView)).toEqual(imprint);
    expect(new Uint8Array(req.nonce!.valueBlock.valueHexView)).toEqual(nonce);
    expect(req.certReq).toBe(true);
    const rsa = new pkijs.TimeStampReq({ schema: asn1js.fromBER(buildTimeStampReq(new Uint8Array(32), false, nonce)).result });
    expect(rsa.messageImprint.hashAlgorithm.algorithmId).toBe(OID_SHA256);
  });

  it("ответ granted → токен", () => {
    const imprint = new Uint8Array(32).fill(1);
    const token = parseTimeStampResp(fakeResp({ imprint, hashOid: OID_SHA256 }), nonce, imprint);
    expect(new pkijs.ContentInfo({ schema: asn1js.fromBER(token).result }).contentType).toBe("1.2.840.113549.1.7.2");
  });

  it.each([
    ["статус rejection", { status: 2 }],
    ["чужой nonce", { nonce: new Uint8Array([9]) }],
    ["чужой imprint", { imprint: new Uint8Array(32).fill(2) }],
  ])("%s → TSP_FAILED", (_, o) => {
    const imprint = new Uint8Array(32).fill(1);
    expect(() => parseTimeStampResp(fakeResp({ imprint, hashOid: OID_SHA256, ...o }), nonce, imprint)).toThrowError(/TSP_FAILED/);
  });

  it("мусор → TSP_FAILED", () => {
    expect(() => parseTimeStampResp(new Uint8Array([1, 2]), nonce, new Uint8Array(32))).toThrowError(/TSP_FAILED/);
  });

  it.each([["gost", GOST2015_INDIVIDUAL], ["rsa", RSA_PERSONAL]])("signCms(%s) с tsp: токен в unsignedAttrs над значением подписи", async (_, f) => {
    const key = parseP12(readFixture(f), FIXTURE_PASSWORD);
    let seen: Uint8Array | null = null;
    const tsp = vi.fn(async (imprint: Uint8Array, isGost: boolean) => {
      seen = imprint;
      return parseTimeStampResp(fakeResp({ imprint, hashOid: isGost ? OID_GOST_DIGEST : OID_SHA256, nonce }), nonce, imprint);
    });
    const cms = await signCms(new TextEncoder().encode("x"), key, { detached: false, tsp });
    const sd = new pkijs.SignedData({ schema: new pkijs.ContentInfo({ schema: asn1js.fromBER(cms).result }).content });
    const si = sd.signerInfos[0]!;
    expect(si.unsignedAttrs!.attributes[0]!.type).toBe("1.2.840.113549.1.9.16.2.14");
    const sig = new Uint8Array(si.signature.valueBlock.valueHexView);
    const expected = f === RSA_PERSONAL ? new Uint8Array(await crypto.subtle.digest("SHA-256", sig)) : gost.digest(sig);
    expect(seen).toEqual(expected);
    expect((await verifyCms(cms)).valid).toBe(true);
  });

  it("ошибка TSA → signCms бросает, без тихого понижения до BES", async () => {
    const key = parseP12(readFixture(RSA_PERSONAL), FIXTURE_PASSWORD);
    await expect(signCms(new Uint8Array([1]), key, { detached: false, tsp: async () => { throw new Error("down"); } })).rejects.toThrow();
  });

  it("httpTsp: POST с нужным Content-Type, HTTP-ошибка → TSP_FAILED", async () => {
    const fetchFn = vi.fn(async () => new Response("no", { status: 503 }));
    await expect(httpTsp(fetchFn as unknown as typeof fetch)(new Uint8Array(32), false)).rejects.toThrow(/TSP_FAILED/);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://tsp.pki.gov.kz/");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/timestamp-query");
  });
});
