import { readFileSync, writeFileSync } from "node:fs";
import { parseP12 } from "../src/core/p12";
import { signCms } from "../src/core/signer";
import { httpTsp } from "../src/core/tsp";

const args = process.argv.slice(2);
const withTsp = args.includes("--tsp");
const [p12Path, password, inPath, mode = "attached"] = args.filter((a) => a !== "--tsp");
if (!p12Path || !password || !inPath) {
  console.error("usage: tsx scripts/sign-file.ts <key.p12> <password> <file> [attached|detached] [--tsp]");
  process.exit(2);
}
const key = parseP12(new Uint8Array(readFileSync(p12Path)), password);
const cms = await signCms(new Uint8Array(readFileSync(inPath)), key, { detached: mode === "detached", tsp: withTsp ? httpTsp() : undefined });
writeFileSync(`${inPath}.cms`, cms);
console.log(`${inPath}.cms`, cms.length, "bytes", key.algorithm);
