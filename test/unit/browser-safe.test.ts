import { it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));

it("src/ не использует Node-only API (код работает в service worker)", () => {
  const bad = walk("src").filter((f) => /\bBuffer\b|from "node:|require\(/.test(readFileSync(f, "utf8")));
  expect(bad).toEqual([]);
});

it("в src/ нет невидимых и bidi-символов (Trojan Source)", () => {
  const ranges = [[0x200b, 0x200f], [0x2028, 0x2029], [0x202a, 0x202e], [0x2060, 0x2069], [0xfeff, 0xfeff]];
  const bad = walk("src").filter((f) => [...readFileSync(f, "utf8")].some((ch) => ranges.some(([a, b]) => ch.codePointAt(0)! >= a! && ch.codePointAt(0)! <= b!)));
  expect(bad).toEqual([]);
});
