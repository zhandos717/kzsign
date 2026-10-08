import type { KeyMeta } from "../sw/keystore";
import type { Mode } from "../sw/policy";
import type { HistoryEntry } from "../sw/history";
import type { TrustedSite } from "../sw/trusted-sites";
import { el, icon, initials, validity, fileDrop, passwordField } from "./dom";

type Reply<T> = T & { error?: string; retryAfterSec?: number };
const send = <T>(msg: object) => chrome.runtime.sendMessage(msg) as Promise<Reply<T>>;

const ERRORS: Record<string, string> = {
  BAD_PASSWORD: "Неверный пароль",
  NEED_PASSWORD: "Введите пароль ключа",
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

type View = "keys" | "add" | "sign" | "history" | "settings";
const TITLES: Record<View, string> = { keys: "KZSign", add: "Добавить ЭЦП", sign: "Подписать файл", history: "История", settings: "Настройки" };

const app = document.getElementById("app")!;
let view: View = "keys";
let historyQuery = "";
const go = (v: View) => { view = v; void render(); };

async function fileToB64(f: File): Promise<string> {
  const b = new Uint8Array(await f.arrayBuffer());
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

function header() {
  const iconBtn = (name: Parameters<typeof icon>[0], label: string, onclick: () => void) =>
    el("button", { type: "button", className: "icon-btn", title: label, "aria-label": label, onclick }, icon(name));
  if (view === "keys") {
    return el("header", { className: "pheader" },
      icon("shield", "logo"), el("span", { className: "name", textContent: "KZSign" }),
      iconBtn("pen", "Подписать файл", () => go("sign")),
      iconBtn("clock", "История", () => go("history")),
      iconBtn("gear", "Настройки", () => go("settings")));
  }
  return el("header", { className: "pheader" },
    el("button", { type: "button", className: "icon-btn back", title: "Назад", "aria-label": "Назад", onclick: () => go("keys") }, icon("back")),
    el("span", { className: "name", textContent: TITLES[view] }));
}

function status(mode: Mode) {
  const native = mode === "native";
  return el("div", { className: `status${native ? " native" : ""}` }, el("span", { className: "dot" }),
    native ? "Запросы уходят в установленный NCALayer" : `Подключено · режим «${MODES.find((m) => m.value === mode)!.title}»`);
}

async function render() {
  const [{ keys = [], open = [] }, { mode = "auto" }] = await Promise.all([
    send<{ keys: KeyMeta[]; open: string[] }>({ type: "keys.list" }),
    send<{ mode: Mode }>({ type: "mode.get" }),
  ]);
  const body =
    view === "keys" ? keysView(keys, open)
    : view === "add" ? addView()
    : view === "sign" ? signView(keys, open)
    : view === "history" ? await historyView()
    : await settingsView(mode, open);
  app.replaceChildren(el("div", { className: "popup" },
    header(),
    view === "keys" ? status(mode) : el("div"),
    el("div", { className: "pbody" }, ...body.filter(Boolean) as Node[]),
    el("footer", { className: "pfooter" }, el("span", { textContent: `v${chrome.runtime.getManifest().version}` }), el("span", { textContent: "Ключи хранятся только в этом браузере" }))));
}

function keyCard(k: KeyMeta, isOpen: boolean) {
  const v = validity(k.notAfter);
  const del = el("button", { type: "button", className: "icon-btn danger", title: "Удалить ключ", "aria-label": `Удалить ключ ${k.alias}` }, icon("trash"));
  del.onclick = async () => {
    if (!confirm(`Удалить ключ «${k.alias}» из KZSign?\nФайл .p12 на диске останется.`)) return;
    await send({ type: "keys.remove", id: k.id });
    void render();
  };
  return el("div", { className: "keycard" },
    el("div", { className: "avatar", textContent: initials(k.subjectCn) }),
    el("div", {},
      el("div", { className: "name", textContent: k.alias, title: k.subjectCn }),
      el("div", { className: "meta" },
        k.iin && el("span", { textContent: `ИИН ${k.iin}` }),
        k.bin && el("span", { textContent: `БИН ${k.bin}` }),
        el("span", { className: `badge ${v.tone}`, textContent: v.label }),
        el("span", { className: "badge", textContent: k.algorithm === "RSA" ? "RSA" : "ГОСТ" }),
        isOpen && el("span", { className: "badge ok", textContent: "открыт", title: "Пароль не нужен до закрытия браузера" }))),
    del);
}

function keysView(keys: KeyMeta[], open: string[]) {
  if (!keys.length) {
    return [el("div", { className: "empty" },
      el("div", { className: "icon-box lg" }, icon("key")),
      el("b", { textContent: "Нет добавленных ЭЦП" }),
      el("p", { textContent: "Добавьте файл .p12, чтобы подписывать документы прямо в браузере" }),
      el("button", { type: "button", className: "btn", onclick: () => go("add") }, icon("plus"), "Добавить ЭЦП"))];
  }
  return [
    el("div", { className: "keys" }, ...keys.map((k) => keyCard(k, open.includes(k.id)))),
    el("button", { type: "button", className: "btn secondary block", onclick: () => go("add") }, icon("plus"), "Добавить ЭЦП"),
  ];
}

function addView() {
  const drop = fileDrop("Перетащите .p12", ".p12,.pfx");
  const pw = passwordField({ placeholder: "Введите пароль" });
  const alias = el("input", { className: "input", type: "text", placeholder: "Например: Рабочий" });
  const statusEl = el("p", { className: "error", role: "alert" });
  const submit = el("button", { type: "submit", className: "btn block", textContent: "Добавить" });
  const form = el("form", { className: "stack" },
    drop.root,
    el("div", {}, el("span", { className: "label", textContent: "Пароль" }), pw.root),
    el("label", {}, el("span", { className: "label", textContent: "Название (необязательно)" }), alias),
    statusEl, submit,
    el("p", { className: "faint small center", style: "margin:0", textContent: "Ключ сохраняется в браузере в зашифрованном виде. Пароль не сохраняется." }));
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = drop.input.files?.[0];
    if (!f) return void (statusEl.textContent = "Выберите файл ключа");
    submit.disabled = true;
    submit.textContent = "Проверяю…";
    const r = await send({ type: "keys.import", file: await fileToB64(f), password: pw.input.value, alias: alias.value });
    pw.input.value = "";
    submit.disabled = false;
    submit.textContent = "Добавить";
    if (r.error) return void (statusEl.textContent = errorText(r));
    go("keys");
  };
  return [form];
}

function signView(keys: KeyMeta[], open: string[]) {
  if (!keys.length) return [el("div", { className: "empty" }, el("div", { className: "icon-box lg" }, icon("key")), el("b", { textContent: "Сначала добавьте ЭЦП" }), el("button", { type: "button", className: "btn", onclick: () => go("add") }, icon("plus"), "Добавить ЭЦП"))];
  const drop = fileDrop("Перетащите файл");
  const keySel = el("select", { className: "input" }, ...keys.map((k) => el("option", { value: k.id, textContent: `${k.alias}${k.iin ? " · ИИН " + k.iin : ""}` })));
  const pw = passwordField({ placeholder: "Введите пароль" });
  const pwBlock = el("div", {}, el("span", { className: "label", textContent: "Пароль" }), pw.root);
  const sync = () => { pwBlock.hidden = open.includes(keySel.value); };
  keySel.onchange = sync;
  sync();
  const detached = el("input", { type: "checkbox" });
  const statusEl = el("p", { className: "error", role: "alert" });
  const done = el("div");
  const submit = el("button", { type: "submit", className: "btn block", textContent: "Подписать" });
  const form = el("form", { className: "stack" },
    drop.root,
    el("label", {}, el("span", { className: "label", textContent: "Ключ" }), keySel),
    pwBlock,
    el("label", { className: "check" }, detached, "Открепленная подпись (файл не включается в .cms)"),
    statusEl, done, submit);
  form.onsubmit = async (e) => {
    e.preventDefault();
    done.replaceChildren();
    const f = drop.input.files?.[0];
    if (!f) return void (statusEl.textContent = "Выберите файл");
    statusEl.textContent = "";
    submit.disabled = true;
    submit.textContent = "Подписываю…";
    const r = await send<{ cms: string }>({ type: "file.sign", keyId: keySel.value, password: pw.input.value, file: await fileToB64(f), fileName: f.name, detached: detached.checked });
    pw.input.value = "";
    submit.disabled = false;
    submit.textContent = "Подписать";
    if (r.error) return void (statusEl.textContent = errorText(r));
    const bytes = Uint8Array.from(atob(r.cms), (c) => c.charCodeAt(0));
    el("a", { href: URL.createObjectURL(new Blob([bytes], { type: "application/pkcs7-signature" })), download: `${f.name}.cms` }).click();
    done.replaceChildren(el("div", { className: "note ok", textContent: `Готово: ${f.name}.cms сохранён в «Загрузки»` }));
    if (!open.includes(keySel.value)) { open.push(keySel.value); sync(); }
  };
  return [form];
}

const STATUS = { signed: ["подписано", "ok"], canceled: ["отменено", ""], error: ["ошибка", "err"] } as const;

function historyEntry(e: HistoryEntry) {
  const [label, tone] = STATUS[e.status];
  const where = e.source === "file" ? `Файл: ${e.fileName ?? "без имени"}` : (e.origin ?? "").replace(/^https?:\/\//, "");
  const when = new Date(e.at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const del = el("button", { type: "button", className: "icon-btn danger", title: "Удалить запись", "aria-label": "Удалить запись" }, icon("trash"));
  del.onclick = async () => { await send({ type: "history.remove", id: e.id }); void render(); };
  return el("div", { className: "hist" },
    el("div", { className: "hist-head" }, el("span", { className: "hist-where", textContent: where, title: e.origin ?? e.fileName ?? "" }), el("span", { className: `badge ${tone}`, textContent: label }), del),
    el("div", { className: "meta" },
      el("span", { textContent: when }),
      e.key && el("span", { textContent: `${e.key.alias}${e.key.iin ? " · ИИН " + e.key.iin : e.key.bin ? " · БИН " + e.key.bin : ""}` }),
      e.items.length > 1 && el("span", { textContent: `${e.items.length} док.` })),
    el("details", { className: "hash" },
      el("summary", { textContent: "Подробнее" }),
      ...e.items.map((it, i) => el("div", { style: "margin-top:6px" },
        el("div", { className: "small", textContent: `${e.items.length > 1 ? `Документ ${i + 1}: ` : ""}${it.isHash ? "хэш" : "данные"}, ${it.size} Б${e.tsa ? " · с меткой времени" : ""}` }),
        it.text ? el("pre", { className: "preview", textContent: it.text }) : null,
        el("code", { textContent: `SHA-256 ${it.sha256}` }))),
      e.errorCode ? el("div", { className: "small", style: "margin-top:6px", textContent: `Код ошибки: ${e.errorCode}` }) : null));
}

async function historyView() {
  const { entries = [] } = await send<{ entries: HistoryEntry[] }>({ type: "history.list", query: historyQuery });
  const search = el("input", { className: "input", type: "search", placeholder: "Поиск: сайт, файл, ИИН", value: historyQuery });
  let t: ReturnType<typeof setTimeout>;
  search.oninput = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      historyQuery = search.value;
      void render().then(() => {
        const s = document.querySelector<HTMLInputElement>("input[type=search]");
        s?.focus();
        s?.setSelectionRange(s.value.length, s.value.length);
      });
    }, 250);
  };
  const list = entries.length
    ? el("div", { className: "stack", style: "gap:8px" }, ...entries.map(historyEntry))
    : el("div", { className: "empty" }, el("div", { className: "icon-box lg" }, icon("clock")), el("b", { textContent: historyQuery ? "Ничего не найдено" : "Подписей пока не было" }));
  const clear = el("button", { type: "button", className: "btn text", textContent: "Очистить историю" });
  clear.onclick = async () => {
    if (!confirm("Удалить всю историю подписей?")) return;
    await send({ type: "history.clear" });
    void render();
  };
  return [
    search,
    list,
    entries.length ? el("div", { className: "row", style: "justify-content:space-between" }, el("span", { className: "faint small", textContent: "Только сведения — без документов и подписей" }), clear) : null,
  ];
}

async function settingsView(mode: Mode, open: string[]) {
  const options = el("div", { className: "options", role: "radiogroup" });
  for (const m of MODES) {
    const input = el("input", { type: "radio", name: "mode", value: m.value, checked: m.value === mode });
    input.onchange = async () => { await send({ type: "mode.set", mode: m.value }); void render(); };
    options.append(el("label", { className: "option" }, input, el("span", {}, el("b", { textContent: m.title }), el("span", { className: "muted small", textContent: m.text }))));
  }
  const { sites = [] } = await send<{ sites: TrustedSite[] }>({ type: "sites.list" });
  const siteRows = sites.length
    ? el("div", { className: "stack", style: "gap:6px" }, ...sites.map((s) => {
        const del = el("button", { type: "button", className: "icon-btn danger", title: "Забыть сайт", "aria-label": `Забыть ${s.origin}` }, icon("trash"));
        del.onclick = async () => { await send({ type: "sites.remove", origin: s.origin }); void render(); };
        return el("div", { className: "list-row" }, icon("globe"), el("span", { textContent: s.origin.replace(/^https?:\/\//, ""), title: s.origin }), del);
      }))
    : el("p", { className: "faint small", style: "margin:0", textContent: "Пока нет. Отметьте «Запомнить сайт» в окне подписи." });
  return [
    el("div", { className: "section-title", textContent: "Кто подписывает" }), options,
    el("div", { className: "section-title", textContent: "Знакомые сайты" }),
    el("p", { className: "faint small", style: "margin:-4px 0 0", textContent: "На них окно подписи не предупреждает «видим впервые». Подтверждение всё равно нужно." }),
    siteRows,
    el("div", { className: "section-title", textContent: "Открытые ключи" }),
    open.length
      ? el("div", { className: "row", style: "justify-content:space-between" },
          el("span", { className: "small muted", textContent: `Открыто: ${open.length}. Подписывают без пароля до закрытия браузера.` }),
          el("button", { type: "button", className: "btn secondary", textContent: "Забыть", onclick: async () => { await send({ type: "keys.forget" }); void render(); } }))
      : el("p", { className: "faint small", style: "margin:0", textContent: "Нет открытых ключей." }),
  ];
}

void render();
