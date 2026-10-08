// @vitest-environment happy-dom
import { it, expect, vi } from "vitest";
import { armAfterFocus } from "../../src/ui/arm";

it("кнопка включается только через паузу после фокуса окна и снова блокируется при его потере (ревью #1)", () => {
  vi.useFakeTimers();
  const b = document.createElement("button");
  armAfterFocus(b, window, 1000);
  expect(b.disabled).toBe(true);
  vi.advanceTimersByTime(999);
  expect(b.disabled).toBe(true);
  vi.advanceTimersByTime(1);
  expect(b.disabled).toBe(false);
  window.dispatchEvent(new Event("blur"));
  expect(b.disabled).toBe(true);
  window.dispatchEvent(new Event("focus"));
  vi.advanceTimersByTime(500);
  expect(b.disabled).toBe(true);
  vi.advanceTimersByTime(500);
  expect(b.disabled).toBe(false);
  vi.useRealTimers();
});

it("guard: таймер не включает кнопку, пока условие ложно; rearm после выполнения условия", () => {
  vi.useFakeTimers();
  const b = document.createElement("button");
  let visible = false;
  const gate = armAfterFocus(b, window, 1000, () => visible);
  vi.advanceTimersByTime(2000);
  expect(b.disabled).toBe(true);
  visible = true;
  gate.rearm();
  vi.advanceTimersByTime(999);
  expect(b.disabled).toBe(true);
  vi.advanceTimersByTime(1);
  expect(b.disabled).toBe(false);
  visible = false;
  gate.disarm();
  expect(b.disabled).toBe(true);
  vi.useRealTimers();
});

it("фокус от клика мышью внутри окна не сбрасывает паузу (иначе первый клик теряется); фокус без клика — сбрасывает", () => {
  vi.useFakeTimers();
  const b = document.createElement("button");
  armAfterFocus(b, window, 1000);
  vi.advanceTimersByTime(1000);
  expect(b.disabled).toBe(false);
  window.dispatchEvent(new Event("blur"));
  window.document.dispatchEvent(new Event("pointerdown"));
  window.dispatchEvent(new Event("focus"));
  expect(b.disabled).toBe(false);
  vi.advanceTimersByTime(1000);
  window.dispatchEvent(new Event("blur"));
  window.dispatchEvent(new Event("focus"));
  expect(b.disabled).toBe(true);
  vi.useRealTimers();
});
