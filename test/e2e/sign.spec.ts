import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { verifyCms } from "../../src/core/signer";

const DIST = resolve("dist");
const KEY = resolve("test/fixtures/nca/ncanode-go-official/individual/valid/individual_valid.p12");
const PASSWORD = "Qwerty12";

let ctx: BrowserContext;
let extId: string;
let server: Server;
let base: string;

test.beforeAll(async () => {
  server = createServer((_, res) => { res.setHeader("content-type", "text/html"); res.end(readFileSync("test/e2e/page.html")); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://localhost:${(server.address() as { port: number }).port}/`;
  ctx = await chromium.launchPersistentContext("", { channel: "chromium", args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`] });
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
  extId = new URL(sw.url()).host;

  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.locator("input[type=file]").setInputFiles(KEY);
  await popup.locator("input[type=password]").fill(PASSWORD);
  await popup.getByRole("button", { name: "Добавить" }).click();
  await expect(popup.locator(".key")).toHaveCount(1, { timeout: 30_000 });
  await popup.close();
});

test.afterAll(async () => { await ctx?.close(); server?.close(); });

const signFrame = (text: string) => ({ module: "kz.gov.pki.knca.commonUtils", method: "createCAdESFromBase64", args: ["PKCS12", "SIGNATURE", Buffer.from(text).toString("base64"), true] });

async function startSigning(text: string): Promise<{ page: Page; result: Promise<any>; confirm: Page }> {
  const page = await ctx.newPage();
  await page.goto(base);
  const confirmP = ctx.waitForEvent("page", (p) => p.url().includes("confirm.html"));
  const result = page.evaluate((f) => (window as any).ncaCall(f), signFrame(text));
  const confirm = await confirmP;
  await confirm.waitForLoadState();
  return { page, result, confirm };
}

test("подпись: окно показывает сайт и данные, CMS валиден", async () => {
  const { result, confirm, page } = await startSigning("Договор e2e");
  await expect(confirm.locator(".origin")).toContainText("localhost");
  await expect(confirm.locator(".preview")).toHaveText("Договор e2e");
  await confirm.locator("input[type=password]").fill(PASSWORD);
  await confirm.getByRole("button", { name: "Подписать" }).click();
  const res = await result;
  expect(res.code).toBe("200");
  expect((await verifyCms(new Uint8Array(Buffer.from(res.responseObject, "base64")))).valid).toBe(true);
  await page.close();
});

test("неверный пароль: окно остаётся с ошибкой, потом верный проходит", async () => {
  const { result, confirm, page } = await startSigning("x");
  await confirm.locator("input[type=password]").fill("wrong");
  await confirm.getByRole("button", { name: "Подписать" }).click();
  await expect(confirm.locator(".error")).toHaveText("Неверный пароль", { timeout: 20_000 });
  await confirm.locator("input[type=password]").fill(PASSWORD);
  await confirm.getByRole("button", { name: "Подписать" }).click();
  expect((await result).code).toBe("200");
  await page.close();
});

test("отмена → action.canceled", async () => {
  const { result, confirm, page } = await startSigning("x");
  await confirm.getByRole("button", { name: "Отмена" }).click();
  expect(await result).toEqual({ code: "500", message: "action.canceled" });
  await page.close();
});

test("закрытие окна → action.canceled", async () => {
  const { result, confirm, page } = await startSigning("x");
  await confirm.close();
  expect(await result).toEqual({ code: "500", message: "action.canceled" });
  await page.close();
});

test("обычные WebSocket сайта не перехватываются", async () => {
  const page = await ctx.newPage();
  await page.goto(base);
  const tag = await page.evaluate(() => {
    const ws = new WebSocket("ws://127.0.0.1:9/");
    ws.close();
    return Object.prototype.toString.call(ws);
  });
  expect(tag).toBe("[object WebSocket]");
  await page.close();
});
