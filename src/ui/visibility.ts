// IntersectionObserver v2: isVisible=true гарантирует, что элемент не перекрыт, не прозрачен и не искажён.
// Это защита от clickjacking, когда окно подтверждения встроено в чужую страницу.
export function watchVisibility(
  target: Element,
  onChange: (visible: boolean) => void,
  onUnsupported: () => void,
  g: typeof globalThis = globalThis,
): void {
  const IO = g.IntersectionObserver;
  if (!IO) return onUnsupported();
  let unsupported = false;
  const io = new IO(
    (entries) => {
      for (const e of entries as (IntersectionObserverEntry & { isVisible?: boolean })[]) {
        if (typeof e.isVisible !== "boolean") {
          if (!unsupported) { unsupported = true; io.disconnect(); onUnsupported(); }
          return;
        }
        onChange(e.isVisible && e.intersectionRatio >= 0.99);
      }
    },
    { threshold: [1], trackVisibility: true, delay: 100 } as IntersectionObserverInit,
  );
  io.observe(target);
}
