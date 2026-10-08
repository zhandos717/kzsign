# KZSign — план 2: расширение

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chrome-расширение MV3, которое подменяет NCALayer (`ws://127.0.0.1:13579`). Подпись ключом из расширения идёт только после подтверждения в окне расширения. Если настоящий NCALayer работает и так решила политика, запрос уходит ему.

**Architecture:** Чистая логика (протокол, политика, keystore, обработчик, TSP) лежит в `src/sw/*` и тестируется в Node с фейками `chrome.*`. Тонкие адаптеры к Chrome API — `src/sw/chrome-*.ts`, точки входа — `src/entries/*`. Криптоядро из плана 1 (`src/core`) не меняется.

**Tech Stack:** TypeScript, esbuild (бандлы), vitest + happy-dom (shim), Playwright + Chromium (e2e с загруженным расширением).

**Spec:** `docs/superpowers/specs/2026-10-08-kzsign-design.md`. Решения: `docs/decisions/0001`, `0002`.

## Global Constraints

- Права в манифесте: `storage`, `alarms`; `host_permissions` — только `http://tsp.pki.gov.kz/*`; content scripts — `<all_urls>`, `all_frames: true`, `run_at: document_start`. Нет `scripting`, `externally_connectable`, аналитики.
- CSP: `script-src 'self'; object-src 'self'`.
- Origin запроса берётся только из `port.sender` (в SW), не из данных страницы.
- Любая операция с ключом, включая `getKeyInfo`, проходит через окно `confirm.html` (`chrome.windows.create`, `type: "popup"`); таймаут 120 с.
- PBKDF2-SHA256, 600 000 итераций, соль 16 байт, AES-256-GCM, IV 12 байт.
- Лимит PIN: после 5 неудач — задержка `2^(n-5)` с, максимум 900 с; счётчик по отпечатку ключа.
- `ParsedP12` живёт одну операцию; после подписи — `wipe()`. В памяти SW ключи не держим. Кэш PIN из спецификации (§5) в v1 не делаем (по умолчанию он и так выключен).
- Ошибки страница получает в формате NCALayer. Пароли и ключи в ответах и логах не появляются.
- Коммиты без `Co-Authored-By`. Ветка: `zhanzh/kzsign-extension`.

## Протокол NCALayer (что эмулируем)

- После `open` сервер шлёт `{"result":{"version":"1.4"}}`.
- Heartbeat: текст `--heartbeat--` → ответ `--heartbeat--`; JSON `{}` → ответ `{}`.
- `kz.gov.pki.knca.commonUtils`: `{module, method, args: []}` → `{code:"200", responseObject}` | `{code:"500", message}`.
  - `getActiveTokens()` → `[]`
  - `getKeyInfo(["PKCS12"])` → `{alias, keyId, algorithm, subjectCn, subjectDn, issuerCn, issuerDn, serialNumber, certNotBefore, certNotAfter, pem}`
  - `createCAdESFromBase64([storage, keyType, base64, attached:boolean])` → base64 CMS
  - `createCMSSignatureFromBase64` — то же
  - `createCAdESFromBase64Hash([storage, keyType, base64Hash])` → detached CMS над байтами хэша
  - `signXml`, `signXmls`, `createCAdESFromFile` → `{code:"500", message:"method.not.supported"}`
- `kz.gov.pki.knca.basics`, метод `sign`: `args = {format, data, signingParams:{encapsulate, digested, tsaProfile}, signerParams}` → `{status:true, body:{result}}` | `{status:false, code, message, details:"", body:{}}`. `format:"cms"` поддерживается, а `xml`/`raw` → `code:"UNSUPPORTED_FORMAT"`. `data` — строка или массив base64; `result` — PEM `-----BEGIN CMS-----` (строка или массив, как пришло).
- Без `module` (старый applet) → `{errorCode:"java.lang.NoSuchMethodException.<method>"}`.
- Отказ пользователя: commonUtils → `{code:"500", message:"action.canceled"}`, basics → `{status:false, code:"CANCELED", ...}`.

## Review Focus

- Две вкладки одновременно запрашивают подпись → окна открываются по очереди. Ответ каждой вкладке приходит в её собственный сокет. Тест в Task 6.
- Пользователь закрыл окно подтверждения крестиком → сайт получает `action.canceled`, а не висит. Тест в Task 6.
- Service worker уснул между запросами → shim переподключает порт и следующий запрос проходит. Тест в Task 3.
- Сайт отправил не-JSON или JSON без `method` → ответ ошибкой протокола, SW не падает. Тест в Task 2.
- Подпись из `<iframe>` другого домена → в окне показывается origin фрейма, а не страницы. Тест в Task 4.

---

### Task 1: Сборка и манифест

**Files:**
- Create: `manifest.json`, `esbuild.config.mjs`, `src/entries/{shim,bridge,sw,confirm,popup}.ts`, `static/{confirm,popup}.html`, `static/ui.css`, `test/helpers/chrome-fake.ts`
- Modify: `package.json` (скрипты `build`, `test:e2e`), `vitest.config.ts` (environment по файлу)
- Test: `test/unit/build.test.ts`

**Interfaces:**
- Produces: `npm run build` → `dist/` (готовая к загрузке папка расширения). `fakeChrome()` — фейк `chrome.storage.local`, `chrome.runtime`, `chrome.windows`, `chrome.alarms`, ставится в `globalThis.chrome`.

- [ ] **Step 1:** `npm i -D esbuild@0.24 happy-dom@15`.
- [ ] **Step 2: Тест** — после `npm run build` в `dist/` есть `manifest.json`, `shim.js`, `bridge.js`, `sw.js`, `confirm.html`, `popup.html`. В манифесте нет `scripting` и `externally_connectable`, `host_permissions` равно `["http://tsp.pki.gov.kz/*"]`. Тест запускает сборку через `execSync`.
- [ ] **Step 3:** Запустить тест, убедиться что FAIL.
- [ ] **Step 4:** Манифест:

```json
{
  "manifest_version": 3,
  "name": "KZSign",
  "version": "0.1.0",
  "description": "Подпись ЭЦП НУЦ РК в браузере без NCALayer",
  "permissions": ["storage", "alarms"],
  "host_permissions": ["http://tsp.pki.gov.kz/*"],
  "background": { "service_worker": "sw.js", "type": "module" },
  "content_scripts": [
    { "matches": ["<all_urls>"], "js": ["shim.js"], "run_at": "document_start", "all_frames": true, "world": "MAIN", "match_about_blank": true },
    { "matches": ["<all_urls>"], "js": ["bridge.js"], "run_at": "document_start", "all_frames": true, "match_about_blank": true }
  ],
  "action": { "default_popup": "popup.html", "default_title": "KZSign" },
  "content_security_policy": { "extension_pages": "script-src 'self'; object-src 'self'" }
}
```

`esbuild.config.mjs` собирает 5 точек входа (`format: "iife"` для shim/bridge/confirm/popup, `esm` для sw, `platform: "browser"`, `target: "chrome120"`) и копирует `manifest.json` и `static/*` в `dist/`. Точки входа на этом шаге — пустые заглушки, их наполняют следующие задачи.

- [ ] **Step 5:** Тест PASS. Коммит `build: сборка расширения и манифест`.

---

### Task 2: Протокол NCALayer

**Files:** Create `src/sw/proto.ts`. Test `test/unit/proto.test.ts`.

**Interfaces:**

```ts
export type SignRequest = { kind: "sign"; data: Uint8Array[]; detached: boolean; isHash: boolean; batch: boolean };
export type Parsed =
  | { kind: "heartbeat"; reply: string }
  | { kind: "tokens" }
  | { kind: "keyInfo" }
  | SignRequest
  | { kind: "unsupported"; reason: string }
  | { kind: "legacy"; method: string }
  | { kind: "invalid"; reason: string };
export type Dialect = "common" | "basics" | "legacy";
export interface Request { dialect: Dialect; parsed: Parsed; format: "cms" | "base64" }
export function parseFrame(text: string): Request;
export function ok(req: Request, value: unknown): string;          // готовый текст ответа
export function fail(req: Request, code: string, message: string): string;
export const HELLO = '{"result":{"version":"1.4"}}';
```

- [ ] **Step 1: Тесты** (по одному `it` на строку):
  - `--heartbeat--` → heartbeat с ответом `--heartbeat--`; `{}` → heartbeat с ответом `{}`.
  - `getActiveTokens` → tokens; `ok` даёт `{"code":"200","responseObject":[]}`.
  - `createCAdESFromBase64` с `["PKCS12","SIGNATURE","aGk=",true]` → sign, detached=false, data=[bytes "hi"].
  - То же с `false` → detached=true.
  - `createCAdESFromBase64Hash` → sign, isHash=true, detached=true.
  - basics `sign` с `data:["aGk=","aGk="]`, `signingParams:{encapsulate:"false"}` → sign, batch=true, detached=true; `ok` даёт `{"status":true,"body":{"result":["-----BEGIN CMS-----..."]}}` (PEM).
  - basics `format:"xml"` → unsupported; `fail` даёт `status:false`, `code:"UNSUPPORTED_FORMAT"`.
  - `signXml` → unsupported, `{"code":"500","message":"method.not.supported"}`.
  - Без `module` → legacy, `{"errorCode":"java.lang.NoSuchMethodException.foo"}`.
  - `не json`, `{"module":"x"}`, base64 с мусором → invalid, ответ `code:"500"` и SW не бросает исключение.
  - Неизвестный модуль → `{"status":false,"code":"MODULE_NOT_FOUND",...}`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Реализация: чистые функции, `JSON.parse` в try, base64 через `atob` с проверкой `/^[A-Za-z0-9+/]*={0,2}$/`. PEM — переносы по 64 символа.
- [ ] **Step 4:** PASS. Коммит `feat(sw): протокол NCALayer`.

---

### Task 3: Shim в странице

**Files:** Create `src/page/ws-shim.ts` (импортируется из `src/entries/shim.ts`). Test `test/unit/ws-shim.test.ts` (`// @vitest-environment happy-dom`).

**Interfaces:**
- Consumes: канал к bridge — `window.postMessage({__kzsign:"hello"}, location.origin, [port2])` один раз при установке.
- Produces: `installShim(win: Window, connect: () => MessagePort): void`. Порт-протокол: `{id, kind:"open"}`, `{id, kind:"send", text}`, `{id, kind:"close"}` → bridge; обратно `{id, kind:"message", text}` и `{id, kind:"closed", code}`.

- [ ] **Step 1: Тесты:**
  - `new WebSocket("wss://127.0.0.1:13579/")` → `FakeWebSocket`: `readyState` 1 после `open`, `onopen` и `addEventListener("open")` срабатывают, первое сообщение — `HELLO`.
  - `ws.send(x)` уходит в порт как `{kind:"send"}`; ответ `{kind:"message"}` вызывает `onmessage` с `event.data === text`.
  - `new WebSocket("wss://example.com")` → нативный конструктор (проверяем через подменённый оригинал).
  - `localhost:13579` и `ws://` тоже перехватываются; `127.0.0.1:1234` — нет.
  - `{kind:"closed", code:1006}` → `readyState` 3, `onclose` с `code` 1006.
  - Порт умер (SW уснул): после `closed` новый `new WebSocket(...)` вызывает `connect()` заново и работает.
  - `WebSocket.OPEN === 1`, `ws instanceof WebSocket === true` (сайты это проверяют).
- [ ] **Step 2:** FAIL. **Step 3:** Реализация: класс расширяет `EventTarget`, проксирует `onopen/onmessage/onclose/onerror`; статические константы; `Symbol.hasInstance` для `instanceof`. Повторная установка защищена флагом `Symbol.for("kzsign.shim")`.
- [ ] **Step 4:** PASS. Коммит `feat(page): подмена WebSocket NCALayer`.

---

### Task 4: Bridge и router

**Files:** Create `src/content/bridge.ts`, `src/sw/router.ts`. Test `test/unit/router.test.ts`.

**Interfaces:**
- Bridge: слушает `message` с `event.source === window && data.__kzsign === "hello"`, берёт `event.ports[0]` **только один раз**. Каждому `id` сокета открывает `chrome.runtime.connect({name:"kzsign"})`, кадры пересылает как есть; при `onDisconnect` шлёт в порт `{id, kind:"closed", code:1006}`.
- Router (SW):

```ts
export interface Session { origin: string; tabId: number; frameId: number; send(text: string): void }
export type FrameHandler = (text: string, s: Session) => Promise<string | null>;
export function originOf(sender: chrome.runtime.MessageSender): string | null; // sender.origin ?? new URL(sender.url).origin; null для не-http(s)
export function attachRouter(onConnect: chrome.runtime.ExtensionConnectEvent, handle: FrameHandler): void;
```

- [ ] **Step 1: Тесты router** (с фейковым портом):
  - `originOf({origin:"https://a.kz"})` → `"https://a.kz"`; `{url:"https://b.kz/x"}` → `"https://b.kz"`; `chrome-extension://…`, `file://`, `undefined` → null.
  - Кадр из фрейма `https://evil.kz` внутри вкладки `https://good.kz` → `handle` получает `origin === "https://evil.kz"` (`sender.origin` фрейма).
  - Поле `origin` внутри кадра страницы игнорируется.
  - `handle` вернул строку → она ушла в `port.postMessage`; `null` → ничего.
  - Порт с `origin === null` закрывается без вызова `handle`.
- [ ] **Step 2:** FAIL. **Step 3:** Реализация. **Step 4:** PASS. Коммит `feat: bridge и router с origin из sender`.

---

### Task 5: Keystore

**Files:** Create `src/sw/keystore.ts`, `src/sw/pin-limit.ts`. Test `test/unit/keystore.test.ts`.

**Interfaces:**

```ts
export interface KeyMeta { id: string; alias: string; algorithm: KeyAlgorithm; subjectCn: string; iin?: string; bin?: string; notAfter: string; fingerprint: string }
export interface Storage { get(k: string): Promise<unknown>; set(k: string, v: unknown): Promise<void>; remove(k: string): Promise<void> }
export function createKeystore(storage: Storage, now?: () => number): {
  importP12(file: Uint8Array, password: string, alias?: string): Promise<KeyMeta>; // проверяет пароль через parseP12
  list(): Promise<KeyMeta[]>;
  remove(id: string): Promise<void>;
  unlock(id: string, password: string): Promise<ParsedP12>;  // KzSignError BAD_PASSWORD | PIN_LOCKED (с retryAfterSec)
};
```

Решение (Ruling): в спецификации отдельный «PIN» — это пароль `.p12`. Пользователь вводит один секрет, а слой AES-GCM шифруется ключом от этого же пароля. Два разных секрета в v1 не вводим.

- [ ] **Step 1: Тесты** (in-memory Storage; PBKDF2 с итерациями из параметра `createKeystore(…, {iterations: 1000})` только в тестах):
  - import ГОСТ и RSA → `list()` возвращает метаданные: `subjectCn`, `iin` (из serialNumber `IIN…`), `notAfter`, `algorithm`; пароль и ключ в storage в открытом виде отсутствуют (поиск подстроки `Qwerty12` и байтов PKCS#8 в `JSON.stringify` хранилища).
  - import с неверным паролем → `BAD_PASSWORD`, хранилище пустое.
  - import ГОСТ 2004 → `UNSUPPORTED_ALGORITHM`.
  - Повторный import того же ключа → тот же `id` (по отпечатку SHA-256 сертификата), без дубля.
  - `unlock` верным паролем → `ParsedP12`, подпись `signCms` проходит `verifyCms`.
  - 5 неверных `unlock` → 6-й (даже с верным паролем) → `PIN_LOCKED`, `retryAfterSec === 1`; после сдвига `now` на 1 с — верный пароль проходит и счётчик сбрасывается.
  - Задержка растёт `1,2,4…` и не больше 900.
  - Подмена шифротекста в storage → `unlock` даёт `MALFORMED_P12`, а не исключение.
  - `remove` удаляет ключ и счётчик.
- [ ] **Step 2:** FAIL. **Step 3:** Реализация: WebCrypto PBKDF2 → AES-GCM; запись `kzsign.key.<id> = {meta, salt, iv, ct}` (base64); счётчик `kzsign.pin.<id> = {fails, until}`. Добавить коды `PIN_LOCKED`, `CANCELED`, `NOT_FOUND` в `ErrorCode`, а у `KzSignError` — необязательное поле `retryAfterSec`.
- [ ] **Step 4:** PASS. Коммит `feat(sw): хранилище ключей с шифрованием и лимитом PIN`.

---

### Task 6: Подтверждение

**Files:** Create `src/sw/confirm-manager.ts`, `src/ui/confirm.ts`, `static/confirm.html`. Test `test/unit/confirm-manager.test.ts`.

**Interfaces:**

```ts
export interface ConfirmRequest { origin: string; operation: "keyInfo" | "sign"; items: { size: number; sha256: string; preview?: string }[]; isHash: boolean }
export type ConfirmResult = { ok: true; keyId: string; password: string } | { ok: false };
export interface WindowsApi { open(url: string): Promise<number>; close(id: number): Promise<void>; onRemoved(cb: (id: number) => void): void }
export function createConfirmManager(win: WindowsApi, timeoutMs?: number): {
  ask(req: ConfirmRequest): Promise<ConfirmResult>;               // очередь: одно окно за раз
  pending(token: string): ConfirmRequest | undefined;              // окно читает свой запрос
  resolve(token: string, r: ConfirmResult): void;                  // окно отвечает
};
```

Окно открывается как `confirm.html#<token>`, где `token` — 128 случайных бит. Окно общается с SW через `chrome.runtime.sendMessage({type:"confirm.get"|"confirm.answer", token, …})`. SW принимает такие сообщения только при `sender.id === chrome.runtime.id` и `sender.url`, начинающемся с `chrome-extension://<id>/confirm.html`.

- [ ] **Step 1: Тесты:**
  - `ask` открывает окно; `resolve(token, ok)` → промис с `keyId/password`, окно закрыто.
  - Закрытие окна (`onRemoved`) → `{ok:false}`.
  - Таймаут → `{ok:false}` и окно закрыто.
  - Два параллельных `ask` → второе окно открывается только после ответа на первое; каждый получает свой результат.
  - `resolve` с чужим/старым токеном игнорируется.
  - `preview` — не больше 2000 символов и только если данные — валидный UTF-8 без управляющих символов, кроме `\n\t`.
- [ ] **Step 2:** FAIL. **Step 3:** Реализация менеджера. UI (`confirm.ts`): крупно origin — в punycode-раскрытии, eTLD+1 жирным, предупреждение для `http:`; операция; список ключей из `keystore.list()` (radio); для каждого элемента — размер, SHA-256 и превью; поле пароля; кнопки «Подписать» / «Отмена». Сообщение `PIN_LOCKED` показывает обратный отсчёт. Никакого `innerHTML` с данными — только `textContent`.
- [ ] **Step 4:** PASS. Коммит `feat: окно подтверждения подписи`.

---

### Task 7: Политика и проброс в настоящий NCALayer

**Files:** Create `src/sw/policy.ts`, `src/sw/native-proxy.ts`. Test `test/unit/policy.test.ts`.

**Interfaces:**

```ts
export type Mode = "auto" | "extension" | "native";
export function decide(mode: Mode, hasKeys: boolean, nativeAlive: () => Promise<boolean>): Promise<"extension" | "native">;
export function createNativeProxy(open: (url: string) => WebSocketLike, ttlMs?: number): {
  alive(): Promise<boolean>;                                                       // 1.5 с таймаут, кэш 60 с
  connect(onMessage: (t: string) => void, onClose: (code: number) => void): { send(t: string): void; close(): void };
};
```

- [ ] **Step 1: Тесты:** `extension` → extension без проверки native; `native` → native; `auto` + ключи есть → extension; `auto` + ключей нет + native жив → native; `auto` + ключей нет + native мёртв → extension. `alive()`: фейковый сокет открылся → true; не ответил за 1.5 с → false (fake timers); второй вызов в пределах 60 с не открывает сокет. Proxy пересылает кадры в обе стороны и `close` с кодом.
- [ ] **Step 2:** FAIL. **Step 3:** Реализация (`wss://127.0.0.1:13579/`, затем `ws://` если wss не открылся). **Step 4:** PASS. Коммит `feat(sw): политика и проброс в NCALayer`.

Решение принимается **на сессию сокета** при первом кадре, а не на каждый кадр: так сайт не получит ответы от двух разных «NCALayer» в одном соединении.

---

### Task 8: Метка времени (CAdES-T)

**Files:** Create `src/core/tsp.ts`, Modify `src/core/signer.ts` (опция `tsp?: (digest: Uint8Array, gost: boolean) => Promise<Uint8Array>`). Test `test/unit/tsp.test.ts`.

**Interfaces:**

```ts
export function buildTimeStampReq(messageImprint: Uint8Array, gost: boolean, nonce: Uint8Array): Uint8Array; // RFC 3161, certReq=true
export function parseTimeStampResp(der: Uint8Array, expectedNonce: Uint8Array): Uint8Array;               // token (ContentInfo); KzSignError TSP_FAILED
export function httpTsp(fetchFn: typeof fetch, url?: string): (imprint: Uint8Array, gost: boolean) => Promise<Uint8Array>;
```

- [ ] **Step 1: Тесты:** запрос разбирается pkijs `TimeStampReq`, в нём хэш-алгоритм Стрибог для ГОСТ и SHA-256 для RSA, переданный nonce, `certReq=true`. Ответ со `status != granted` → `TSP_FAILED`. Неверный nonce → `TSP_FAILED`. `signCms` с фейковым `tsp` кладёт unsigned-атрибут `1.2.840.113549.1.9.16.2.14`, а `messageImprint` равен хэшу **значения подписи**. Ошибка `tsp` → `signCms` бросает исключение, тихого понижения до BES нет.
- [ ] **Step 2:** FAIL. **Step 3:** Реализация. `httpTsp` шлёт `POST` с `Content-Type: application/timestamp-query`. **Step 4:** PASS.
- [ ] **Step 5 (сеть, вручную):** `npx tsx scripts/sign-file.ts … --tsp` против `http://tsp.pki.gov.kz/`, затем проверить в NCANode (как в 0002) → `adesLevel: "T"`. Записать результат в `docs/decisions/0002`. Если боевой TSA не отвечает на тестовые ключи, отметить это и не блокировать задачу.
- [ ] **Step 6:** Коммит `feat(core): метка времени CAdES-T`.

---

### Task 9: Обработчик — сборка всего вместе

**Files:** Create `src/sw/handler.ts`, `src/entries/sw.ts` (адаптеры `chrome.*`). Test `test/unit/handler.test.ts`.

**Interfaces:**

```ts
export function createHandler(deps: {
  keystore: ReturnType<typeof createKeystore>;
  confirm: ReturnType<typeof createConfirmManager>;
  tsp?: (imprint: Uint8Array, gost: boolean) => Promise<Uint8Array>;
}): FrameHandler;
```

Поток для запроса подписи: `parseFrame` → `confirm.ask` → `keystore.unlock` → `signCms` (для каждого элемента; при `isHash` — detached над байтами хэша; TSP, если `tsaProfile` задан) → `wipe` → `ok`. Если пароль неверный, окно не закрывается: SW отвечает окну `BAD_PASSWORD`, и пользователь пробует снова. Для этого `confirm.ask` получает колбэк `verify(keyId, password)` и закрывает окно только после успешного `unlock`. Это меняет интерфейс Task 6: `ask(req, verify)`.

- [ ] **Step 1: Тесты** (in-memory keystore с тестовым ГОСТ-ключом, фейковый confirm):
  - `createCAdESFromBase64` + подтверждение → `code:"200"`, `responseObject` проверяется `verifyCms` с данными.
  - Отказ → `{"code":"500","message":"action.canceled"}`.
  - basics `sign` с двумя элементами → два PEM, оба валидны.
  - `getKeyInfo` → поля `subjectCn`, `algorithm`, `pem`; без подтверждения не отвечает.
  - `getActiveTokens` и heartbeat → без окна.
  - Хэш-режим: `createCAdESFromBase64Hash` → detached CMS, `verifyCms(cms, hashBytes)` валидна.
  - После подписи `wipe` вызван (шпион на `keystore.unlock` возвращает объект, после ответа его `privateKeyPkcs8` нулевой).
  - Нет ключей в keystore → окно всё равно открывается и предлагает импорт; ответ отказа — `action.canceled`.
- [ ] **Step 2:** FAIL. **Step 3:** Реализация + `entries/sw.ts`: `attachRouter(chrome.runtime.onConnect, …)` с сессией на сокет (политика из Task 7), `chrome.runtime.onMessage` для окна подтверждения и popup с проверкой `sender`. **Step 4:** PASS. Коммит `feat(sw): обработчик запросов NCALayer`.

---

### Task 10: Popup

**Files:** Create `src/ui/popup.ts`, `static/popup.html`. Test `test/unit/popup-actions.test.ts`.

**Interfaces:** сообщения popup → SW: `keys.list`, `keys.import {file: base64, password, alias}`, `keys.remove {id}`, `mode.get`, `mode.set {mode}`, `file.sign {keyId, password, file: base64, detached}` → `{cms: base64}`. Чистая функция `handlePopupMessage(msg, deps)` в `src/sw/popup-actions.ts`.

- [ ] **Step 1: Тесты** `handlePopupMessage`: import → list показывает ключ; неверный пароль → `{error:"BAD_PASSWORD"}`; remove; `mode.set "native"` сохраняется; `file.sign` возвращает CMS, валидный для `verifyCms`; неизвестный `type` → `{error:"UNKNOWN"}`.
- [ ] **Step 2:** FAIL. **Step 3:** Реализация + UI: список ключей (CN, ИИН/БИН, срок, алгоритм, кнопка «Удалить» с подтверждением), импорт (`<input type=file accept=".p12,.pfx">` + пароль), переключатель режима, «Подписать файл» → скачивание `<имя>.cms` через `URL.createObjectURL`. Только `textContent`.
- [ ] **Step 4:** PASS. Коммит `feat(ui): popup — ключи, режим, подпись файла`.

---

### Task 11: E2E в настоящем Chromium

**Files:** Create `test/e2e/sign.spec.ts`, `test/e2e/page.html`, `playwright.config.ts`. Create `docs/manual-checklist.md`.

- [ ] **Step 1:** `npm i -D @playwright/test@1 && npx playwright install chromium` (скачивание ~150 МБ с серверов Microsoft).
- [ ] **Step 2: Тесты** (`launchPersistentContext` с `--load-extension=dist`, локальный HTTP-сервер для `page.html`). Страница открывает `new WebSocket("wss://127.0.0.1:13579")` и шлёт `createCAdESFromBase64`:
  - Через страницу `chrome-extension://<id>/popup.html` импортировать тестовый ГОСТ-ключ.
  - Запрос со страницы → появляется окно `confirm.html`, в нём origin `http://localhost:<port>`. Выбрать ключ, ввести пароль, «Подписать» → страница получает `code:"200"`, CMS проходит `verifyCms`.
  - Отказ → `action.canceled`.
  - Закрыть окно → `action.canceled`.
  - Неверный пароль → окно остаётся, видна ошибка.
- [ ] **Step 3:** `npm run build && npx playwright test` → PASS.
- [ ] **Step 4:** `docs/manual-checklist.md`: загрузка распакованного `dist/`; egov.kz (вход по ЭЦП), goszakup.gov.kz, два внутренних сайта; режим `native` при запущенном NCALayer; проверка подписи из popup в NCANode (0002).
- [ ] **Step 5:** Коммит `test(e2e): подпись через расширение в Chromium`.

---

## Покрытие спецификации

| Спецификация | Задача |
|---|---|
| §2 сборка, бандлы | 1 |
| §3 ws-shim, bridge (MessageChannel), router (origin из sender) | 3, 4 |
| §3 ncalayer-proto, §8 ошибки в формате NCALayer | 2, 9 |
| §3 policy, native-proxy | 7 |
| §5 keystore, PBKDF2 600k, AES-GCM, лимит PIN | 5 |
| §3 confirm-manager, окно, очередь, таймаут 120 с; §7 угрозы (окно, origin, превью, SHA-256) | 6, 9 |
| §6 TSP, без тихого понижения | 8 |
| §3 popup, подпись файла | 10 |
| §1 критерии: сайты, режим native, ни одной подписи без подтверждения | 9, 11 |
| §7 нет `externally_connectable` | 1 |
| §5 кэш PIN | не делаем в v1 (по умолчанию выключен) — Ruling в Global Constraints |
