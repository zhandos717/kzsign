import type { ConfirmRequest, AnswerResult } from "../sw/confirm-manager";
import type { KeyMeta } from "../sw/keystore";
import { splitHost } from "./site";
import { armAfterFocus } from "./arm";
import { watchVisibility } from "./visibility";
import { el, icon, validity, passwordField, fileDrop } from "./dom";

const token = location.hash.slice(1);
const inline = window.top !== window;
const app = document.getElementById("app")!;

const ERRORS: Record<string, string> = {
  BAD_PASSWORD: "Неверный пароль",
  BUSY: "Подождите, идёт проверка пароля",
  NEED_PASSWORD: "Введите пароль ключа",
  PIN_LOCKED: "Слишком много попыток. Повторите через {s} с",
  MALFORMED_P12: "Файл не похож на ключ .p12 или повреждён",
  UNSUPPORTED_ALGORITHM: "Этот тип ключа не поддерживается (ГОСТ 2004)",
  NOT_FOUND: "Запрос устарел — повторите действие на сайте",
  BAD_REQUEST: "Выберите файл ключа",
  INTERNAL: "Внутренняя ошибка",
};
const errorText = (r: AnswerResult) => (r.ok ? "" : (ERRORS[r.code] ?? r.code).replace("{s}", String(r.retryAfterSec ?? "")));

const size = (n: number) => (n < 1024 ? `${n} Б` : n < 1048576 ? `${(n / 1024).toFixed(1)} КБ` : `${(n / 1048576).toFixed(1)} МБ`);

const send = (msg: Record<string, unknown>) => chrome.runtime.sendMessage({ ...msg, token }) as Promise<AnswerResult>;

async function answer(a: { cancel: true } | { keyId: string; password?: string; trustSite?: boolean }): Promise<AnswerResult> {
  const r = await send({ type: "confirm.answer", answer: a });
  if (r.ok) window.close();
  return r;
}

async function fileToB64(f: File): Promise<string> {
  const b = new Uint8Array(await f.arrayBuffer());
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

function header(req: ConfirmRequest) {
  const sign = req.operation === "sign";
  return el("div", { className: "head" },
    el("div", { className: "icon-box" }, icon("lock")),
    el("h1", { className: "title", textContent: sign ? "Запрос подписи" : "Запрос данных сертификата" }),
    el("p", { className: "subtitle", textContent: sign ? "Проверьте сайт и документ" : "Сайт хочет узнать, каким ключом вы подпишете" }));
}

function siteBox(req: ConfirmRequest, trust: HTMLInputElement) {
  const h = splitHost(req.origin);
  const kind = req.operation === "keyInfo" ? "Данные сертификата" : req.format === "xml" ? "XML-подпись" : req.isHash ? "Подпись хэша (CMS)" : "CMS-подпись";
  const box = el("div", { className: "box site" },
    el("div", { className: "row" },
      el("div", { className: "tile" }, icon("globe")),
      el("div", {},
        el("div", { className: "host origin" }, h.prefix && el("span", { className: "dim", textContent: h.prefix }), h.site, h.port && el("span", { className: "dim", textContent: `:${h.port}` })),
        el("div", { className: "muted small", textContent: kind }))));
  if (h.scheme === "http" && h.site !== "localhost") box.append(el("div", { className: "note warn", textContent: "Соединение не защищено (http). Подписывайте, только если уверены в сайте." }));
  if (req.firstVisit) {
    box.append(
      el("div", { className: "small", textContent: "Этот сайт вы видите впервые — проверьте адрес." }),
      el("label", { className: "check" }, trust, "Запомнить сайт"));
  }
  return box;
}

function documentsBox(req: ConfirmRequest) {
  const list = el("ul", { className: "items" });
  req.items.forEach((it, i) => {
    const li = el("li", {},
      el("div", { className: "doc-head" },
        el("strong", { textContent: req.items.length > 1 ? `Документ ${i + 1}` : req.isHash ? "Хэш документа" : "Документ" }),
        el("span", { className: "muted", textContent: size(it.size) })));
    if (it.preview) {
      li.append(el("pre", { className: "preview", textContent: it.preview.text }));
      if (it.preview.truncated) li.append(el("div", { className: "note warn", style: "margin-top:8px", textContent: `Показано ${it.preview.text.length} из ${it.preview.total} символов. Подписывается весь документ.` }));
    } else {
      li.append(el("p", { className: "muted small", style: "margin:6px 0 0", textContent: req.isHash ? "Сайт передал готовый хэш — содержимое документа недоступно." : "Двоичные данные или текст с невидимыми символами — превью недоступно." }));
    }
    li.append(el("details", { className: "hash" }, el("summary", { textContent: "Контрольная сумма SHA-256" }), el("code", { textContent: it.sha256 })));
    list.append(li);
  });
  return el("div", { className: "box" }, list);
}

// Защита кнопки: пауза после фокуса/появления, видимость окна на странице, стирание пароля при краже фокуса
function protect(form: HTMLFormElement, submit: HTMLButtonElement) {
  // видимость своя у каждой формы: при переключении экранов старая форма не должна влиять на новую
  let visible = !inline;
  const gate = armAfterFocus(submit, window, 1000, () => visible && form.isConnected);
  if (inline) {
    let steals = 0;
    window.addEventListener("blur", () => {
      const pw = form.querySelector<HTMLInputElement>("input[name=password]");
      if (!pw?.value) return;
      pw.value = "";
      const status = form.querySelector(".error");
      if (status) status.textContent = "Окно потеряло фокус — введите пароль заново.";
      if (++steals >= 2) void send({ type: "confirm.fallback" });
    });
    watchVisibility(
      form,
      (v) => {
        if (v === visible) return;
        visible = v;
        if (v) gate.rearm();
        else gate.disarm();
      },
      () => void send({ type: "confirm.fallback" }),
    );
  }
  return { ...gate, visible: () => visible };
}

const brandline = () => el("div", { className: "brandline", textContent: "KZSign · ключ не покидает этот браузер" });

function keyChooser(req: ConfirmRequest, keys: KeyMeta[], open: string[], trust: HTMLInputElement, onAdd: () => void) {
  const pick = el("div", { className: "keys", role: "radiogroup" });
  keys.forEach((k, i) => {
    const v = validity(k.notAfter);
    pick.append(el("label", { className: `keyopt${v.tone === "err" ? " expired" : ""}` },
      el("input", { type: "radio", name: "key", value: k.id, checked: i === 0 }),
      el("span", {},
        el("b", { textContent: k.alias }),
        el("span", { className: "meta" },
          [k.iin && `ИИН ${k.iin}`, k.bin && `БИН ${k.bin}`].filter(Boolean).join(" · "),
          el("span", { className: `badge ${v.tone}`, textContent: v.label }),
          open.includes(k.id) && el("span", { className: "badge ok", textContent: "открыт" })))));
  });

  const pw = passwordField({ name: "password", placeholder: "Введите пароль", "aria-label": "Пароль ключа" });
  const openNote = el("div", { className: "note ok", textContent: "Ключ открыт до закрытия браузера — пароль не нужен." });
  const pwBlock = el("div", {}, el("span", { className: "label", textContent: "Пароль" }), pw.root,
    el("p", { className: "faint small", style: "margin:4px 0 0", textContent: "После первой подписи пароль не понадобится до закрытия браузера." }));
  const status = el("p", { className: "error", role: "alert" });
  const submit = el("button", { type: "submit", className: "btn block", textContent: req.operation === "sign" ? "Подписать" : "Разрешить" });
  const cancel = el("button", { type: "button", className: "btn text block", textContent: "Отмена", onclick: () => answer({ cancel: true }) });
  const add = el("button", { type: "button", className: "link small", textContent: "+ Другой ключ", onclick: onAdd });

  const form = el("form", { className: "confirm" },
    el("div", { className: "scroll" }, header(req), siteBox(req, trust), req.operation === "sign" && documentsBox(req)),
    el("div", { className: "actions" },
      el("div", {}, el("div", { className: "row", style: "justify-content:space-between" }, el("span", { className: "label", textContent: "Ключ" }), add), pick),
      openNote, pwBlock, status, submit, cancel, brandline()));

  const selected = () => (form.elements.namedItem("key") as RadioNodeList | HTMLInputElement | null)?.value ?? "";
  const sync = () => {
    const isOpen = open.includes(selected());
    pwBlock.hidden = isOpen;
    openNote.hidden = !isOpen;
  };
  form.addEventListener("change", sync);
  sync();

  const gate = protect(form, submit);
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!gate.visible() || submit.disabled) return;
    const keyId = selected();
    const isOpen = open.includes(keyId);
    if (!isOpen && !pw.input.value) {
      status.textContent = ERRORS.NEED_PASSWORD!;
      return;
    }
    submit.disabled = true;
    status.textContent = "";
    const r = await answer({ keyId, ...(isOpen ? {} : { password: pw.input.value }), trustSite: trust.checked });
    if (r.ok) return;
    if (!r.ok && r.code === "NEED_PASSWORD") {
      open.splice(open.indexOf(keyId), 1);
      sync();
    }
    pw.input.value = "";
    gate.rearm();
    status.textContent = errorText(r);
  };
  return form;
}

function importForm(req: ConfirmRequest, trust: HTMLInputElement, onBack: (() => void) | null) {
  const drop = fileDrop("Перетащите .p12", ".p12,.pfx");
  const pw = passwordField({ name: "password", placeholder: "Введите пароль", "aria-label": "Пароль ключа" });
  const status = el("p", { className: "error", role: "alert" });
  const label = req.operation === "sign" ? "Загрузить и подписать" : "Загрузить и разрешить";
  const submit = el("button", { type: "submit", className: "btn block", textContent: label });
  const cancel = el("button", { type: "button", className: "btn text block", textContent: onBack ? "Назад к ключам" : "Отмена", onclick: () => (onBack ? onBack() : answer({ cancel: true })) });

  const form = el("form", { className: "confirm" },
    el("div", { className: "scroll" }, header(req), siteBox(req, trust), req.operation === "sign" && documentsBox(req)),
    el("div", { className: "actions" },
      el("div", { className: "row" },
        el("div", { className: "tile" }, icon("key")),
        el("div", {},
          el("div", { style: "font-weight:600", textContent: onBack ? "Новый ключ" : "Нет ключей" }),
          el("div", { className: "muted small", textContent: "Загрузите .p12 — он сохранится в KZSign в зашифрованном виде" }))),
      drop.root,
      el("div", {}, el("span", { className: "label", textContent: "Пароль" }), pw.root),
      status, submit, cancel, brandline()));

  const gate = protect(form, submit);
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!gate.visible() || submit.disabled) return;
    const f = drop.input.files?.[0];
    if (!f) {
      status.textContent = ERRORS.BAD_REQUEST!;
      return;
    }
    submit.disabled = true;
    submit.textContent = "Проверяю ключ…";
    status.textContent = "";
    const r = await send({ type: "confirm.import", file: await fileToB64(f), password: pw.input.value, trustSite: trust.checked });
    if (r.ok) {
      window.close();
      return;
    }
    submit.textContent = label;
    pw.input.value = "";
    gate.rearm();
    status.textContent = errorText(r);
  };
  return form;
}

async function main() {
  const res = (await send({ type: "confirm.get" })) as unknown as { req?: ConfirmRequest; keys?: KeyMeta[]; open?: string[] };
  if (!res?.req) {
    app.replaceChildren(el("div", { className: "confirm" }, el("div", { className: "scroll" }, el("div", { className: "note err", textContent: "Запрос не найден или устарел. Повторите действие на сайте." }))));
    return;
  }
  const { req, keys = [], open = [] } = res;
  const trust = el("input", { type: "checkbox", name: "trust" });
  const showKeys = () => app.replaceChildren(keyChooser(req, keys, open, trust, showImport));
  const showImport = () => app.replaceChildren(importForm(req, trust, keys.length ? showKeys : null));
  if (keys.length) showKeys();
  else showImport();
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") void answer({ cancel: true });
});

// MV3 усыпляет service worker через 30 с без событий — держим его, пока окно открыто
setInterval(() => void send({ type: "confirm.ping" }).catch(() => {}), 20_000);

void main();
