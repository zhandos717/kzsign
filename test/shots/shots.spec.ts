import { test, chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

for (const scheme of ["light", "dark"] as const) {
  test(`shots ${scheme}`, async () => {
    const server = createServer((_, r) => { r.setHeader("content-type", "text/html"); r.end(readFileSync("test/e2e/page.html")); });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://localhost:${(server.address() as { port: number }).port}/`;
    const ctx = await chromium.launchPersistentContext("", { channel: "chromium", colorScheme: scheme, args: [`--disable-extensions-except=${resolve("dist")}`, `--load-extension=${resolve("dist")}`] });
    const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
    const id = new URL(sw.url()).host;
    const p = await ctx.newPage();
    await p.setViewportSize({ width: 380, height: 600 });
    await p.goto(`chrome-extension://${id}/popup.html`);
    await p.screenshot({ path: `out/popup-empty-${scheme}.png` });
    await p.locator("input[type=file]").setInputFiles(resolve("test/fixtures/nca/ncanode-go-official/individual/valid/individual_valid.p12"));
    await p.locator("input[type=password]").fill("Qwerty12");
    await p.getByRole("button", { name: "Добавить" }).click();
    await p.locator(".key").first().waitFor({ timeout: 30000 });
    await p.screenshot({ path: `out/popup-keys-${scheme}.png`, fullPage: true });
    await p.getByRole("tab", { name: "Подпись" }).click();
    await p.screenshot({ path: `out/popup-sign-${scheme}.png`, fullPage: true });
    await p.getByRole("tab", { name: "Настройки" }).click();
    await p.screenshot({ path: `out/popup-settings-${scheme}.png`, fullPage: true });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.evaluate(() => { document.body.style.cssText = "margin:0;font:16px system-ui;background:#f6f7f9"; document.body.insertAdjacentHTML("afterbegin", "<header style='padding:18px 32px;background:#fff;border-bottom:1px solid #ddd;font-weight:600'>Портал документов</header><main style='padding:32px'><h1>Договор поставки № 17</h1><p>Проверьте документ и нажмите «Подписать ЭЦП».</p><button style='padding:10px 18px'>Подписать ЭЦП</button></main>"); });
    void page.evaluate(() => (window as any).ncaCall({ module: "kz.gov.pki.knca.commonUtils", method: "createCAdESFromBase64", args: ["PKCS12", "SIGNATURE", btoa(unescape(encodeURIComponent("ДОГОВОР ПОСТАВКИ № 17\nг. Алматы, 08.10.2026\n\nТОО «Поставщик» и ТОО «Покупатель» заключили настоящий договор о нижеследующем:\n1. Предмет договора — поставка оборудования.\n2. Сумма — 1 250 000 тенге."))), true] })).catch(() => {});
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.waitForTimeout(1500);
    const f = page.frames().find((x) => x.url().includes("confirm.html"))!;
    await f.locator("input[type=password]").fill("Qwerty12");
    await f.getByRole("button", { name: "Показать пароль" }).click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `out/confirm-${scheme}.png` });
    await ctx.close();
    server.close();
  });
}
