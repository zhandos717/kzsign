import type { KeyMeta } from "../sw/keystore";
import type { Mode } from "../sw/policy";
import type { HistoryEntry } from "../sw/history";
import { el, icon, topbar, initials, validity, fileDrop, passwordField } from "./dom";

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
let tab: "keys" | "sign" | "history" | "settings" = "keys";
let historyQuery = "";
let openIds: string[] = [];

async function render() {
  const [{ keys = [], open = [] }, { mode = "auto" }] = await Promise.all([send<{ keys: KeyMeta[]; open: string[] }>({ type: "keys.list" }), send<{ mode: Mode }>({ type: "mode.get" })]);
  openIds = open;
  const tabs = el("nav", { className: "tabs", role: "tablist" });
  for (const [id, label] of [["keys", "Ключи"], ["sign", "Подпись"], ["history", "История"], ["settings", "Настройки"]] as const) {
    tabs.append(el("button", { type: "button", role: "tab", "aria-selected": String(tab === id), textContent: label, onclick: () => { tab = id; void render(); } }));
  }
  const body = tab === "keys" ? keysTab(keys) : tab === "sign" ? signTab(keys) : tab === "history" ? await historyTab() : settingsTab(mode);
  app.replaceChildren(topbar(MODES.find((m) => m.value === mode)!.title), tabs, el("div", { className: "content" }, ...body.filter(Boolean) as Node[]));
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
  const passField = passwordField();
  const pass = passField.input;
  const alias = el("input", { className: "input", type: "text", placeholder: "Например: Рабочий" });
  const status = el("p", { className: "error", role: "alert" });
  const submit = el("button", { type: "submit", className: "btn block", textContent: "Добавить" });
  const form = el("form", { className: "card" },
    el("h2", { textContent: "Добавить ключ" }),
    el("div", { style: "display:grid;gap:10px" }, drop.root,
      el("div", { className: "field" }, el("span", { textContent: "Пароль ключа" }), passField.root),
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
  const passField = passwordField({ placeholder: "Не нужен, если ключ открыт" });
  const pass = passField.input;
  const detached = el("input", { type: "checkbox" });
  const status = el("p", { className: "error", role: "alert" });
  const done = el("div");
  const submit = el("button", { type: "submit", className: "btn block", textContent: "Подписать" });
  const form = el("form", { className: "card" },
    el("h2", { textContent: "Подписать файл" }),
    el("div", { style: "display:grid;gap:10px" }, drop.root,
      el("label", { className: "field" }, el("span", { textContent: "Ключ" }), keySel),
      el("div", { className: "field" }, el("span", { textContent: "Пароль ключа" }), passField.root),
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
    const r = await send<{ cms: string }>({ type: "file.sign", keyId: keySel.value, password: pass.value, file: await fileToB64(f), fileName: f.name, detached: detached.checked });
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

const STATUS = { signed: ["подписано", "ok"], canceled: ["отменено", ""], error: ["ошибка", "err"] } as const;

function historyEntry(e: HistoryEntry) {
  const [label, tone] = STATUS[e.status];
  const where = e.source === "file" ? `Файл: ${e.fileName ?? "без имени"}` : (e.origin ?? "").replace(/^https?:\/\//, "");
  const when = new Date(e.at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const del = el("button", { type: "button", className: "icon-btn", title: "Удалить запись", "aria-label": "Удалить запись" }, icon("trash"));
  del.onclick = async () => { await send({ type: "history.remove", id: e.id }); void render(); };
  const details = el("details", { className: "hash" },
    el("summary", { textContent: "Подробнее" }),
    ...e.items.map((it, i) => el("div", { style: "margin-top:6px" },
      el("div", { className: "small", textContent: `${e.items.length > 1 ? `Документ ${i + 1}: ` : ""}${it.isHash ? "хэш" : "данные"}, ${it.size} Б${e.tsa ? " · с меткой времени" : ""}` }),
      it.text ? el("pre", { className: "preview", textContent: it.text }) : null,
      el("code", { textContent: `SHA-256 ${it.sha256}` }))),
    e.errorCode ? el("div", { className: "small", style: "margin-top:6px", textContent: `Код ошибки: ${e.errorCode}` }) : null);
  return el("div", { className: "hist" },
    el("div", { className: "hist-head" },
      el("strong", { className: "hist-where", textContent: where, title: e.origin ?? e.fileName ?? "" }),
      el("span", { className: `badge ${tone}`, textContent: label }),
      del),
    el("div", { className: "meta small muted" },
      el("span", { textContent: when }),
      e.key && el("span", { textContent: `${e.key.alias}${e.key.iin ? " · ИИН " + e.key.iin : e.key.bin ? " · БИН " + e.key.bin : ""}` }),
      e.items.length > 1 && el("span", { textContent: `${e.items.length} док.` })),
    details);
}

async function historyTab() {
  const { entries = [] } = await send<{ entries: HistoryEntry[] }>({ type: "history.list", query: historyQuery });
  const search = el("input", { className: "input", type: "search", placeholder: "Поиск: сайт, файл, ИИН", value: historyQuery });
  let t: ReturnType<typeof setTimeout>;
  search.oninput = () => { clearTimeout(t); t = setTimeout(() => { historyQuery = search.value; void render().then(() => { const s = document.querySelector<HTMLInputElement>("input[type=search]"); s?.focus(); s?.setSelectionRange(s.value.length, s.value.length); }); }, 250); };
  const list = entries.length
    ? el("div", { className: "hist-list" }, ...entries.map(historyEntry))
    : el("div", { className: "empty" }, icon("file"), el("p", { textContent: historyQuery ? "Ничего не найдено." : "Подписей пока не было." }));
  const clear = el("button", { type: "button", className: "btn ghost", textContent: "Очистить историю" });
  clear.onclick = async () => {
    if (!confirm("Удалить всю историю подписей?")) return;
    await send({ type: "history.clear" });
    void render();
  };
  return [
    el("section", { className: "card" }, el("h2", { textContent: "История подписей" }), search, el("div", { style: "margin-top:10px" }, list)),
    entries.length || historyQuery ? el("div", { style: "display:flex;justify-content:space-between;align-items:center;gap:8px" },
      el("span", { className: "muted small", textContent: "Хранятся только сведения о подписи — без документов и самих подписей. Последние 500 записей." }), clear) : null,
  ];
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
