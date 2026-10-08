import type { KeyMeta } from "../sw/keystore";
import type { Mode } from "../sw/policy";
import { el, icon, topbar, initials, validity, fileDrop } from "./dom";

type Reply<T> = T & { error?: string; retryAfterSec?: number };
const send = <T>(msg: object) => chrome.runtime.sendMessage(msg) as Promise<Reply<T>>;

const ERRORS: Record<string, string> = {
  BAD_PASSWORD: "Неверный пароль",
  UNSUPPORTED_ALGORITHM: "Этот тип ключа не поддерживается (ГОСТ 2004)",
  MALFORMED_P12: "Файл не похож на ключ .p12",
  PIN_LOCKED: "Слишком много попыток, подождите {s} с",
  BAD_REQUEST: "Некорректные данные",
};
const errorText = (r: { error?: string; retryAfterSec?: number }) => (ERRORS[r.error ?? ""] ?? r.error ?? "").replace("{s}", String(r.retryAfterSec ?? ""));

const MODES: { value: Mode; title: string; text: string }[] = [
  { value: "auto", title: "Авто", text: "Подписывает KZSign, если в нём есть ключи; иначе — установленный NCALayer." },
  { value: "extension", title: "Только KZSign", text: "Настоящий NCALayer не используется." },
  { value: "native", title: "Только NCALayer", text: "Все запросы уходят в установленный NCALayer." },
];

async function fileToB64(f: File): Promise<string> {
  const b = new Uint8Array(await f.arrayBuffer());
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

const app = document.getElementById("app")!;
let tab: "keys" | "sign" | "settings" = "keys";
let openIds: string[] = [];

async function render() {
  const [{ keys = [], open = [] }, { mode = "auto" }] = await Promise.all([send<{ keys: KeyMeta[]; open: string[] }>({ type: "keys.list" }), send<{ mode: Mode }>({ type: "mode.get" })]);
  openIds = open;
  const tabs = el("nav", { className: "tabs", role: "tablist" });
  for (const [id, label] of [["keys", "Ключи"], ["sign", "Подпись"], ["settings", "Настройки"]] as const) {
    tabs.append(el("button", { type: "button", role: "tab", "aria-selected": String(tab === id), textContent: label, onclick: () => { tab = id; void render(); } }));
  }
  const body = tab === "keys" ? keysTab(keys) : tab === "sign" ? signTab(keys) : settingsTab(mode);
  app.replaceChildren(topbar(MODES.find((m) => m.value === mode)!.title), tabs, el("div", { className: "content" }, ...body));
}

function keyCard(k: KeyMeta) {
  const v = validity(k.notAfter);
  const del = el("button", { type: "button", className: "icon-btn", title: "Удалить ключ", "aria-label": `Удалить ключ ${k.alias}` }, icon("trash"));
  del.onclick = async () => {
    if (!confirm(`Удалить ключ «${k.alias}» из KZSign?\nФайл .p12 на диске останется.`)) return;
    await send({ type: "keys.remove", id: k.id });
    void render();
  };
  return el("div", { className: "key" },
    el("div", { className: "avatar", textContent: initials(k.subjectCn) }),
    el("div", {},
      el("div", { className: "name", textContent: k.alias, title: k.subjectCn }),
      el("div", { className: "meta" },
        k.iin && el("span", { textContent: `ИИН ${k.iin}` }),
        k.bin && el("span", { textContent: `БИН ${k.bin}` }),
        el("span", { className: `badge ${v.tone}`, textContent: v.label }),
        el("span", { className: "badge", textContent: k.algorithm === "RSA" ? "RSA" : "ГОСТ" }),
        openIds.includes(k.id) && el("span", { className: "badge ok", textContent: "открыт", title: "Пароль не нужен до закрытия браузера" }))),
    del);
}

function keysTab(keys: KeyMeta[]) {
  const list = keys.length
    ? el("div", { className: "keys" }, ...keys.map(keyCard))
    : el("div", { className: "empty" }, icon("key"), el("p", { textContent: "Ключей пока нет. Добавьте файл .p12 от НУЦ РК." }));

  const drop = fileDrop("Файл ключа .p12", ".p12,.pfx");
  const pass = el("input", { className: "input", type: "password", autocomplete: "off" });
  const alias = el("input", { className: "input", type: "text", placeholder: "Например: Рабочий" });
  const status = el("p", { className: "error", role: "alert" });
  const submit = el("button", { type: "submit", className: "btn block", textContent: "Добавить" });
  const form = el("form", { className: "card" },
    el("h2", { textContent: "Добавить ключ" }),
    el("div", { style: "display:grid;gap:10px" }, drop.root,
      el("label", { className: "field" }, el("span", { textContent: "Пароль ключа" }), pass),
      el("label", { className: "field" }, el("span", { textContent: "Название (необязательно)" }), alias),
      status, submit),
    el("p", { className: "muted small", textContent: "Ключ хранится в браузере в зашифрованном виде. Пароль не сохраняется." }));
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = drop.input.files?.[0];
    if (!f) return void (status.textContent = "Выберите файл ключа");
    submit.disabled = true;
    submit.textContent = "Проверяю…";
    const r = await send({ type: "keys.import", file: await fileToB64(f), password: pass.value, alias: alias.value });
    pass.value = "";
    submit.disabled = false;
    submit.textContent = "Добавить";
    if (r.error) return void (status.textContent = errorText(r));
    void render();
  };
  const forget = openIds.length
    ? el("div", { className: "note ok small", style: "display:flex;align-items:center;gap:8px;justify-content:space-between" },
        el("span", { textContent: "Открытые ключи подписывают без пароля до закрытия браузера." }),
        el("button", { type: "button", className: "btn ghost", textContent: "Забыть", onclick: async () => { await send({ type: "keys.forget" }); void render(); } }))
    : null;
  return [el("section", { className: "card" }, el("h2", { textContent: "Мои ключи" }), list, forget && el("div", { style: "margin-top:10px" }, forget)), form];
}

function signTab(keys: KeyMeta[]) {
  if (!keys.length) return [el("div", { className: "card empty" }, icon("key"), el("p", { textContent: "Сначала добавьте ключ на вкладке «Ключи»." }))];
  const drop = fileDrop("Файл для подписи");
  const keySel = el("select", { className: "input" }, ...keys.map((k) => el("option", { value: k.id, textContent: `${k.alias}${k.iin ? " · ИИН " + k.iin : ""}` })));
  const pass = el("input", { className: "input", type: "password", autocomplete: "off", placeholder: "Не нужен, если ключ открыт" });
  const detached = el("input", { type: "checkbox" });
  const status = el("p", { className: "error", role: "alert" });
  const done = el("div");
  const submit = el("button", { type: "submit", className: "btn block", textContent: "Подписать" });
  const form = el("form", { className: "card" },
    el("h2", { textContent: "Подписать файл" }),
    el("div", { style: "display:grid;gap:10px" }, drop.root,
      el("label", { className: "field" }, el("span", { textContent: "Ключ" }), keySel),
      el("label", { className: "field" }, el("span", { textContent: "Пароль ключа" }), pass),
      el("label", { className: "check" }, detached, "Открепленная подпись (файл не включается в .cms)"),
      status, done, submit));
  form.onsubmit = async (e) => {
    e.preventDefault();
    done.replaceChildren();
    const f = drop.input.files?.[0];
    if (!f) return void (status.textContent = "Выберите файл");
    status.textContent = "";
    submit.disabled = true;
    submit.textContent = "Подписываю…";
    const r = await send<{ cms: string }>({ type: "file.sign", keyId: keySel.value, password: pass.value, file: await fileToB64(f), detached: detached.checked });
    pass.value = "";
    submit.disabled = false;
    submit.textContent = "Подписать";
    if (r.error) return void (status.textContent = errorText(r));
    const bytes = Uint8Array.from(atob(r.cms), (c) => c.charCodeAt(0));
    el("a", { href: URL.createObjectURL(new Blob([bytes], { type: "application/pkcs7-signature" })), download: `${f.name}.cms` }).click();
    done.replaceChildren(el("div", { className: "note ok", textContent: `Готово: ${f.name}.cms сохранён в «Загрузки»` }));
  };
  return [form];
}

function settingsTab(mode: Mode) {
  const options = el("div", { className: "options", role: "radiogroup" });
  for (const m of MODES) {
    const input = el("input", { type: "radio", name: "mode", value: m.value, checked: m.value === mode });
    input.onchange = async () => { await send({ type: "mode.set", mode: m.value }); void render(); };
    options.append(el("label", { className: "option" }, input, el("span", {}, el("b", { textContent: m.title }), el("span", { className: "muted small", textContent: m.text }))));
  }
  return [
    el("section", { className: "card" }, el("h2", { textContent: "Кто подписывает" }), options),
    el("section", { className: "card small muted" }, el("p", { style: "margin:0", textContent: "KZSign отвечает сайтам вместо NCALayer. Каждая подпись подтверждается в отдельном окне расширения — сайт не может подписать без вашего пароля." })),
  ];
}

void render();
