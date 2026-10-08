export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string | false | null | undefined)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith("aria-") || k === "role" || k.startsWith("data-")) e.setAttribute(k, String(v));
    else (e as unknown as Record<string, unknown>)[k] = v;
  }
  e.append(...children.filter((c): c is Node | string => c !== false && c !== null && c !== undefined));
  return e;
}

const PATHS = {
  shield: "M12 2 4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5l-8-3Zm-1.2 13.6-3.4-3.4 1.4-1.4 2 2 4.6-4.6 1.4 1.4-6 6Z",
  lock: "M7 10V7a5 5 0 0 1 10 0v3h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h1Zm2 0h6V7a3 3 0 0 0-6 0v3Z",
  trash: "M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Z",
  key: "M14 3a7 7 0 0 0-6.7 9L2 17.3V22h4.7l1-1v-2h2v-2h2l1.3-1.3A7 7 0 1 0 14 3Zm2 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z",
  file: "M6 2h8l6 6v14H6V2Zm7 1.5V9h5.5L13 3.5Z",
  eye: "M12 5c5 0 9 4.5 10 7-1 2.5-5 7-10 7S3 14.5 2 12c1-2.5 5-7 10-7Zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z",
  eyeOff: "M3.3 2 22 20.7 20.7 22l-3.3-3.3A10.8 10.8 0 0 1 12 20c-5 0-9-4.5-10-7a14 14 0 0 1 4-5.3L2 3.3 3.3 2Zm5.2 7.9A4 4 0 0 0 14 15.5l-1.5-1.5a2 2 0 0 1-2.5-2.5L8.5 9.9ZM12 5c5 0 9 4.5 10 7a13.6 13.6 0 0 1-3.2 4.5l-2.9-2.9A4 4 0 0 0 10.4 8.1L8.2 6A10.6 10.6 0 0 1 12 5Z",
} as const;

export function icon(name: keyof typeof PATHS, className = ""): SVGSVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  if (className) svg.setAttribute("class", className);
  const p = document.createElementNS(NS, "path");
  p.setAttribute("d", PATHS[name]);
  svg.append(p);
  return svg;
}

export function topbar(sub?: string): HTMLElement {
  const logo = icon("shield", "logo");
  return el("header", { className: "topbar" }, logo, el("span", { className: "title", textContent: "KZSign" }), sub ? el("span", { className: "sub", textContent: sub }) : null);
}

export const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";

export function validity(notAfter: string, now = Date.now()): { label: string; tone: "ok" | "warn" | "err" } {
  const days = Math.floor((Date.parse(notAfter) - now) / 86_400_000);
  const date = new Date(notAfter).toLocaleDateString("ru-RU");
  if (days < 0) return { label: `истёк ${date}`, tone: "err" };
  if (days <= 30) return { label: `до ${date} · ${days} дн.`, tone: "warn" };
  return { label: `до ${date}`, tone: "ok" };
}

export function fileDrop(label: string, accept?: string): { root: HTMLLabelElement; input: HTMLInputElement } {
  const input = el("input", { type: "file", ...(accept ? { accept } : {}) });
  const title = el("strong", { textContent: label });
  const hint = el("span", { className: "muted small", textContent: "Нажмите, чтобы выбрать" });
  const root = el("label", { className: "drop" }, icon("file"), title, hint, input);
  input.onchange = () => {
    const f = input.files?.[0];
    root.classList.toggle("has-file", !!f);
    title.textContent = f ? f.name : label;
    hint.textContent = f ? `${(f.size / 1024).toFixed(1)} КБ · нажмите, чтобы заменить` : "Нажмите, чтобы выбрать";
  };
  return { root, input };
}

export function passwordField(props: Record<string, unknown> = {}): { root: HTMLElement; input: HTMLInputElement } {
  const input = el("input", { className: "input", type: "password", autocomplete: "off", spellcheck: false, ...props });
  const toggle = el("button", { type: "button", className: "eye", "aria-label": "Показать пароль", title: "Показать пароль" }, icon("eye"));
  toggle.onclick = () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    const label = show ? "Скрыть пароль" : "Показать пароль";
    toggle.setAttribute("aria-label", label);
    toggle.title = label;
    toggle.replaceChildren(icon(show ? "eyeOff" : "eye"));
    input.focus();
  };
  return { root: el("div", { className: "pwfield" }, input, toggle), input };
}
