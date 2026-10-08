// Защита от «перехвата ввода»: окно подтверждения может всплыть, пока пользователь печатает на странице.
// Кнопка активна только после паузы с момента, как окно получило фокус (и стало видимым — guard).
// Фокус, полученный кликом мыши внутри окна, паузу не перезапускает: это осознанное действие, иначе первый клик теряется.
export function armAfterFocus(button: HTMLButtonElement, win: Window, delayMs = 1000, guard: () => boolean = () => true) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let armed = false;
  let lastPointer = -Infinity;
  const disarm = () => {
    clearTimeout(timer);
    armed = false;
    button.disabled = true;
  };
  const rearm = () => {
    disarm();
    timer = setTimeout(() => { armed = true; button.disabled = !guard(); }, delayMs);
  };
  win.document.addEventListener("pointerdown", () => { lastPointer = Date.now(); }, true);
  win.addEventListener("blur", () => {
    // blur сам по себе кнопку не выключает, если следом придёт фокус от клика; решает focus
    clearTimeout(timer);
    if (!armed) return;
    button.disabled = true;
  });
  win.addEventListener("focus", () => {
    if (armed && Date.now() - lastPointer < 500) {
      button.disabled = !guard();
      return;
    }
    rearm();
  });
  rearm();
  return { rearm, disarm };
}
