import forge from "node-forge";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import * as curves from "@li0ard/gostcurves";
import { streebog256, streebog512 } from "@li0ard/streebog";
import { readFixture, GOST2015_INDIVIDUAL, NCA_GOST2022_CA, FIXTURE_PASSWORD } from "../test/helpers/fixtures";

const rev = (b: Uint8Array) => Uint8Array.from(b).reverse();
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.binary.raw.encode(readFixture(GOST2015_INDIVIDUAL))), false, FIXTURE_PASSWORD);
const bags = p12.safeContents.flatMap((s) => s.safeBags);
const certBag: any = bags.find((b) => b.type === forge.pki.oids.certBag);
const keyBag: any = bags.find((b) => b.type === forge.pki.oids.pkcs8ShroudedKeyBag);
console.log("certBag.asn1 tag/children", certBag.asn1?.tagClass, certBag.asn1?.type, certBag.asn1?.value?.length);
const certDer = forge.util.binary.raw.decode(forge.asn1.toDer(certBag.asn1).getBytes());

function findCert(der: Uint8Array): Uint8Array {
  // сначала пробуем как сертификат, иначе ищем вложенный OCTET STRING с DER сертификата
  try { new pkijs.Certificate({ schema: asn1js.fromBER(der).result }); return der; } catch {}
  const walk = (n: any): Uint8Array | null => {
    if (n instanceof asn1js.OctetString) {
      const inner = new Uint8Array(n.valueBlock.valueHexView);
      try { new pkijs.Certificate({ schema: asn1js.fromBER(inner).result }); return inner; } catch {}
    }
    for (const c of n.valueBlock?.value ?? []) { const r = walk(c); if (r) return r; }
    return null;
  };
  const r = walk(asn1js.fromBER(der).result);
  if (!r) throw new Error("cert not found");
  return r;
}

const parseCert = (der: Uint8Array) => new pkijs.Certificate({ schema: asn1js.fromBER(der).result });
const pubKeyBytes = (c: pkijs.Certificate) =>
  new Uint8Array((asn1js.fromBER(c.subjectPublicKeyInfo.subjectPublicKey.valueBlock.valueHexView).result as asn1js.OctetString).valueBlock.valueHexView);

const leafDer = findCert(certDer);
const leaf = parseCert(leafDer);
const ca = parseCert(readFixture(NCA_GOST2022_CA));
const tbs = new Uint8Array(leaf.tbsView);
const sig = new Uint8Array(leaf.signatureValue.valueBlock.valueHexView);
const caPub = pubKeyBytes(ca);
console.log("sigAlg", leaf.signatureAlgorithm.algorithmId, "sig", sig.length, "caPub", caPub.length, "caParams", JSON.stringify(ca.subjectPublicKeyInfo.algorithm.algorithmParams?.toJSON?.()?.valueBlock?.value?.map((v: any) => v.valueBlock?.value?.map?.((x: any) => x.valueDec)) ?? null));

const half = (b: Uint8Array) => [b.slice(0, b.length / 2), b.slice(b.length / 2)] as const;
const swapHalves = (b: Uint8Array) => { const [a, c] = half(b); return Uint8Array.from([...c, ...a]); };
const revHalves = (b: Uint8Array) => { const [a, c] = half(b); return Uint8Array.from([...rev(a), ...rev(c)]); };

const hashes = { h256: streebog256(tbs), h256Rev: rev(streebog256(tbs)), h512: streebog512(tbs), h512Rev: rev(streebog512(tbs)) };
const pfx = (b: Uint8Array) => Uint8Array.from([4, ...b]);
const pubs = { pub: pfx(caPub), pubRev: pfx(rev(caPub)), pubSwap: pfx(swapHalves(caPub)), pubRevHalves: pfx(revHalves(caPub)) };
const sigs = { sig, sigRev: rev(sig), sigSwap: swapHalves(sig), sigRevHalves: revHalves(sig) };

const curveEntries = Object.entries(curves).filter(([k]) => k.startsWith("ID_GOSTR3410"));
const matches: unknown[] = [];
for (const [curveName, curve] of curveEntries)
  for (const [hn, h] of Object.entries(hashes)) for (const [pn, p] of Object.entries(pubs)) for (const [sn, s] of Object.entries(sigs)) {
    try { if (curves.verify(curve as any, p, h, s)) matches.push({ curveName, hn, pn, sn }); } catch (e) { if (!(globalThis as any).__e) { (globalThis as any).__e = 1; console.log("verify err", String(e)); } }
  }
console.log("MATCHES", JSON.stringify(matches));

// закрытый ключ: структура PKCS#8
const pk = keyBag.asn1;
console.log("pkcs8 der", hex(forge.util.binary.raw.decode(forge.asn1.toDer(pk).getBytes())).replace(/(.{64})/g, "$1\n"));

const priv = forge.util.binary.raw.decode(pk.value[2].value).slice(2); // OCTET STRING { OCTET STRING(64) }
const leafPub = pubKeyBytes(leaf);
console.log("priv", priv.length, "leafPub", leafPub.length);
const pubVariants = (p: Uint8Array) => ({ raw: p, rev: rev(p), swap: swapHalves(p), revHalves: revHalves(p) });
for (const [curveName, curve] of curveEntries)
  for (const [vn, d] of Object.entries({ priv, privRev: rev(priv) })) {
    try {
      const P = curves.getPublicKey(curve as any, d).slice(1);
      for (const [pn, pv] of Object.entries(pubVariants(P))) if (hex(pv) === hex(leafPub)) console.log("PUB MATCH", { curveName, vn, pn });
    } catch (e) { }
  }
console.log("curve probe done; sample P len", curves.getPublicKey(curves.ID_GOSTR3410_2012_512_PARAM_SET_A as any, rev(priv)).length);

const C = curves.ID_GOSTR3410_2012_512_PARAM_SET_A as any;
const toNca = { hash: (h: Uint8Array) => rev(h), sigFromLib: revHalves, sigToLib: revHalves, pubToLib: (p: Uint8Array) => pfx(revHalves(p)), priv: rev };
const d = toNca.hash(streebog512(new TextEncoder().encode("test")));
const s1 = toNca.sigFromLib(curves.sign(C, toNca.priv(priv), d));
console.log("self-verify:", curves.verify(C, toNca.pubToLib(leafPub), d, toNca.sigToLib(s1)));
const s2 = toNca.sigFromLib(curves.sign(C, toNca.priv(priv), d));
console.log("nondeterministic:", hex(s1) !== hex(s2));
