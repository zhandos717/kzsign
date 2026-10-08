import type { ConfirmRequest, AnswerResult } from "../sw/confirm-manager";
import type { KeyMeta } from "../sw/keystore";
import { splitHost } from "./site";
import { armAfterFocus } from "./arm";
import { watchVisibility } from "./visibility";
import { el, icon, topbar, initials, validity } from "./dom";

const token = location.hash.slice(1);
const inline = window.top !== window;
let visible = !inline;
const app = document.getElementById("app")!;

const ERRORS: Record<string, string> = {
  BAD_PASSWORD: "Неверный пароль",
  BUSY: "Подождите, идёт проверка пароля",
  PIN_LOCKED: "Слишком много попыток. Повторите через {s} с",
  MALFORMED_P12: "Ключ повреждён — добавьте его заново",
  NOT_FOUND: "Запрос устарел",
  INTERNAL: "Внутренняя ошибка",
};

const size = (n: number) => (n < 1024 ? `${n} Б` : n < 1048576 ? `${(n / 1024).toFixed(1)} КБ` : `${(n / 1048576).toFixed(1)} МБ`);

function requesterCard(req: ConfirmRequest) {
  const h = splitHost(req.origin);
  const secure = h.scheme === "https" || h.site === "localhost";
  return el("section", { className: "card" },
    el("h2", { textContent: req.operation === "sign" ? "Запрос подписи от сайта" : "Запрос данных сертификата от сайта" }),
    el("div", { className: "requester" },
      el("div", { className: "avatar", textContent: initials(h.site.split(".")[0] ?? "?") }),
      el("div", {},
        el("div", { className: "origin" }, el("span", { className: "dim", textContent: `${h.scheme}://${h.prefix}` }), el("strong", { textContent: h.site }), h.port && el("span", { className: "dim", textContent: `:${h.port}` })),
        secure ? el("div", { className: "secure" }, icon("lock"), h.scheme === "https" ? "Защищённое соединение" : "Локальная разработка") : null)),
    !secure && el("div", { className: "note warn", style: "margin-top:10px", textContent: "Соединение не защищено (http). Подписывайте, только если уверены в сайте." }),
    el("p", { className: "muted hint", textContent: "Подписывайте, только если сами начали это действие на этом сайте." }));
}

function documentCard(req: ConfirmRequest) {
  const list = el("ul", { className: "items" });
  req.items.forEach((it, i) => {
    const li = el("li", {},
      el("div", { className: "doc-head" },
        el("strong", { textContent: req.items.length > 1 ? `Документ ${i + 1}` : req.isHash ? "Хэш документа" : "Документ" }),
        el("span", { className: "muted small", textContent: size(it.size) })));
    if (it.preview) {
      li.append(el("pre", { className: "preview", textContent: it.preview.text }));
      if (it.preview.truncated) li.append(el("div", { className: "note warn", style: "margin-top:8px", textContent: `Показано ${it.preview.text.length} из ${it.preview.total} символов. Подписывается весь документ.` }));
    } else {
      li.append(el("p", { className: "muted small", style: "margin:6px 0 0", textContent: req.isHash ? "Сайт передал готовый хэш — содержимое документа недоступно." : "Двоичные данные или текст с невидимыми символами — превью недоступно." }));
    }
    li.append(el("details", { className: "hash" }, el("summary", { textContent: "Контрольная сумма SHA-256" }), el("code", { textContent: it.sha256 })));
    list.append(li);
  });
  return el("section", { className: "card" }, el("h2", { textContent: req.items.length > 1 ? `Что подписывается · ${req.items.length}` : "Что подписывается" }), list);
}

async function main() {
  const res = (await chrome.runtime.sendMessage({ type: "confirm.get", token })) as { req?: ConfirmRequest; keys?: KeyMeta[] };
  if (!res?.req) {
    app.replaceChildren(el("div", { className: "page" }, topbar(), el("div", { className: "content" }, el("div", { className: "note err", textContent: "Запрос не найден или устарел. Повторите действие на сайте." }))));
    return;
  }
  const { req, keys = [] } = res;
  const cards: Node[] = [requesterCard(req)];
  if (req.operation === "sign") cards.push(documentCard(req));

  const cancel = el("button", { type: "button", className: "btn ghost", textContent: "Отмена", onclick: () => answer({ cancel: true }) });

  if (!keys.length) {
    cards.push(el("div", { className: "note warn", textContent: "В KZSign нет ключей. Откройте меню расширения, добавьте ключ .p12 и повторите действие на сайте." }));
    app.replaceChildren(el("div", { className: "page confirm" }, topbar("Подтверждение"), el("div", { className: "content" }, ...cards), el("div", { className: "footer" }, cancel)));
    return;
  }

  const pick = el("fieldset", { className: "keypick" });
  keys.forEach((k, i) => {
    const v = validity(k.notAfter);
    pick.append(el("label", { className: `option${v.tone === "err" ? " expired" : ""}` },
      el("input", { type: "radio", name: "key", value: k.id, checked: i === 0 }),
      el("span", {},
        el("b", { textContent: k.alias }),
        el("span", { className: "meta small muted" }, [k.iin && `ИИН ${k.iin}`, k.bin && `БИН ${k.bin}`].filter(Boolean).join(" · ") + " ", el("span", { className: `badge ${v.tone}`, textContent: v.label })))));
  });
  const password = el("input", { className: "input", type: "password", name: "password", autocomplete: "off", required: true, placeholder: "Пароль ключа", "aria-label": "Пароль ключа" });
  const status = el("p", { className: "error", role: "alert" });
  const submit = el("button", { type: "submit", className: "btn", textContent: req.operation === "sign" ? "Подписать" : "Разрешить" });
  const form = el("form", { className: "page confirm" },
    topbar("Подтверждение"),
    el("div", { className: "content" }, ...cards,
      keys.length > 1 && el("section", { className: "card" }, el("h2", { textContent: "Подписать ключом" }), pick)),
    el("div", { className: "footer stack" },
      keys.length === 1 && el("div", { className: "keyline" }, pick),
      el("div", { className: "pw" }, password, submit),
      status,
      el("div", { className: "actions" }, cancel)));
  const gate = armAfterFocus(submit, window, 1000, () => visible);
  if (inline) {
    // страница может забрать фокус посреди ввода пароля, и остаток уйдёт ей: стираем введённое и просим ввести заново
    let steals = 0;
    window.addEventListener("blur", () => {
      if (!password.value) return;
      password.value = "";
      status.textContent = "Окно потеряло фокус — введите пароль заново.";
      if (++steals >= 2) void chrome.runtime.sendMessage({ type: "confirm.fallback", token });
    });
    watchVisibility(
      form,
      (v) => {
        if (v === visible) return;
        visible = v;
        if (v) gate.rearm();
        else gate.disarm();
      },
      () => void chrome.runtime.sendMessage({ type: "confirm.fallback", token }),
    );
  }
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!visible || submit.disabled) return;
    submit.disabled = true;
    status.textContent = "";
    const keyId = (form.elements.namedItem("key") as RadioNodeList).value;
    const r = await answer({ keyId, password: password.value });
    if (r.ok) return;
    password.value = "";
    gate.rearm();
    status.textContent = (ERRORS[r.code] ?? r.code).replace("{s}", String(r.retryAfterSec ?? ""));
  };
  app.replaceChildren(form);
}

async function answer(a: { cancel: true } | { keyId: string; password: string }): Promise<AnswerResult> {
  const r = (await chrome.runtime.sendMessage({ type: "confirm.answer", token, answer: a })) as AnswerResult;
  if (r.ok) window.close();
  return r;
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") void answer({ cancel: true });
});

// MV3 усыпляет service worker через 30 с без событий — держим его, пока окно открыто
setInterval(() => void chrome.runtime.sendMessage({ type: "confirm.ping", token }).catch(() => {}), 20_000);

void main();
