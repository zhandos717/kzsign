import * as asn1js from "asn1js";
import * as pkijs from "pkijs";

export interface CertInfo {
  subjectCn: string;
  subjectDn: string;
  issuerCn: string;
  issuerDn: string;
  iin?: string;
  bin?: string;
  serialNumber: string;
  notBefore: string;
  notAfter: string;
}

const NAMES: Record<string, string> = { "2.5.4.3": "CN", "2.5.4.4": "SURNAME", "2.5.4.5": "SERIALNUMBER", "2.5.4.6": "C", "2.5.4.10": "O", "2.5.4.11": "OU", "2.5.4.42": "G", "1.2.840.113549.1.9.1": "E" };

const attrs = (n: pkijs.RelativeDistinguishedNames) =>
  n.typesAndValues.map((t) => [t.type, String(t.value.valueBlock.value)] as const);
const dn = (n: pkijs.RelativeDistinguishedNames) => attrs(n).map(([t, v]) => `${NAMES[t] ?? t}=${v}`).join(",");
const get = (n: pkijs.RelativeDistinguishedNames, oid: string) => attrs(n).find(([t]) => t === oid)?.[1];
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

export function certInfo(der: Uint8Array): CertInfo {
  const c = new pkijs.Certificate({ schema: asn1js.fromBER(der).result });
  const sn = get(c.subject, "2.5.4.5");
  const ou = get(c.subject, "2.5.4.11");
  return {
    subjectCn: get(c.subject, "2.5.4.3") ?? "",
    subjectDn: dn(c.subject),
    issuerCn: get(c.issuer, "2.5.4.3") ?? "",
    issuerDn: dn(c.issuer),
    iin: sn?.match(/^IIN(\d{12})$/)?.[1],
    bin: ou?.match(/^BIN(\d{12})$/)?.[1],
    serialNumber: hex(new Uint8Array(c.serialNumber.valueBlock.valueHexView)),
    notBefore: c.notBefore.value.toISOString(),
    notAfter: c.notAfter.value.toISOString(),
  };
}
