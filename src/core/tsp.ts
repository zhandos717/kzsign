import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { KzSignError } from "./errors";
import { OID_GOST_DIGEST } from "./crypto/gost";
import { OID_SHA256 } from "./crypto/rsa";

export type TspClient = (imprint: Uint8Array, gost: boolean) => Promise<Uint8Array>;

const OID_SIGNED_DATA = "1.2.840.113549.1.7.2";
const OID_TST_INFO = "1.2.840.113549.1.9.16.1.4";
export const TSP_URL = "http://tsp.pki.gov.kz/";

const failed = (why: string): never => {
  throw new KzSignError("TSP_FAILED", why);
};
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
// INTEGER nonce может прийти с ведущим нулём; сравниваем как числа
const stripZeros = (b: Uint8Array) => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; return b.subarray(i); };

export function buildTimeStampReq(imprint: Uint8Array, gost: boolean, nonce: Uint8Array): Uint8Array {
  const req = new pkijs.TimeStampReq({
    version: 1,
    messageImprint: new pkijs.MessageImprint({
      hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: gost ? OID_GOST_DIGEST : OID_SHA256 }),
      hashedMessage: new asn1js.OctetString({ valueHex: imprint }),
    }),
    nonce: new asn1js.Integer({ valueHex: nonce }),
    certReq: true,
  });
  return new Uint8Array(req.toSchema().toBER(false));
}

export function parseTimeStampResp(der: Uint8Array, expectedNonce: Uint8Array, expectedImprint: Uint8Array): Uint8Array {
  let resp: pkijs.TimeStampResp;
  try {
    const asn = asn1js.fromBER(der);
    if (asn.offset === -1) failed("ответ TSA не ASN.1");
    resp = new pkijs.TimeStampResp({ schema: asn.result });
  } catch (e) {
    if (e instanceof KzSignError) throw e;
    return failed("ответ TSA не разобран");
  }
  if (resp.status.status !== 0 && resp.status.status !== 1) failed(`TSA отказал: статус ${resp.status.status}`);
  const token = resp.timeStampToken ?? failed("нет токена");
  if (token.contentType !== OID_SIGNED_DATA) failed("токен не SignedData");
  try {
    const sd = new pkijs.SignedData({ schema: token.content });
    if (sd.encapContentInfo.eContentType !== OID_TST_INFO) failed("токен без TSTInfo");
    const tst = new pkijs.TSTInfo({ schema: asn1js.fromBER(sd.encapContentInfo.eContent!.getValue()).result });
    const nonce = tst.nonce ? new Uint8Array(tst.nonce.valueBlock.valueHexView) : new Uint8Array();
    if (!equal(stripZeros(nonce), stripZeros(expectedNonce))) failed("nonce не совпадает");
    if (!equal(new Uint8Array(tst.messageImprint.hashedMessage.valueBlock.valueHexView), expectedImprint)) failed("messageImprint не совпадает");
  } catch (e) {
    if (e instanceof KzSignError) throw e;
    failed("токен не разобран");
  }
  return new Uint8Array(token.toSchema().toBER(false));
}

export function httpTsp(fetchFn: typeof fetch = fetch, url = TSP_URL): TspClient {
  return async (imprint, gost) => {
    const nonce = crypto.getRandomValues(new Uint8Array(8));
    nonce[0]! &= 0x7f;
    let res: Response;
    try {
      res = await fetchFn(url, { method: "POST", headers: { "Content-Type": "application/timestamp-query" }, body: buildTimeStampReq(imprint, gost, nonce) as BodyInit });
    } catch {
      return failed("TSA недоступен");
    }
    if (!res.ok) failed(`TSA ответил HTTP ${res.status}`);
    return parseTimeStampResp(new Uint8Array(await res.arrayBuffer()), nonce, imprint);
  };
}
