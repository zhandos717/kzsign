import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

// 16 px рисуется отдельной упрощённой версией: мелкие детали большой иконки в 16 px сливаются
const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  const svg = readFileSync(size === 16 ? "assets/icon-16.svg" : "assets/icon.svg", "utf8");
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: `static/icons/icon${size}.png`, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
await browser.close();
