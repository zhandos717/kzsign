import { readFileSync, writeFileSync } from "node:fs";
import { parseP12 } from "../src/core/p12";
import { signCms } from "../src/core/signer";

const [p12Path, password, inPath, mode = "attached"] = process.argv.slice(2);
if (!p12Path || !password || !inPath) {
  console.error("usage: tsx scripts/sign-file.ts <key.p12> <password> <file> [attached|detached]");
  process.exit(2);
}
const key = parseP12(new Uint8Array(readFileSync(p12Path)), password);
const cms = await signCms(new Uint8Array(readFileSync(inPath)), key, { detached: mode === "detached" });
writeFileSync(`${inPath}.cms`, cms);
console.log(`${inPath}.cms`, cms.length, "bytes", key.algorithm);
