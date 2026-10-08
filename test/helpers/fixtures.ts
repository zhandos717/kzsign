import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/nca");

export const FIXTURE_PASSWORD = "Qwerty12";
export const GOST2015_INDIVIDUAL = "ncanode-go-official/individual/valid/individual_valid.p12";
export const GOST2015_INDIVIDUAL_REVOKED = "ncanode-go-official/individual/revoked/individual_revoked.p12";
export const RSA_PERSONAL = "danikarik/personal/active/RSA256_11c707bd54cbfcccb3815e39c4eb57b1dc7dfea9.p12";
export const GOST2004_ORG = "danikarik/organization/active/GOSTKNCA_13a3741b52d7bf860aab199b56fad1f4652e357b.p12";
export const NCA_GOST2022_CA = "ncanode-go-official/nca_gost2022_test.cer";

export function readFixture(rel: string): Uint8Array {
  return new Uint8Array(readFileSync(join(ROOT, rel)));
}
