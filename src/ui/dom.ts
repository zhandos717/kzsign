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
  globe: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm6.9 6h-3a15.6 15.6 0 0 0-1.4-3.9A8 8 0 0 1 18.9 8ZM12 4c.8 1.1 1.5 2.5 1.9 4h-3.8c.4-1.5 1.1-2.9 1.9-4ZM4.3 14a8.2 8.2 0 0 1 0-4h3.4a16.5 16.5 0 0 0 0 4H4.3Zm.8 2h3a15.6 15.6 0 0 0 1.4 3.9A8 8 0 0 1 5.1 16Zm3-8h-3a8 8 0 0 1 4.4-3.9C8.9 5.3 8.4 6.6 8.1 8ZM12 20c-.8-1.1-1.5-2.5-1.9-4h3.8c-.4 1.5-1.1 2.9-1.9 4Zm2.3-6H9.7a14.7 14.7 0 0 1 0-4h4.6a14.7 14.7 0 0 1 0 4Zm.2 5.9c.6-1.2 1.1-2.5 1.4-3.9h3a8 8 0 0 1-4.4 3.9Zm1.8-5.9a16.5 16.5 0 0 0 0-4h3.4a8.2 8.2 0 0 1 0 4h-3.4Z",
  upload: "M12 3 7 8l1.4 1.4L11 6.8V16h2V6.8l2.6 2.6L17 8l-5-5ZM5 18h14v2H5v-2Z",
  plus: "M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z",
  pen: "M15.2 4.2a2.5 2.5 0 0 1 3.6 3.6L8 18.6 3 20l1.4-5L15.2 4.2Zm1.4 1.4L6.2 16l-.6 2.3 2.3-.6L18.4 7.2a.5.5 0 0 0 0-.7l-1.1-1.1a.5.5 0 0 0-.7.2Z",
  clock: "M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm1 3v4.6l3.2 3.2-1.4 1.4L11 12.4V7h2Z",
  gear: "M10.3 2h3.4l.5 2.6c.6.2 1.1.5 1.6.9l2.5-.9 1.7 2.9-2 1.7a6.6 6.6 0 0 1 0 1.8l2 1.7-1.7 2.9-2.5-.9c-.5.4-1 .7-1.6.9l-.5 2.6h-3.4l-.5-2.6c-.6-.2-1.1-.5-1.6-.9l-2.5.9-1.7-2.9 2-1.7a6.6 6.6 0 0 1 0-1.8l-2-1.7 1.7-2.9 2.5.9c.5-.4 1-.7 1.6-.9l.5-2.6ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
  back: "M15.4 5.4 14 4l-8 8 8 8 1.4-1.4L8.8 12l6.6-6.6Z",
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
  const text = el("span", {}, `${label} или `, el("span", { className: "pick", textContent: "выберите" }));
  const root = el("label", { className: "drop" }, icon("upload"), text, input);
  const show = () => {
    const f = input.files?.[0];
    root.classList.toggle("has-file", !!f);
    text.replaceChildren(f ? `${f.name} · ${(f.size / 1024).toFixed(1)} КБ` : `${label} или `, f ? "" : el("span", { className: "pick", textContent: "выберите" }));
  };
  input.onchange = show;
  root.addEventListener("dragover", (e) => { e.preventDefault(); root.classList.add("drag"); });
  root.addEventListener("dragleave", () => root.classList.remove("drag"));
  root.addEventListener("drop", (e) => {
    e.preventDefault();
    root.classList.remove("drag");
    if (e.dataTransfer?.files.length) {
      input.files = e.dataTransfer.files;
      show();
    }
  });
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
