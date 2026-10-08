import { readFileSync } from "node:fs";
import { DOMParser } from "@xmldom/xmldom";
import { C14nCanonicalization, C14nCanonicalizationWithComments } from "xml-crypto/lib/c14n-canonicalization.js";
import { gost } from "../src/core/crypto/gost";

const DS = "http://www.w3.org/2000/09/xmldsig#";
const doc: any = new DOMParser().parseFromString(readFileSync("out/ns.ref.xml", "utf8"), "text/xml");
const root = doc.documentElement;
const sig = root.getElementsByTagNameNS(DS, "Signature")[0];
const si = sig.getElementsByTagNameNS(DS, "SignedInfo")[0];
const val = (n: string) => Buffer.from(sig.getElementsByTagNameNS(DS, n)[0].textContent.replace(/\s/g, ""), "base64");
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const anc = [{ prefix: "r", namespaceURI: "urn:x" }, { prefix: "", namespaceURI: "urn:default" }];

for (const [name, a] of Object.entries({ withAnc: anc, none: [] as typeof anc })) {
  const c = new C14nCanonicalization().process(si, { ancestorNamespaces: a } as any) as string;
  const ok = gost.verify(gost.digest(new TextEncoder().encode(c)), new Uint8Array(val("SignatureValue")), gost.publicKeyFromCert(new Uint8Array(val("X509Certificate"))));
  console.log("SignedInfo", name, ok, c.slice(0, 160).replace(/\n/g, "⏎"));
}
root.removeChild(sig);
const d = new C14nCanonicalizationWithComments().process(root, {}) as string;
console.log("doc digest ok:", hex(gost.digest(new TextEncoder().encode(d))) === hex(new Uint8Array(val("DigestValue"))), JSON.stringify(d.slice(-60)));
for (const variant of [d.replace(/\n$/, ""), d + "\n", d.replace("\n<", "<")]) console.log(" variant", hex(gost.digest(new TextEncoder().encode(variant))) === hex(new Uint8Array(val("DigestValue"))));
const noComments = new C14nCanonicalization().process(root, {}) as string;
console.log("doc digest WITHOUT comments ok:", hex(gost.digest(new TextEncoder().encode(noComments))) === hex(new Uint8Array(val("DigestValue"))));
