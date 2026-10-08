import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { C14nCanonicalization, C14nCanonicalizationWithComments } from "xml-crypto/lib/c14n-canonicalization.js";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import type { ParsedP12 } from "./p12";
import { KzSignError } from "./errors";
import { gost } from "./crypto/gost";
import { rsaSign, rsaVerify } from "./crypto/rsa";

// Формат совпадает с Kalkan (эталон — test/fixtures/xml/ncanode-gost-login.xml, проверен NCANode):
// enveloped-подпись в корне, Reference URI="" с C14N#WithComments, SignedInfo по C14N.
const DS = "http://www.w3.org/2000/09/xmldsig#";
const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const C14N_COMMENTS = `${C14N}#WithComments`;
const ENVELOPED = `${DS}enveloped-signature`;
const ALG = {
  GOST2015_512: {
    sig: "urn:ietf:params:xml:ns:pkigovkz:xmlsec:algorithms:gostr34102015-gostr34112015-512",
    digest: "urn:ietf:params:xml:ns:pkigovkz:xmlsec:algorithms:gostr34112015-512",
  },
  RSA: { sig: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256", digest: "http://www.w3.org/2001/04/xmlenc#sha256" },
} as const;

type Node = any;

const enc = (s: string) => new TextEncoder().encode(s);
const b64 = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/\s+/g, "")), (c) => c.charCodeAt(0));
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const sha256 = async (b: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(b)));

const malformed = (why: string): never => {
  throw new KzSignError("MALFORMED_XML", why);
};

export function parseXml(xml: string): Node {
  // DOCTYPE запрещён: сущности DTD позволяют показать в окне одно, а подписать другое
  if (!xml.trim() || /<!DOCTYPE/i.test(xml)) malformed("пустой XML или DOCTYPE");
  let failed = false;
  let doc: Node;
  try {
    doc = new DOMParser({ onError: () => { failed = true; } } as any).parseFromString(xml, "text/xml");
  } catch {
    return malformed("не XML");
  }
  if (failed || !doc?.documentElement || doc.getElementsByTagName("parsererror").length) malformed("не XML");
  return doc;
}

// Пространства имён, видимые у узла от предков: при C14N подмножества документа они попадают в результат
function ancestorNamespaces(node: Node): { prefix: string; namespaceURI: string }[] {
  const seen = new Map<string, string>();
  for (let n = node.parentNode; n && n.nodeType === 1; n = n.parentNode) {
    for (const a of Array.from(n.attributes ?? []) as Node[]) {
      const prefix = a.name === "xmlns" ? "" : a.name.startsWith("xmlns:") ? a.name.slice(6) : null;
      if (prefix !== null && !seen.has(prefix)) seen.set(prefix, a.value);
    }
  }
  return [...seen].map(([prefix, namespaceURI]) => ({ prefix, namespaceURI }));
}

const canon = (node: Node, withComments: boolean) =>
  (withComments ? new C14nCanonicalizationWithComments() : new C14nCanonicalization()).process(node, { ancestorNamespaces: ancestorNamespaces(node) }) as string;

const digestOf = async (alg: keyof typeof ALG, data: Uint8Array) => (alg === "RSA" ? sha256(data) : gost.digest(data));

async function signBytes(key: ParsedP12, data: Uint8Array): Promise<Uint8Array> {
  return key.algorithm === "RSA" ? rsaSign(data, key.privateKeyPkcs8) : gost.sign(gost.digest(data), key.privateKeyPkcs8);
}

export async function signXml(xml: string, key: ParsedP12): Promise<string> {
  const doc = parseXml(xml);
  const root = doc.documentElement;
  const alg = ALG[key.algorithm];

  // Reference URI="" по стандарту XMLDSig отбрасывает комментарии ещё до transform #WithComments — так же делает Kalkan
  const digest = await digestOf(key.algorithm, enc(canon(root, false)));

  const el = (name: string, attrs: Record<string, string> = {}, text?: string) => {
    const e = doc.createElementNS(DS, `ds:${name}`);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text !== undefined) e.appendChild(doc.createTextNode(text));
    return e;
  };
  const sig = el("Signature");
  const signedInfo = el("SignedInfo");
  signedInfo.appendChild(el("CanonicalizationMethod", { Algorithm: C14N }));
  signedInfo.appendChild(el("SignatureMethod", { Algorithm: alg.sig }));
  const ref = el("Reference", { URI: "" });
  const transforms = el("Transforms");
  transforms.appendChild(el("Transform", { Algorithm: ENVELOPED }));
  transforms.appendChild(el("Transform", { Algorithm: C14N_COMMENTS }));
  ref.appendChild(transforms);
  ref.appendChild(el("DigestMethod", { Algorithm: alg.digest }));
  ref.appendChild(el("DigestValue", {}, b64(digest)));
  signedInfo.appendChild(ref);
  sig.appendChild(signedInfo);
  root.appendChild(sig);

  const signature = await signBytes(key, enc(canon(signedInfo, false)));
  sig.appendChild(el("SignatureValue", {}, b64(signature)));
  const keyInfo = el("KeyInfo");
  const x509 = el("X509Data");
  x509.appendChild(el("X509Certificate", {}, b64(key.certificateDer)));
  keyInfo.appendChild(x509);
  sig.appendChild(keyInfo);

  return new XMLSerializer().serializeToString(doc);
}

const child = (n: Node, name: string): Node => {
  for (const c of Array.from(n.childNodes ?? []) as Node[]) if (c.nodeType === 1 && c.namespaceURI === DS && c.localName === name) return c;
  return malformed(`нет ${name}`);
};

/** Проверка только математики последней подписи в корне (без цепочки и отзыва) — для тестов и проверки файлов */
export async function verifyXml(xml: string): Promise<{ valid: boolean; signerCertDer: Uint8Array }> {
  const doc = parseXml(xml);
  const root = doc.documentElement;
  const sigs = (Array.from(root.childNodes) as Node[]).filter((c) => c.nodeType === 1 && c.namespaceURI === DS && c.localName === "Signature");
  const sig = sigs.at(-1) ?? malformed("нет подписи");
  const signedInfo = child(sig, "SignedInfo");
  const sigAlg = child(signedInfo, "SignatureMethod").getAttribute("Algorithm");
  const algKey = (Object.keys(ALG) as (keyof typeof ALG)[]).find((k) => ALG[k].sig === sigAlg);
  if (!algKey) throw new KzSignError("UNSUPPORTED_ALGORITHM", String(sigAlg));
  const reference = child(signedInfo, "Reference");
  if (reference.getAttribute("URI") !== "") malformed("поддерживается только Reference URI=\"\"");
  const certDer = unb64(child(child(child(sig, "KeyInfo"), "X509Data"), "X509Certificate").textContent);
  const signatureValue = unb64(child(sig, "SignatureValue").textContent);
  const digestValue = unb64(child(reference, "DigestValue").textContent);

  const signedInfoBytes = enc(canon(signedInfo, false));
  root.removeChild(sig);
  const actualDigest = await digestOf(algKey, enc(canon(root, false)));
  if (!equal(actualDigest, digestValue)) return { valid: false, signerCertDer: certDer };

  const valid =
    algKey === "RSA"
      ? await rsaVerify(signedInfoBytes, signatureValue, certDer)
      : gost.verify(gost.digest(signedInfoBytes), signatureValue, gost.publicKeyFromCert(certDer));
  new pkijs.Certificate({ schema: asn1js.fromBER(certDer).result });
  return { valid, signerCertDer: certDer };
}
