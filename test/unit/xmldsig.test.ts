import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { signXml, verifyXml } from "../../src/core/xmldsig";
import { parseP12 } from "../../src/core/p12";
import { KzSignError } from "../../src/core/errors";
import { readFixture, FIXTURE_PASSWORD, GOST2015_INDIVIDUAL, RSA_PERSONAL } from "../helpers/fixtures";

const gostKey = parseP12(readFixture(GOST2015_INDIVIDUAL), FIXTURE_PASSWORD);
const rsaKey = parseP12(readFixture(RSA_PERSONAL), FIXTURE_PASSWORD);
const LOGIN = "<login><timeTicket>1700000000</timeTicket></login>";

describe("xmldsig", () => {
  it.each(["ncanode-gost-login.xml", "ncanode-gost-namespaces-comments.xml"])("эталон Kalkan (NCANode) %s проходит нашу проверку — оракул формата НУЦ", async (f) => {
    const ref = readFileSync(`test/fixtures/xml/${f}`, "utf8");
    expect(await verifyXml(ref)).toMatchObject({ valid: true });
  });

  it("комментарии не входят в подпись (URI=\"\" по стандарту XMLDSig их отбрасывает)", async () => {
    const signed = await signXml("<r><!-- a --><x>1</x></r>", gostKey);
    expect((await verifyXml(signed.replace("<!-- a -->", "<!-- b -->"))).valid).toBe(true);
  });

  it.each([["ГОСТ", gostKey, "urn:ietf:params:xml:ns:pkigovkz:xmlsec:algorithms:gostr34102015-gostr34112015-512"], ["RSA", rsaKey, "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"]])(
    "%s: подпись вкладывается в корень и проверяется",
    async (_, key, alg) => {
      const signed = await signXml(LOGIN, key);
      expect(signed).toContain(`<ds:SignatureMethod Algorithm="${alg}"/>`);
      expect(signed).toContain('<ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>');
      expect(signed.indexOf("<ds:Signature")).toBeGreaterThan(signed.indexOf("</timeTicket>"));
      expect(await verifyXml(signed)).toMatchObject({ valid: true });
    },
  );

  it("изменение подписанного содержимого ломает проверку", async () => {
    const signed = await signXml(LOGIN, gostKey);
    expect((await verifyXml(signed.replace("1700000000", "1700000001"))).valid).toBe(false);
  });

  it("пространства имён и атрибуты в корне сохраняются", async () => {
    const xml = '<r:root xmlns:r="urn:x" xmlns="urn:default" a="1"><item b="2">т</item></r:root>';
    const signed = await signXml(xml, gostKey);
    expect(signed.startsWith('<r:root xmlns:r="urn:x" xmlns="urn:default" a="1">')).toBe(true);
    expect((await verifyXml(signed)).valid).toBe(true);
  });

  it.each([
    ["DOCTYPE", '<!DOCTYPE r [<!ENTITY x "y">]><r>&x;</r>'],
    ["не XML", "просто текст"],
    ["пусто", ""],
    ["битый XML", "<a><b></a>"],
  ])("%s → MALFORMED_XML", async (_, xml) => {
    const e = await signXml(xml, gostKey).catch((x) => x);
    expect(e).toBeInstanceOf(KzSignError);
    expect((e as KzSignError).code).toBe("MALFORMED_XML");
  });
});
