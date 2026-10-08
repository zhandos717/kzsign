// @vitest-environment happy-dom
import { it, expect } from "vitest";
import { validity, initials, el } from "../../src/ui/dom";

const now = Date.parse("2026-10-08T00:00:00Z");
it("validity: ok / скоро истекает / истёк", () => {
  expect(validity("2027-05-08T00:00:00Z", now).tone).toBe("ok");
  expect(validity("2026-10-20T00:00:00Z", now)).toMatchObject({ tone: "warn", label: expect.stringContaining("12 дн.") });
  expect(validity("2026-01-01T00:00:00Z", now).tone).toBe("err");
});
it("initials", () => {
  expect(initials("ТЕСТОВ ТЕСТ")).toBe("ТТ");
  expect(initials("  ")).toBe("?");
});
it("el не интерпретирует HTML в тексте", () => {
  const e = el("div", { textContent: "<img src=x onerror=alert(1)>" });
  expect(e.children).toHaveLength(0);
  expect(e.textContent).toBe("<img src=x onerror=alert(1)>");
});

it("passwordField: кнопка-глаз переключает видимость и подпись кнопки", async () => {
  const { passwordField } = await import("../../src/ui/dom");
  const { root, input } = passwordField({ placeholder: "Пароль" });
  const btn = root.querySelector("button")!;
  expect(input.type).toBe("password");
  expect(btn.getAttribute("aria-label")).toBe("Показать пароль");
  expect(btn.type).toBe("button");
  btn.click();
  expect(input.type).toBe("text");
  expect(btn.getAttribute("aria-label")).toBe("Скрыть пароль");
  btn.click();
  expect(input.type).toBe("password");
});
