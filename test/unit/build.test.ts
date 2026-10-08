import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

describe("build", () => {
  beforeAll(() => { execSync("npm run build", { stdio: "pipe" }); }, 60_000);

  it("собирает все точки входа", () => {
    for (const f of ["manifest.json", "shim.js", "bridge.js", "sw.js", "confirm.js", "popup.js", "confirm.html", "popup.html", "ui.css"]) {
      expect(existsSync(`dist/${f}`), f).toBe(true);
    }
  });

  it("манифест с минимальными правами", () => {
    const m = JSON.parse(readFileSync("dist/manifest.json", "utf8"));
    expect(m.permissions).toEqual(["storage", "alarms"]);
    expect(m.host_permissions).toEqual(["http://tsp.pki.gov.kz/*"]);
    expect(m.externally_connectable).toBeUndefined();
    expect(JSON.stringify(m)).not.toContain("scripting");
  });
});
