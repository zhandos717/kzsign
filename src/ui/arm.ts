// Защита от «перехвата ввода»: окно подтверждения может всплыть, пока пользователь печатает на странице.
// Кнопка активна только после паузы с момента, как окно получило фокус.
export function armAfterFocus(button: HTMLButtonElement, win: Window, delayMs = 1000): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const disarm = () => {
    clearTimeout(timer);
    button.disabled = true;
  };
  const arm = () => {
    disarm();
    timer = setTimeout(() => { button.disabled = false; }, delayMs);
  };
  win.addEventListener("blur", disarm);
  win.addEventListener("focus", arm);
  arm();
}
