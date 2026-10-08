import type { KeyMeta } from "../sw/keystore";
import type { Mode } from "../sw/policy";

const app = document.getElementById("app")!;
const send = <T>(msg: object) => chrome.runtime.sendMessage(msg) as Promise<T & { error?: string; retryAfterSec?: number }>;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

const ERRORS: Record<string, string> = {
  BAD_PASSWORD: "Неверный пароль",
  UNSUPPORTED_ALGORITHM: "Этот тип ключа не поддерживается (ГОСТ 2004)",
  MALFORMED_P12: "Файл не похож на ключ .p12",
  PIN_LOCKED: "Слишком много попыток, подождите {s} с",
  BAD_REQUEST: "Некорректные данные",
};
const errorText = (r: { error?: string; retryAfterSec?: number }) => (ERRORS[r.error ?? ""] ?? r.error ?? "").replace("{s}", String(r.retryAfterSec ?? ""));

async function fileToB64(f: File): Promise<string> {
  const b = new Uint8Array(await f.arrayBuffer());
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

async function render() {
  app.replaceChildren(el("h1", { textContent: "KZSign" }));
  const { keys = [] } = await send<{ keys: KeyMeta[] }>({ type: "keys.list" });
  const { mode = "auto" } = await send<{ mode: Mode }>({ type: "mode.get" });

  const table = el("table");
  if (!keys.length) table.append(el("tr", {}, el("td", { className: "dim", textContent: "Ключей пока нет" })));
  for (const k of keys) {
    const del = el("button", { type: "button", className: "secondary", textContent: "Удалить" });
    del.onclick = async () => {
      if (!confirm(`Удалить ключ «${k.alias}» из расширения?`)) return;
      await send({ type: "keys.remove", id: k.id });
      void render();
    };
    const who = [k.iin && `ИИН ${k.iin}`, k.bin && `БИН ${k.bin}`].filter(Boolean).join(" · ");
    table.append(el("tr", {}, el("td", {}, el("strong", { textContent: k.alias }), el("div", { className: "dim", textContent: `${who} · до ${k.notAfter.slice(0, 10)} · ${k.algorithm === "RSA" ? "RSA" : "ГОСТ"}` })), el("td", {}, del)));
  }

  const file = el("input", { type: "file", accept: ".p12,.pfx" });
  const pass = el("input", { type: "password", autocomplete: "off", placeholder: "Пароль ключа" });
  const alias = el("input", { type: "text", placeholder: "Название (необязательно)" });
  const status = el("p", { className: "error" });
  const add = el("form", {}, el("h2", { textContent: "Добавить ключ" }), file, pass, alias, status, el("div", { className: "actions" }, el("button", { type: "submit", textContent: "Добавить" })));
  add.onsubmit = async (e) => {
    e.preventDefault();
    const f = file.files?.[0];
    if (!f) return void (status.textContent = "Выберите файл");
    status.textContent = "Проверяю…";
    const r = await send({ type: "keys.import", file: await fileToB64(f), password: pass.value, alias: alias.value });
    pass.value = "";
    if (r.error) return void (status.textContent = errorText(r));
    void render();
  };

  const modeSel = el("select");
  for (const [v, t] of [["auto", "Авто: свои ключи, иначе NCALayer"], ["extension", "Только расширение"], ["native", "Только настоящий NCALayer"]] as const) {
    modeSel.append(el("option", { value: v, textContent: t, selected: v === mode }));
  }
  modeSel.onchange = () => void send({ type: "mode.set", mode: modeSel.value });

  app.append(table, add, el("h2", { textContent: "Режим" }), modeSel);
  if (keys.length) app.append(signFileForm(keys));
}

function signFileForm(keys: KeyMeta[]) {
  const file = el("input", { type: "file" });
  const keySel = el("select");
  for (const k of keys) keySel.append(el("option", { value: k.id, textContent: k.alias }));
  const pass = el("input", { type: "password", autocomplete: "off", placeholder: "Пароль ключа" });
  const detached = el("input", { type: "checkbox" });
  const status = el("p", { className: "error" });
  const form = el("form", {}, el("h2", { textContent: "Подписать файл" }), file, keySel, pass, el("label", {}, detached, " Открепленная подпись (без файла внутри)"), status, el("div", { className: "actions" }, el("button", { type: "submit", textContent: "Подписать" })));
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = file.files?.[0];
    if (!f) return void (status.textContent = "Выберите файл");
    status.textContent = "Подписываю…";
    const r = await send<{ cms: string }>({ type: "file.sign", keyId: keySel.value, password: pass.value, file: await fileToB64(f), detached: detached.checked });
    pass.value = "";
    if (r.error) return void (status.textContent = errorText(r));
    const bytes = Uint8Array.from(atob(r.cms), (c) => c.charCodeAt(0));
    const a = el("a", { href: URL.createObjectURL(new Blob([bytes], { type: "application/pkcs7-signature" })), download: `${f.name}.cms` });
    a.click();
    status.textContent = "Готово";
  };
  return form;
}

void render();
