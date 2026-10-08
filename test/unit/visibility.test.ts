// @vitest-environment happy-dom
import { it, expect, vi } from "vitest";
import { watchVisibility } from "../../src/ui/visibility";

it("нет IntersectionObserver v2 → unsupported", () => {
  const onUnsupported = vi.fn();
  watchVisibility(document.body, () => {}, onUnsupported, {} as typeof globalThis);
  expect(onUnsupported).toHaveBeenCalled();
});

it("isVisible и полное пересечение → видно; перекрыто → не видно", () => {
  let cb!: (entries: unknown[]) => void;
  const opts: unknown[] = [];
  class FakeIO { constructor(f: typeof cb, o: unknown) { cb = f; opts.push(o); } observe() {} disconnect() {} }
  const states: boolean[] = [];
  watchVisibility(document.body, (v) => states.push(v), () => { throw new Error("unsupported"); }, { IntersectionObserver: FakeIO } as unknown as typeof globalThis);
  expect(opts[0]).toMatchObject({ trackVisibility: true, delay: 100 });
  cb([{ isVisible: true, intersectionRatio: 1 }]);
  cb([{ isVisible: false, intersectionRatio: 1 }]);
  cb([{ isVisible: true, intersectionRatio: 0.6 }]);
  expect(states).toEqual([true, false, false]);
});

it("браузер не отдаёт isVisible в записи → unsupported", () => {
  let cb!: (entries: unknown[]) => void;
  class FakeIO { constructor(f: typeof cb) { cb = f; } observe() {} disconnect() {} }
  const onUnsupported = vi.fn();
  watchVisibility(document.body, () => {}, onUnsupported, { IntersectionObserver: FakeIO } as unknown as typeof globalThis);
  cb([{ intersectionRatio: 1 }]);
  expect(onUnsupported).toHaveBeenCalled();
});
