import { readFileSync } from "node:fs";
import { parseP12 } from "../src/core/p12";
import { signXml } from "../src/core/xmldsig";

const [p12Path, password, xmlPath] = process.argv.slice(2);
if (!p12Path || !password || !xmlPath) {
  console.error("usage: tsx scripts/sign-xml.ts <key.p12> <password> <file.xml>");
  process.exit(2);
}
process.stdout.write(await signXml(readFileSync(xmlPath, "utf8"), parseP12(new Uint8Array(readFileSync(p12Path)), password)));
