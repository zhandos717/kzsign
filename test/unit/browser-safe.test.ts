import { it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));

it("src/ не использует Node-only API (код работает в service worker)", () => {
  const bad = walk("src").filter((f) => /\bBuffer\b|from "node:|require\(/.test(readFileSync(f, "utf8")));
  expect(bad).toEqual([]);
});
