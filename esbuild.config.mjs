import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");

const common = { bundle: true, platform: "browser", target: "chrome120", logLevel: "warning", legalComments: "none", alias: { crypto: "./src/shims/empty.ts" } };

await Promise.all([
  ...["shim", "bridge", "confirm", "popup"].map((name) =>
    build({ ...common, entryPoints: [`src/entries/${name}.ts`], outfile: `dist/${name}.js`, format: "iife" }),
  ),
  build({ ...common, entryPoints: ["src/entries/sw.ts"], outfile: "dist/sw.js", format: "esm" }),
]);

cpSync("manifest.json", "dist/manifest.json");
cpSync("static", "dist", { recursive: true });
