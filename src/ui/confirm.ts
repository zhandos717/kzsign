import type { ConfirmRequest, AnswerResult } from "../sw/confirm-manager";
import type { KeyMeta } from "../sw/keystore";
import { splitHost } from "./site";

const token = location.hash.slice(1);
const app = document.getElementById("app")!;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

const ERRORS: Record<string, string> = {
  BAD_PASSWORD: "Неверный пароль",
  PIN_LOCKED: "Слишком много попыток. Повторите через {s} с",
  MALFORMED_P12: "Ключ повреждён — импортируйте его заново",
  NOT_FOUND: "Запрос устарел",
  INTERNAL: "Внутренняя ошибка",
};

const size = (n: number) => (n < 1024 ? `${n} Б` : n < 1048576 ? `${(n / 1024).toFixed(1)} КБ` : `${(n / 1048576).toFixed(1)} МБ`);

async function main() {
  const res = (await chrome.runtime.sendMessage({ type: "confirm.get", token })) as { req?: ConfirmRequest; keys?: KeyMeta[] };
  if (!res?.req) {
    app.append(el("p", { className: "error", textContent: "Запрос не найден или устарел." }));
    return;
  }
  const { req, keys = [] } = res;
  const h = splitHost(req.origin);

  const origin = el("div", { className: "origin" }, el("span", { className: "dim", textContent: `${h.scheme}://${h.prefix}` }), el("strong", { textContent: h.site }), h.port ? el("span", { className: "dim", textContent: `:${h.port}` }) : "");
  app.append(el("h1", { textContent: req.operation === "sign" ? "Сайт просит подписать" : "Сайт просит данные сертификата" }), origin);
  if (h.scheme === "http" && h.site !== "localhost") app.append(el("p", { className: "warn", textContent: "Соединение не защищено (http). Подписывайте, только если уверены в сайте." }));

  if (req.operation === "sign") {
    const list = el("ol", { className: "items" });
    for (const it of req.items) {
      const li = el("li", {}, el("div", { textContent: `${req.isHash ? "Хэш" : "Данные"}: ${size(it.size)}` }), el("code", { className: "hash", textContent: `SHA-256 ${it.sha256}` }));
      if (it.preview !== undefined) li.append(el("pre", { className: "preview", textContent: it.preview }));
      list.append(li);
    }
    app.append(list);
  }

  if (!keys.length) {
    app.append(el("p", { className: "warn", textContent: "Нет ключей. Добавьте ключ .p12 в меню расширения KZSign и повторите." }));
    app.append(el("button", { type: "button", textContent: "Закрыть", onclick: () => answer({ cancel: true }) }));
    return;
  }

  const form = el("form");
  const fieldset = el("fieldset", {}, el("legend", { textContent: "Ключ" }));
  keys.forEach((k, i) => {
    const id = `k${i}`;
    const expired = new Date(k.notAfter) < new Date();
    fieldset.append(
      el("label", { htmlFor: id, className: expired ? "expired" : "" },
        el("input", { type: "radio", name: "key", id, value: k.id, checked: i === 0 }),
        ` ${k.alias} — ${k.iin ? "ИИН " + k.iin : ""}${k.bin ? " БИН " + k.bin : ""} · до ${k.notAfter.slice(0, 10)}${expired ? " (истёк)" : ""}`),
    );
  });
  const password = el("input", { type: "password", name: "password", autocomplete: "off", required: true, autofocus: true });
  const status = el("p", { className: "error", role: "alert" });
  const submit = el("button", { type: "submit", textContent: req.operation === "sign" ? "Подписать" : "Разрешить" });
  const cancel = el("button", { type: "button", className: "secondary", textContent: "Отмена", onclick: () => answer({ cancel: true }) });
  form.append(fieldset, el("label", {}, "Пароль ключа ", password), status, el("div", { className: "actions" }, cancel, submit));
  form.onsubmit = async (e) => {
    e.preventDefault();
    submit.disabled = true;
    status.textContent = "";
    const keyId = (form.elements.namedItem("key") as RadioNodeList).value;
    const r = await answer({ keyId, password: password.value });
    if (r.ok) return;
    password.value = "";
    submit.disabled = false;
    status.textContent = (ERRORS[r.code] ?? r.code).replace("{s}", String(r.retryAfterSec ?? ""));
  };
  app.append(form);
}

async function answer(a: { cancel: true } | { keyId: string; password: string }): Promise<AnswerResult> {
  const r = (await chrome.runtime.sendMessage({ type: "confirm.answer", token, answer: a })) as AnswerResult;
  if (r.ok) window.close();
  return r;
}

// MV3 усыпляет service worker через 30 с без событий — держим его, пока окно открыто
setInterval(() => void chrome.runtime.sendMessage({ type: "confirm.ping", token }).catch(() => {}), 20_000);

void main();
