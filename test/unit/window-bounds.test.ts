import { it, expect } from "vitest";
import { confirmWindowBounds } from "../../src/sw/window-bounds";

it("справа сверху от окна браузера, компактный размер", () => {
  expect(confirmWindowBounds({ left: 100, top: 50, width: 1400, height: 900 })).toEqual({ width: 400, height: 600, left: 100 + 1400 - 400 - 16, top: 50 + 72 });
});

it("узкое окно браузера — не вылезаем за левый край", () => {
  expect(confirmWindowBounds({ left: 0, top: 0, width: 300, height: 500 })).toMatchObject({ left: 0, top: 72 });
});

it("нет данных о родительском окне — без координат (Chrome сам поставит)", () => {
  expect(confirmWindowBounds(undefined)).toEqual({ width: 400, height: 600 });
});
