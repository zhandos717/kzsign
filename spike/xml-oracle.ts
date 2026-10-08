import { readFileSync } from "node:fs";
import { DOMParser } from "@xmldom/xmldom";
import { C14nCanonicalization, C14nCanonicalizationWithComments } from "xml-crypto/lib/c14n-canonicalization.js";
import { EnvelopedSignature } from "xml-crypto/lib/enveloped-signature.js";
import { gost } from "../src/core/crypto/gost";

const raw = readFileSync("/tmp/claude-501/ref.xml", "utf8").split("\n").slice(1).join("\n");
const doc = new DOMParser().parseFromString(raw, "text/xml");
const NS = "http://www.w3.org/2000/09/xmldsig#";
const sig = doc.getElementsByTagNameNS(NS, "Signature")[0]!;
const text = (tag: string) => sig.getElementsByTagNameNS(NS, tag)[0]!.textContent!.replace(/\s|&#13;/g, "");
const b64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const rev = (b: Uint8Array) => Uint8Array.from(b).reverse();

const digestRef = b64(text("DigestValue"));
const sigVal = b64(text("SignatureValue"));
const certB64 = text("X509Certificate");
console.log("digest", digestRef.length, "sig", sigVal.length);

// Reference: enveloped + c14n with comments over whole document
const root = doc.documentElement!;
const env = new EnvelopedSignature().process(root.cloneNode(true) as any, { signatureNode: sig } as any);
const c14nDoc = new C14nCanonicalizationWithComments().process(env as any, {}) as string;
const h = gost.digest(new TextEncoder().encode(c14nDoc));
console.log("digest plain:", hex(h) === hex(digestRef), " reversed:", hex(rev(h)) === hex(digestRef));

// SignedInfo c14n (without comments)
const si = sig.getElementsByTagNameNS(NS, "SignedInfo")[0]!;
const c14nSi = new C14nCanonicalization().process(si as any, { ancestorNamespaces: [{ prefix: "ds", namespaceURI: NS }] } as any) as string;
console.log("SignedInfo c14n head:", c14nSi.slice(0, 120));
const pub = gost.publicKeyFromCert(b64(certB64));
const siHash = gost.digest(new TextEncoder().encode(c14nSi));
const half = sigVal.length / 2;
const variants: Record<string, Uint8Array> = {
  asIs: sigVal,
  rev: rev(sigVal),
  swap: Uint8Array.from([...sigVal.slice(half), ...sigVal.slice(0, half)]),
  revHalves: Uint8Array.from([...rev(sigVal.slice(0, half)), ...rev(sigVal.slice(half))]),
};
for (const [n, v] of Object.entries(variants)) console.log("sig", n, gost.verify(siHash, v, pub));

const original = "<login><timeTicket>1700000000</timeTicket></login>";
const h2 = gost.digest(new TextEncoder().encode(original));
console.log("digest(original) plain:", hex(h2) === hex(digestRef), " reversed:", hex(rev(h2)) === hex(digestRef));
sig.parentNode!.removeChild(sig);
const c14nNoSig = new C14nCanonicalizationWithComments().process(doc.documentElement as any, {}) as string;
console.log("c14n after removal:", JSON.stringify(c14nNoSig), hex(gost.digest(new TextEncoder().encode(c14nNoSig))) === hex(digestRef));
