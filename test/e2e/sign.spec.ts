import { test, expect, chromium, type BrowserContext, type Page, type Frame } from "@playwright/test";
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
  server = createServer((req, res) => {
    if (req.url === "/ncalayer-client.js") { res.setHeader("content-type", "text/javascript"); return res.end(readFileSync("node_modules/ncalayer-js-client/ncalayer-client.js")); }
    res.setHeader("content-type", "text/html");
    res.end(readFileSync(req.url === "/client" ? "test/e2e/ncalayer-client.html" : "test/e2e/page.html"));
  });
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

test.beforeEach(async () => {
  const p = await ctx.newPage();
  await p.goto(`chrome-extension://${extId}/popup.html`);
  await p.evaluate(() => chrome.runtime.sendMessage({ type: "keys.forget" }));
  await p.close();
});

test.afterAll(async () => { await ctx?.close(); server?.close(); });

const signFrame = (text: string) => ({ module: "kz.gov.pki.knca.commonUtils", method: "createCAdESFromBase64", args: ["PKCS12", "SIGNATURE", Buffer.from(text).toString("base64"), true] });

async function confirmFrame(page: Page): Promise<Frame> {
  await expect.poll(() => page.frames().some((f) => f.url().includes("confirm.html")), { timeout: 10_000 }).toBe(true);
  const f = page.frames().find((x) => x.url().includes("confirm.html"))!;
  await f.waitForLoadState();
  return f;
}

async function startSigning(text: string): Promise<{ page: Page; result: Promise<any>; confirm: Frame }> {
  const page = await ctx.newPage();
  await page.goto(base);
  const result = page.evaluate((f) => (window as any).ncaCall(f), signFrame(text));
  const confirm = await confirmFrame(page);
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

test("второй раз — без пароля (ключ открыт до закрытия браузера)", async () => {
  const first = await startSigning("первый");
  await first.confirm.locator("input[type=password]").fill(PASSWORD);
  await first.confirm.getByRole("button", { name: "Подписать" }).click();
  expect((await first.result).code).toBe("200");
  await first.page.close();

  const second = await startSigning("второй");
  await expect(second.confirm.locator("input[type=password]")).toBeHidden();
  await expect(second.confirm.getByText("Ключ открыт до закрытия браузера")).toBeVisible();
  await second.confirm.getByRole("button", { name: "Подписать" }).click();
  const res = await second.result;
  expect(res.code).toBe("200");
  expect((await verifyCms(new Uint8Array(Buffer.from(res.responseObject, "base64")))).valid).toBe(true);
  await second.page.close();
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

test("окно на странице: после ответа оверлей исчезает", async () => {
  const { result, confirm, page } = await startSigning("x");
  await confirm.locator("input[type=password]").fill(PASSWORD);
  await confirm.getByRole("button", { name: "Подписать" }).click();
  expect((await result).code).toBe("200");
  await expect.poll(() => page.evaluate(() => document.querySelector("kzsign-confirm"))).toBeNull();
  await page.close();
});

test("Esc → action.canceled", async () => {
  const { result, confirm, page } = await startSigning("x");
  await expect(confirm.locator("input[type=password]")).toBeVisible();
  await confirm.locator("input[type=password]").press("Escape");
  expect(await result).toEqual({ code: "500", message: "action.canceled" });
  await page.close();
});

test("clickjacking: страница перекрыла окно — кнопка не включается", async () => {
  const { result, confirm, page } = await startSigning("x");
  await confirm.locator("input[type=password]").fill(PASSWORD);
  await expect(confirm.getByRole("button", { name: "Подписать" })).toBeEnabled({ timeout: 5_000 });
  await page.evaluate(() => {
    const d = document.createElement("div");
    d.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(255,255,255,.4);pointer-events:none";
    document.documentElement.append(d);
  });
  await expect(confirm.getByRole("button", { name: "Подписать" })).toBeDisabled({ timeout: 5_000 });
  await page.evaluate(() => document.documentElement.lastElementChild!.remove());
  await expect(confirm.getByRole("button", { name: "Подписать" })).toBeEnabled({ timeout: 5_000 });
  await confirm.getByRole("button", { name: "Отмена" }).click();
  await result;
  await page.close();
});

test("страница не видит URL окна (токен) через Resource Timing и DOM", async () => {
  const { result, confirm, page } = await startSigning("x");
  const leaks = await page.evaluate(() => [
    ...performance.getEntriesByType("resource").map((e) => e.name),
    ...performance.getEntriesByType("navigation").map((e) => e.name),
    document.documentElement.outerHTML,
    ...Array.from(window.frames, (f) => { try { return f.location.href; } catch { return ""; } }),
  ].filter((x) => x.includes("confirm.html")));
  expect(leaks).toEqual([]);
  await confirm.getByRole("button", { name: "Отмена" }).click();
  await result;
  await page.close();
});

test("кража фокуса: страница забрала фокус посреди ввода → пароль стёрт", async () => {
  const { result, confirm, page } = await startSigning("x");
  await confirm.locator("input[type=password]").fill("Qwer");
  await page.evaluate(() => { const i = document.createElement("input"); document.body.append(i); i.focus(); });
  await expect(confirm.locator("input[type=password]")).toHaveValue("");
  await expect(confirm.locator(".error")).toContainText("потеряло фокус");
  await confirm.getByRole("button", { name: "Отмена" }).click();
  await result;
  await page.close();
});

test("запрос из вложенного iframe другого домена → отдельное окно; закрытие окна → action.canceled", async () => {
  const page = await ctx.newPage();
  await page.goto(base);
  const inner = base.replace("localhost", "127.0.0.1");
  await page.evaluate((src) => new Promise<void>((r) => { const f = document.createElement("iframe"); f.src = src; f.onload = () => r(); document.body.append(f); }), inner);
  const frame = page.frames().find((f) => f.url().startsWith(inner))!;
  const winP = ctx.waitForEvent("page", (p) => p.url().includes("confirm.html"));
  const result = frame.evaluate((f) => (window as any).ncaCall(f), signFrame("x"));
  const win = await winP;
  await win.close();
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

test("сайт на ncalayer-js-client: connect + basicsSignCMS (как на госпорталах)", async () => {
  const page = await ctx.newPage();
  await page.goto(base + "client");
  const result = page.evaluate(async () => {
    const { NCALayerClient } = window as any;
    const client = new NCALayerClient();
    const version = await client.connect();
    const params = { ...NCALayerClient.basicsCMSParamsAttached, tsaProfile: undefined };
    const cms = await client.basicsSignCMS(NCALayerClient.basicsStorageAll, "Текст договора", { ...params, decode: false }, NCALayerClient.basicsSignerAny);
    return { version, cms };
  });
  const confirm = await confirmFrame(page);
  await expect(confirm.locator(".preview")).toHaveText("Текст договора");
  await confirm.locator("input[type=password]").fill(PASSWORD);
  await confirm.getByRole("button", { name: "Подписать" }).click();
  const { version, cms } = await result;
  expect(version).toBe("1.4");
  const der = new Uint8Array(Buffer.from(String(cms).replace(/-----[A-Z ]+-----|\s/g, ""), "base64"));
  expect((await verifyCms(der)).valid).toBe(true);
  await page.close();
});
