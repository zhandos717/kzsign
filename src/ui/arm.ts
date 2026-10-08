// Защита от «перехвата ввода»: окно подтверждения может всплыть, пока пользователь печатает на странице.
// Кнопка активна только после паузы с момента, как окно получило фокус (и стало видимым — guard).
export function armAfterFocus(button: HTMLButtonElement, win: Window, delayMs = 1000, guard: () => boolean = () => true) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const disarm = () => {
    clearTimeout(timer);
    button.disabled = true;
  };
  const rearm = () => {
    disarm();
    timer = setTimeout(() => { button.disabled = !guard(); }, delayMs);
  };
  win.addEventListener("blur", disarm);
  win.addEventListener("focus", rearm);
  rearm();
  return { rearm, disarm };
}
