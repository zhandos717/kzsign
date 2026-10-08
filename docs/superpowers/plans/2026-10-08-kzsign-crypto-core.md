# KZSign — план 1: криптоядро

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Библиотека на TypeScript, которая открывает `.p12` НУЦ РК (ГОСТ 34.10-2015 и RSA) и собирает CAdES-BES подпись. Подпись должна проверяться на ezsigner.kz.

**Architecture:** Чистые модули без зависимостей от Chrome API, тестируются в Node через vitest. План 2 (расширение: shim, bridge, протокол NCALayer, keystore, окна) подключит эти модули в service worker. ГОСТ-движок выбирается спайком в Task 2 и прячется за интерфейсом `GostEngine`.

**Tech Stack:** TypeScript 5, vitest, node-forge 1.x (разбор PKCS#12 со старыми PBE), pkijs + asn1js (CMS), WebCrypto (RSA), ГОСТ: `@li0ard/streebog` + `@li0ard/gostcurves` или запасной `gogost` в WASM.

**Spec:** `docs/superpowers/specs/2026-10-08-kzsign-design.md`

## Почему два плана

Спецификация описывает две независимые подсистемы: криптоядро и расширение. Криптоядро проверяется без браузера, а от результата спайка ГОСТ зависят интерфейсы. Поэтому план 2 пишется после завершения этого плана.

## Global Constraints

- Пароль всех тестовых `.p12`: `Qwerty12` (`test/fixtures/nca/NOTICE.md`).
- ГОСТ 34.310-2004 (`1.2.398.3.10.1.1.1.1`) не поддерживается: импорт отклоняется ошибкой `UNSUPPORTED_ALGORITHM`.
- OID из тестового ключа ГОСТ 2015 (получены `openssl asn1parse`): ключ `1.2.398.3.10.1.1.2.2`, параметры кривой `1.2.398.3.10.1.1.2.2.1`, хэш `1.2.398.3.10.1.3.3`, подпись `1.2.398.3.10.1.1.2.3.2`. Открытый ключ — BIT STRING 132 байта (OCTET STRING 64 байта → 256-битная кривая).
- Никакой своей реализации криптопримитивов: только библиотеки, прошедшие проверку в Task 2.
- Закрытый ключ не логируется и не попадает в сообщения об ошибках.
- Коммиты без `Co-Authored-By`. Ветка: `zhanzh/kzsign-crypto-core`.

## Review Focus

- Неверный пароль `.p12` → понятная ошибка `BAD_PASSWORD`, а не исключение forge. Тест в Task 3.
- `.p12` с ГОСТ 2004 → `UNSUPPORTED_ALGORITHM`, а не падение в ГОСТ-движке. Тест в Task 3.
- Пустые данные (0 байт) на подпись → валидная подпись, а не ошибка. Тест в Task 6.
- Отозванный ключ (`revoked/`) подписывает технически успешно: проверка OCSP — задача плана 2, ядро не должно молча отказывать. Тест в Task 6.
- Detached-подпись не содержит самих данных, attached — содержит. Тест в Task 6.

---

### Task 1: Каркас проекта и доступ к фикстурам

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `test/helpers/fixtures.ts`
- Test: `test/unit/fixtures.test.ts`

**Interfaces:**
- Produces: `readFixture(rel: string): Uint8Array` (путь относительно `test/fixtures/nca/`), `FIXTURE_PASSWORD = "Qwerty12"`, константы `GOST2015_INDIVIDUAL`, `GOST2015_INDIVIDUAL_REVOKED`, `RSA_PERSONAL`, `GOST2004_ORG`, `NCA_GOST2022_CA`.

- [ ] **Step 1: Создать ветку и каркас**

```bash
cd ~/Desktop/kzsign
git checkout -b zhanzh/kzsign-crypto-core
npm init -y
npm i -D typescript@5 vitest@2 @types/node@22 @types/node-forge@1
npm i node-forge@1 pkijs@3 asn1js@3
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "lib": ["ES2022", "DOM"],
    "types": ["node"],
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "test", "spike"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/unit/**/*.test.ts"] } });
```

`.gitignore`:

```
node_modules/
dist/
*.wasm
```

В `package.json` добавить `"type": "module"` и скрипты `"test": "vitest run"`, `"typecheck": "tsc"`.

- [ ] **Step 2: Написать падающий тест**

`test/unit/fixtures.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFixture, GOST2015_INDIVIDUAL, RSA_PERSONAL, NCA_GOST2022_CA } from "../helpers/fixtures";

describe("fixtures", () => {
  it("читает тестовые ключи и сертификат УЦ", () => {
    expect(readFixture(GOST2015_INDIVIDUAL).length).toBe(1803);
    expect(readFixture(RSA_PERSONAL).length).toBe(3431);
    expect(readFixture(NCA_GOST2022_CA).length).toBe(1025);
  });
});
```

- [ ] **Step 3: Запустить, убедиться что падает**

Run: `npx vitest run test/unit/fixtures.test.ts`
Expected: FAIL, `Cannot find module '../helpers/fixtures'`

- [ ] **Step 4: Реализовать**

`test/helpers/fixtures.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/nca");

export const FIXTURE_PASSWORD = "Qwerty12";
export const GOST2015_INDIVIDUAL = "ncanode-go-official/individual/valid/individual_valid.p12";
export const GOST2015_INDIVIDUAL_REVOKED = "ncanode-go-official/individual/revoked/individual_revoked.p12";
export const RSA_PERSONAL = "danikarik/personal/active/RSA256_11c707bd54cbfcccb3815e39c4eb57b1dc7dfea9.p12";
export const GOST2004_ORG = "danikarik/organization/active/GOSTKNCA_13a3741b52d7bf860aab199b56fad1f4652e357b.p12";
export const NCA_GOST2022_CA = "ncanode-go-official/nca_gost2022_test.cer";

export function readFixture(rel: string): Uint8Array {
  return new Uint8Array(readFileSync(join(ROOT, rel)));
}
```

- [ ] **Step 5: Проверить и закоммитить**

Run: `npx vitest run && npx tsc`
Expected: PASS, tsc без ошибок.

```bash
git add -A
git commit -m "chore: каркас проекта и доступ к тестовым ключам НУЦ"
```

---

### Task 2: Спайк ГОСТ — выбор движка

Цель: доказать, что выбранная библиотека правильно считает ГОСТ 34.11-2015 и проверяет/создаёт подписи ГОСТ 34.10-2015 на кривой НУЦ `1.2.398.3.10.1.1.2.2.1`.

**Эталон (oracle).** Сертификат `individual_valid` подписан тестовым УЦ `nca_gost2022_test.cer` алгоритмом `1.2.398.3.10.1.1.2.3.2`. Если библиотека с правильной кривой, хэшем и порядком байтов проверяет эту подпись открытым ключом УЦ, все неизвестные параметры найдены на реальных данных НУЦ, а не на догадках.

**Files:**
- Create: `spike/gost-oracle.ts`
- Create: `docs/decisions/0001-gost-engine.md`

**Interfaces:**
- Produces: решение (JS или WASM) и найденные параметры: имя кривой, порядок байтов открытого ключа (LE/BE), порядок `r‖s` или `s‖r` в подписи, размер хэша. Task 4 их использует.

- [ ] **Step 1: Поставить кандидатов и проверить их на векторах из стандарта**

```bash
npm i @li0ard/streebog @li0ard/gostcurves
npm view @li0ard/streebog repository.url license
npm view @li0ard/gostcurves repository.url license
```

Проверить хэш на примере M1 из ГОСТ Р 34.11-2012, приложение А. Сообщение M1 — это ASCII-строка `012345678901234567890123456789012345678901234567890123456789012` (63 байта). Ожидаемый Стрибог-256 (как в RFC 6986 §10.1.2): `9d151eefd8590b89daa6ba6cb74af9275dd051026bb149a452fd84e5e57b5500`.

```bash
node --input-type=module -e '
import { streebog256 } from "@li0ard/streebog";
const m = new TextEncoder().encode("012345678901234567890123456789012345678901234567890123456789012");
console.log(Buffer.from(streebog256(m)).toString("hex"));'
```

Expected: `00557be5e584fd52a449b16b0251d05d27f94ab76cbaa6da890b59d8ef1e159d` или то же в обратном порядке байтов. RFC печатает младший байт справа, поэтому совпадение «наоборот» — тоже успех: зафиксируй, какой порядок отдаёт библиотека. Если экспорт называется иначе, посмотри `node -e 'import("@li0ard/streebog").then(m=>console.log(Object.keys(m)))'`.

- [ ] **Step 2: Написать скрипт-оракул**

`spike/gost-oracle.ts` перебирает кривые из `@li0ard/gostcurves` и варианты кодирования, пока подпись УЦ не сойдётся:

```ts
import forge from "node-forge";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import * as curves from "@li0ard/gostcurves";
import { streebog256 } from "@li0ard/streebog";
import { readFixture, GOST2015_INDIVIDUAL, NCA_GOST2022_CA, FIXTURE_PASSWORD } from "../test/helpers/fixtures";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const rev = (b: Uint8Array) => Uint8Array.from(b).reverse();

function certFromP12(der: Uint8Array): Uint8Array {
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.binary.raw.encode(der)), false, FIXTURE_PASSWORD);
  const bag = p12.getBags({ bagType: forge.pki.oids.certBag! })[forge.pki.oids.certBag!]![0]!;
  // forge не умеет ГОСТ-сертификаты, поэтому берём сырой ASN.1 bag'а: certBag → [0] → OCTET STRING с DER сертификата
  const certDerAsn1 = (bag as any).asn1.value[1].value[0].value[1].value[0];
  return forge.util.binary.raw.decode(certDerAsn1.value);
}

function parseCert(der: Uint8Array) {
  return new pkijs.Certificate({ schema: asn1js.fromBER(der).result });
}

function pubKeyBytes(c: pkijs.Certificate): Uint8Array {
  const bits = new Uint8Array(c.subjectPublicKeyInfo.subjectPublicKey.valueBlock.valueHexView);
  const inner = asn1js.fromBER(bits).result as asn1js.OctetString;
  return new Uint8Array(inner.valueBlock.valueHexView);
}

const leaf = parseCert(certFromP12(readFixture(GOST2015_INDIVIDUAL)));
const ca = parseCert(readFixture(NCA_GOST2022_CA));

const tbs = new Uint8Array(leaf.tbsView);
const sig = new Uint8Array(leaf.signatureValue.valueBlock.valueHexView);
const caPub = pubKeyBytes(ca);
console.log("sigAlg", leaf.signatureAlgorithm.algorithmId, "sig", sig.length, "caPub", caPub.length);

const hashes = { h: streebog256(tbs), hRev: rev(streebog256(tbs)) };
const pubs = { pubLE: caPub, pubBE: rev(caPub) };
const sigs = { rs: sig, sr: Uint8Array.from([...sig.slice(32), ...sig.slice(0, 32)]), rsRev: rev(sig) };

for (const [curveName, curve] of Object.entries(curves).filter(([, v]) => typeof v === "object")) {
  for (const [hn, h] of Object.entries(hashes)) for (const [pn, p] of Object.entries(pubs)) for (const [sn, s] of Object.entries(sigs)) {
    try {
      if ((curves as any).verify(curve, p, h, s)) console.log("MATCH", { curveName, hn, pn, sn });
    } catch { /* несовместимая комбинация */ }
  }
}
```

Сигнатуру `verify` сверь с README `@li0ard/gostcurves` и при необходимости поправь вызов. Список перебираемых вариантов не сокращай.

- [ ] **Step 3: Запустить**

Run: `npx tsx spike/gost-oracle.ts` (если нужно — `npm i -D tsx`)
Expected: ровно одна строка `MATCH {...}`. Если совпадений нет:
1. Сверь параметры кривой `1.2.398.3.10.1.1.2.2.1` с TC26 256-A/B/C/D и CryptoPro A/B/C — возможно, у НУЦ своя кривая. Её параметры ищи в коде `gogost` (`gost3410/params.go`) и в открытом коде NCANode-Go.
2. Если JS-кандидат так и не сходится — переходи на WASM: `gogost` (`go.cypherpunks.su/gogost/v6`), маленькая Go-программа с `verify` и `sign`, сборка `GOOS=js GOARCH=wasm`, тот же оракул.

- [ ] **Step 4: Проверить, что закрытый ключ соответствует сертификату**

Добавь в скрипт: из `shroudedKeyBag` (`bag.asn1` у forge — расшифрованный PKCS#8) достань закрытый скаляр, посчитай открытую точку на найденной кривой и сравни с `pubKeyBytes(leaf)` в найденном порядке байтов. Затем подпиши `streebog256("test")` и проверь подпись этим же открытым ключом.

Expected: `pub match: true`, `self-verify: true`.

- [ ] **Step 5: Зафиксировать решение**

`docs/decisions/0001-gost-engine.md`: выбранный движок с версией и лицензией, найденная кривая, порядок байтов хэша, ключа и подписи, вывод скрипта с `MATCH`, а также как извлекается скаляр из PKCS#8 НУЦ (точный ASN.1-путь).

```bash
git add spike docs/decisions package.json package-lock.json
git commit -m "spike: проверка ГОСТ-движка на подписи тестового УЦ НУЦ"
```

**Стоп-точка:** показать пользователю `0001-gost-engine.md` до перехода к Task 4.

---

### Task 3: Разбор `.p12` НУЦ

**Files:**
- Create: `src/core/errors.ts`, `src/core/p12.ts`
- Test: `test/unit/p12.test.ts`

**Interfaces:**
- Produces:

```ts
export type KeyAlgorithm = "GOST2015_256" | "RSA";
export interface ParsedP12 {
  algorithm: KeyAlgorithm;
  privateKeyPkcs8: Uint8Array;   // DER PKCS#8
  certificateDer: Uint8Array;
  chainDer: Uint8Array[];        // остальные сертификаты из файла, может быть пустым
}
export function parseP12(der: Uint8Array, password: string): ParsedP12;
export class KzSignError extends Error { constructor(public code: ErrorCode, message: string) }
export type ErrorCode = "BAD_PASSWORD" | "UNSUPPORTED_ALGORITHM" | "MALFORMED_P12" | "NO_KEY";
```

- [ ] **Step 1: Написать падающие тесты**

```ts
import { describe, it, expect } from "vitest";
import { parseP12 } from "../../src/core/p12";
import { KzSignError } from "../../src/core/errors";
import { readFixture, FIXTURE_PASSWORD, GOST2015_INDIVIDUAL, RSA_PERSONAL, GOST2004_ORG } from "../helpers/fixtures";

describe("parseP12", () => {
  it("ГОСТ 2015", () => {
    const p = parseP12(readFixture(GOST2015_INDIVIDUAL), FIXTURE_PASSWORD);
    expect(p.algorithm).toBe("GOST2015_256");
    expect(p.certificateDer[0]).toBe(0x30);
    expect(p.privateKeyPkcs8[0]).toBe(0x30);
  });
  it("RSA", () => {
    expect(parseP12(readFixture(RSA_PERSONAL), FIXTURE_PASSWORD).algorithm).toBe("RSA");
  });
  it("неверный пароль → BAD_PASSWORD", () => {
    const e = (() => { try { parseP12(readFixture(RSA_PERSONAL), "wrong"); } catch (x) { return x; } })();
    expect(e).toBeInstanceOf(KzSignError);
    expect((e as KzSignError).code).toBe("BAD_PASSWORD");
  });
  it("ГОСТ 2004 → UNSUPPORTED_ALGORITHM", () => {
    expect(() => parseP12(readFixture(GOST2004_ORG), FIXTURE_PASSWORD)).toThrowError(/UNSUPPORTED_ALGORITHM/);
  });
  it("мусор → MALFORMED_P12", () => {
    expect(() => parseP12(new Uint8Array([1, 2, 3]), "x")).toThrowError(/MALFORMED_P12/);
  });
  it("ошибка не содержит пароль", () => {
    try { parseP12(readFixture(RSA_PERSONAL), "secret-pass"); } catch (e) { expect(String(e)).not.toContain("secret-pass"); }
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npx vitest run test/unit/p12.test.ts` → FAIL (модуля нет).

- [ ] **Step 3: Реализовать**

`src/core/errors.ts`:

```ts
export type ErrorCode = "BAD_PASSWORD" | "UNSUPPORTED_ALGORITHM" | "MALFORMED_P12" | "NO_KEY";
export class KzSignError extends Error {
  constructor(public readonly code: ErrorCode, message: string) {
    super(`${code}: ${message}`);
  }
}
```

`src/core/p12.ts`:

```ts
import forge from "node-forge";
import { KzSignError } from "./errors";

export type KeyAlgorithm = "GOST2015_256" | "RSA";
export interface ParsedP12 {
  algorithm: KeyAlgorithm;
  privateKeyPkcs8: Uint8Array;
  certificateDer: Uint8Array;
  chainDer: Uint8Array[];
}

const OID_RSA = "1.2.840.113549.1.1.1";
const OID_GOST2015 = "1.2.398.3.10.1.1.2.2";
const OID_GOST2004 = "1.2.398.3.10.1.1.1.1";

const toBytes = (bin: string) => forge.util.binary.raw.decode(bin);
const toBin = (b: Uint8Array) => forge.util.binary.raw.encode(b);

function keyAlgorithmOid(pkcs8: forge.asn1.Asn1): string {
  const algSeq = (pkcs8.value as forge.asn1.Asn1[])[1]!;
  const oid = (algSeq.value as forge.asn1.Asn1[])[0]!;
  return forge.asn1.derToOid(oid.value as string);
}

export function parseP12(der: Uint8Array, password: string): ParsedP12 {
  let asn1: forge.asn1.Asn1;
  try {
    asn1 = forge.asn1.fromDer(toBin(der));
  } catch {
    throw new KzSignError("MALFORMED_P12", "файл не является PKCS#12");
  }

  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/password|MAC/i.test(msg)) throw new KzSignError("BAD_PASSWORD", "неверный пароль");
    throw new KzSignError("MALFORMED_P12", "не удалось разобрать PKCS#12");
  }

  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag! })[forge.pki.oids.pkcs8ShroudedKeyBag!] ?? [];
  const keyBag = keyBags[0];
  if (!keyBag) throw new KzSignError("NO_KEY", "в файле нет закрытого ключа");

  // forge сам разбирает только RSA; для ГОСТ остаётся сырой расшифрованный PKCS#8 в bag.asn1
  const pkcs8Asn1: forge.asn1.Asn1 = keyBag.key ? forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(keyBag.key)) : (keyBag as any).asn1;
  const oid = keyAlgorithmOid(pkcs8Asn1);
  if (oid === OID_GOST2004) throw new KzSignError("UNSUPPORTED_ALGORITHM", "ГОСТ 34.310-2004 не поддерживается");
  const algorithm: KeyAlgorithm | null = oid === OID_RSA ? "RSA" : oid === OID_GOST2015 ? "GOST2015_256" : null;
  if (!algorithm) throw new KzSignError("UNSUPPORTED_ALGORITHM", `алгоритм ${oid}`);

  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag! })[forge.pki.oids.certBag!] ?? []).map((b) =>
    b.cert ? toBytes(forge.asn1.toDer(forge.pki.certificateToAsn1(b.cert)).getBytes())
           : toBytes(((b as any).asn1.value[1].value[0].value[1].value[0]).value as string),
  );
  const [certificateDer, ...chainDer] = certs;
  if (!certificateDer) throw new KzSignError("MALFORMED_P12", "в файле нет сертификата");

  return { algorithm, privateKeyPkcs8: toBytes(forge.asn1.toDer(pkcs8Asn1).getBytes()), certificateDer, chainDer };
}
```

Если ASN.1-путь к DER сертификата в certBag отличается от найденного в Task 2, используй путь из `0001-gost-engine.md`.

Сертификат пользователя определяется по `localKeyId`, а не по порядку bag'ов. Если тест в Step 4 покажет, что первым идёт сертификат УЦ, выбирай сертификат, у которого атрибут `localKeyId` совпадает с атрибутом у ключа.

- [ ] **Step 4: Прогнать тесты**

Run: `npx vitest run test/unit/p12.test.ts` → PASS. Если тест на ГОСТ 2004 падает с `MALFORMED_P12`, значит forge не расшифровал ключ этого формата: перехвати этот случай и проверь OID алгоритма в сертификате.

- [ ] **Step 5: Коммит**

```bash
git add src/core test/unit/p12.test.ts
git commit -m "feat(core): разбор .p12 НУЦ (ГОСТ 2015, RSA)"
```

---

### Task 4: ГОСТ-движок

**Files:**
- Create: `src/core/crypto/gost.ts`
- Test: `test/unit/gost.test.ts`

**Interfaces:**
- Consumes: `parseP12` (Task 3); параметры из `docs/decisions/0001-gost-engine.md` (Task 2).
- Produces:

```ts
export interface GostEngine {
  digest(data: Uint8Array): Uint8Array;                       // 32 байта, порядок как в CMS messageDigest
  sign(digest: Uint8Array, pkcs8: Uint8Array): Uint8Array;    // 64 байта, кодировка как в подписи УЦ
  verify(digest: Uint8Array, signature: Uint8Array, publicKeyFromCert: Uint8Array): boolean;
  publicKeyFromCert(certDer: Uint8Array): Uint8Array;
}
export const gost: GostEngine;
export const OID_GOST_DIGEST = "1.2.398.3.10.1.3.3";
export const OID_GOST_SIGNATURE = "1.2.398.3.10.1.1.2.3.2";
```

- [ ] **Step 1: Падающие тесты**

```ts
import { describe, it, expect } from "vitest";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { gost } from "../../src/core/crypto/gost";
import { parseP12 } from "../../src/core/p12";
import { readFixture, FIXTURE_PASSWORD, GOST2015_INDIVIDUAL, NCA_GOST2022_CA } from "../helpers/fixtures";

const p = parseP12(readFixture(GOST2015_INDIVIDUAL), FIXTURE_PASSWORD);

describe("gost", () => {
  it("проверяет подпись тестового УЦ на сертификате (оракул НУЦ)", () => {
    const leaf = new pkijs.Certificate({ schema: asn1js.fromBER(p.certificateDer).result });
    const caPub = gost.publicKeyFromCert(readFixture(NCA_GOST2022_CA));
    const sig = new Uint8Array(leaf.signatureValue.valueBlock.valueHexView);
    expect(gost.verify(gost.digest(new Uint8Array(leaf.tbsView)), sig, caPub)).toBe(true);
  });
  it("подпись своим ключом проверяется открытым ключом сертификата", () => {
    const d = gost.digest(new TextEncoder().encode("hello"));
    const s = gost.sign(d, p.privateKeyPkcs8);
    expect(s.length).toBe(64);
    expect(gost.verify(d, s, gost.publicKeyFromCert(p.certificateDer))).toBe(true);
  });
  it("испорченная подпись не проходит", () => {
    const d = gost.digest(new Uint8Array([1]));
    const s = gost.sign(d, p.privateKeyPkcs8);
    s[0] = s[0]! ^ 0xff;
    expect(gost.verify(d, s, gost.publicKeyFromCert(p.certificateDer))).toBe(false);
  });
  it("подписи недетерминированы (случайный k)", () => {
    const d = gost.digest(new Uint8Array([1]));
    expect(gost.sign(d, p.privateKeyPkcs8)).not.toEqual(gost.sign(d, p.privateKeyPkcs8));
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают** — `npx vitest run test/unit/gost.test.ts` → FAIL.

- [ ] **Step 3: Реализовать на выбранном движке**

Перенеси рабочую комбинацию из `spike/gost-oracle.ts` в `src/core/crypto/gost.ts`:
- `digest` — Стрибог-256 в том порядке байтов, на котором сошёлся оракул.
- `publicKeyFromCert` — `pubKeyBytes` из спайка, в нужном порядке байтов.
- `sign`/`verify` — вызовы библиотеки с найденной кривой и порядком `r‖s`.
- Извлечение закрытого скаляра из PKCS#8 — по ASN.1-пути из `0001-gost-engine.md`. После подписи затирай копию скаляра (`fill(0)`).
- `k` берётся только из `crypto.getRandomValues`. Если библиотека принимает `k` параметром, передавай его явно.

Если в Task 2 выбран WASM: `gost.ts` загружает `gost.wasm` и вызывает экспортированные `gostSign`/`gostVerify`/`streebog256`, интерфейс тот же. Сборка WASM — скрипт `scripts/build-gost-wasm.sh` из спайка.

- [ ] **Step 4: Тесты** — `npx vitest run test/unit/gost.test.ts` → PASS (все 4).

- [ ] **Step 5: Коммит**

```bash
git add src/core/crypto/gost.ts test/unit/gost.test.ts
git commit -m "feat(core): ГОСТ 34.10/34.11-2015 на кривой НУЦ"
```

---

### Task 5: RSA-движок

**Files:**
- Create: `src/core/crypto/rsa.ts`
- Test: `test/unit/rsa.test.ts`

**Interfaces:**
- Consumes: `parseP12` (Task 3).
- Produces:

```ts
export async function rsaSign(data: Uint8Array, pkcs8: Uint8Array): Promise<Uint8Array>; // RSASSA-PKCS1-v1_5 / SHA-256 над data (signedAttrs DER)
export async function rsaVerify(data: Uint8Array, signature: Uint8Array, certDer: Uint8Array): Promise<boolean>;
export const OID_SHA256 = "2.16.840.1.101.3.4.2.1";
export const OID_SHA256_RSA = "1.2.840.113549.1.1.11";
```

- [ ] **Step 1: Падающий тест**

```ts
import { describe, it, expect } from "vitest";
import { rsaSign, rsaVerify } from "../../src/core/crypto/rsa";
import { parseP12 } from "../../src/core/p12";
import { readFixture, FIXTURE_PASSWORD, RSA_PERSONAL } from "../helpers/fixtures";

describe("rsa", () => {
  it("sign → verify по сертификату", async () => {
    const p = parseP12(readFixture(RSA_PERSONAL), FIXTURE_PASSWORD);
    const data = new TextEncoder().encode("hello");
    const sig = await rsaSign(data, p.privateKeyPkcs8);
    expect(await rsaVerify(data, sig, p.certificateDer)).toBe(true);
    expect(await rsaVerify(new Uint8Array([0]), sig, p.certificateDer)).toBe(false);
  });
});
```

- [ ] **Step 2: Убедиться, что падает** — `npx vitest run test/unit/rsa.test.ts` → FAIL.

- [ ] **Step 3: Реализовать**

```ts
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";

export const OID_SHA256 = "2.16.840.1.101.3.4.2.1";
export const OID_SHA256_RSA = "1.2.840.113549.1.1.11";
const ALG = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

export async function rsaSign(data: Uint8Array, pkcs8: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("pkcs8", pkcs8, ALG, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign(ALG, key, data));
}

export async function rsaVerify(data: Uint8Array, signature: Uint8Array, certDer: Uint8Array): Promise<boolean> {
  const cert = new pkijs.Certificate({ schema: asn1js.fromBER(certDer).result });
  const spki = cert.subjectPublicKeyInfo.toSchema().toBER(false);
  const key = await crypto.subtle.importKey("spki", spki, ALG, false, ["verify"]);
  return crypto.subtle.verify(ALG, key, signature, data);
}
```

- [ ] **Step 4: Тест** — PASS.

- [ ] **Step 5: Коммит**

```bash
git add src/core/crypto/rsa.ts test/unit/rsa.test.ts
git commit -m "feat(core): RSA-подпись через WebCrypto"
```

---

### Task 6: CAdES-BES подписант

**Files:**
- Create: `src/core/signer.ts`
- Test: `test/unit/signer.test.ts`

**Interfaces:**
- Consumes: `parseP12`, `ParsedP12` (Task 3), `gost`, `OID_GOST_DIGEST`, `OID_GOST_SIGNATURE` (Task 4), `rsaSign`, `OID_SHA256`, `OID_SHA256_RSA` (Task 5).
- Produces:

```ts
export interface SignOptions { detached: boolean; signingTime?: Date }
export async function signCms(data: Uint8Array, key: ParsedP12, opts: SignOptions): Promise<Uint8Array>; // DER ContentInfo(SignedData)
export async function verifyCms(cms: Uint8Array, detachedData?: Uint8Array): Promise<{ valid: boolean; signerCertDer: Uint8Array }>;
```

`verifyCms` нужен для тестов и для подписи файла в popup (план 2). Он проверяет только математику подписи и `messageDigest`, не цепочку и не OCSP.

- [ ] **Step 1: Падающие тесты**

```ts
import { describe, it, expect } from "vitest";
import { signCms, verifyCms } from "../../src/core/signer";
import { parseP12 } from "../../src/core/p12";
import { readFixture, FIXTURE_PASSWORD, GOST2015_INDIVIDUAL, GOST2015_INDIVIDUAL_REVOKED, RSA_PERSONAL } from "../helpers/fixtures";

const data = new TextEncoder().encode("Договор №1");
const keys = {
  gost: parseP12(readFixture(GOST2015_INDIVIDUAL), FIXTURE_PASSWORD),
  rsa: parseP12(readFixture(RSA_PERSONAL), FIXTURE_PASSWORD),
};

describe.each(Object.entries(keys))("signCms %s", (_, key) => {
  it("attached: проверяется и содержит данные", async () => {
    const cms = await signCms(data, key, { detached: false });
    const r = await verifyCms(cms);
    expect(r.valid).toBe(true);
    expect(r.signerCertDer).toEqual(key.certificateDer);
    expect(Buffer.from(cms).includes(Buffer.from(data))).toBe(true);
  });
  it("detached: без данных внутри, проверяется с внешними данными", async () => {
    const cms = await signCms(data, key, { detached: true });
    expect(Buffer.from(cms).includes(Buffer.from(data))).toBe(false);
    expect((await verifyCms(cms, data)).valid).toBe(true);
    expect((await verifyCms(cms, new Uint8Array([1]))).valid).toBe(false);
  });
  it("пустые данные подписываются", async () => {
    expect((await verifyCms(await signCms(new Uint8Array(), key, { detached: false }))).valid).toBe(true);
  });
});

it("отозванный ключ подписывает: OCSP — не задача ядра", async () => {
  const k = parseP12(readFixture(GOST2015_INDIVIDUAL_REVOKED), FIXTURE_PASSWORD);
  expect((await verifyCms(await signCms(data, k, { detached: false }))).valid).toBe(true);
});
```

- [ ] **Step 2: Убедиться, что падает** — FAIL.

- [ ] **Step 3: Реализовать**

```ts
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import type { ParsedP12 } from "./p12";
import { gost, OID_GOST_DIGEST, OID_GOST_SIGNATURE } from "./crypto/gost";
import { rsaSign, rsaVerify, OID_SHA256, OID_SHA256_RSA } from "./crypto/rsa";

const OID_DATA = "1.2.840.113549.1.7.1";
const OID_SIGNED_DATA = "1.2.840.113549.1.7.2";
const OID_CONTENT_TYPE = "1.2.840.113549.1.9.3";
const OID_MESSAGE_DIGEST = "1.2.840.113549.1.9.4";
const OID_SIGNING_TIME = "1.2.840.113549.1.9.5";
const OID_SIGNING_CERT_V2 = "1.2.840.113549.1.9.16.2.47";

export interface SignOptions { detached: boolean; signingTime?: Date }

const sha256 = async (b: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", b));
const isGost = (k: ParsedP12) => k.algorithm === "GOST2015_256";
const digestFor = async (k: ParsedP12, b: Uint8Array) => (isGost(k) ? gost.digest(b) : sha256(b));

function attr(type: string, value: asn1js.AsnType) {
  return new pkijs.Attribute({ type, values: [value] });
}

function signingCertificateV2(k: ParsedP12, certHash: Uint8Array, cert: pkijs.Certificate) {
  const hashAlg = new pkijs.AlgorithmIdentifier({ algorithmId: isGost(k) ? OID_GOST_DIGEST : OID_SHA256 });
  const issuerSerial = new asn1js.Sequence({
    value: [
      new asn1js.Sequence({ value: [new asn1js.Constructed({ idBlock: { tagClass: 3, tagNumber: 4 }, value: [cert.issuer.toSchema()] })] }),
      cert.serialNumber,
    ],
  });
  const essCertIdV2 = new asn1js.Sequence({ value: [hashAlg.toSchema(), new asn1js.OctetString({ valueHex: certHash }), issuerSerial] });
  return new asn1js.Sequence({ value: [new asn1js.Sequence({ value: [essCertIdV2] })] });
}

export async function signCms(data: Uint8Array, key: ParsedP12, opts: SignOptions): Promise<Uint8Array> {
  const cert = new pkijs.Certificate({ schema: asn1js.fromBER(key.certificateDer).result });
  const digestOid = isGost(key) ? OID_GOST_DIGEST : OID_SHA256;
  const sigOid = isGost(key) ? OID_GOST_SIGNATURE : OID_SHA256_RSA;

  const signedAttrs = new pkijs.SignedAndUnsignedAttributes({
    type: 0,
    attributes: [
      attr(OID_CONTENT_TYPE, new asn1js.ObjectIdentifier({ value: OID_DATA })),
      attr(OID_SIGNING_TIME, new asn1js.UTCTime({ valueDate: opts.signingTime ?? new Date() })),
      attr(OID_MESSAGE_DIGEST, new asn1js.OctetString({ valueHex: await digestFor(key, data) })),
      attr(OID_SIGNING_CERT_V2, signingCertificateV2(key, await digestFor(key, key.certificateDer), cert)),
    ],
  });

  const signerInfo = new pkijs.SignerInfo({
    version: 1,
    sid: new pkijs.IssuerAndSerialNumber({ issuer: cert.issuer, serialNumber: cert.serialNumber }),
    digestAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: digestOid }),
    signatureAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: sigOid }),
    signedAttrs,
  });

  // подписывается DER signedAttrs с тегом SET (0x31), а не [0] — требование CMS (RFC 5652 §5.4)
  const attrsDer = new Uint8Array(new asn1js.Set({ value: signedAttrs.attributes.map((a) => a.toSchema()) }).toBER(false));
  const signature = isGost(key)
    ? gost.sign(gost.digest(attrsDer), key.privateKeyPkcs8)
    : await rsaSign(attrsDer, key.privateKeyPkcs8);
  signerInfo.signature = new asn1js.OctetString({ valueHex: signature });

  const signedData = new pkijs.SignedData({
    version: 1,
    digestAlgorithms: [new pkijs.AlgorithmIdentifier({ algorithmId: digestOid })],
    encapContentInfo: new pkijs.EncapsulatedContentInfo({
      eContentType: OID_DATA,
      ...(opts.detached ? {} : { eContent: new asn1js.OctetString({ valueHex: data }) }),
    }),
    certificates: [cert],
    signerInfos: [signerInfo],
  });

  const ci = new pkijs.ContentInfo({ contentType: OID_SIGNED_DATA, content: signedData.toSchema(true) });
  return new Uint8Array(ci.toSchema().toBER(false));
}

export async function verifyCms(cms: Uint8Array, detachedData?: Uint8Array) {
  const ci = new pkijs.ContentInfo({ schema: asn1js.fromBER(cms).result });
  const sd = new pkijs.SignedData({ schema: ci.content });
  const si = sd.signerInfos[0]!;
  const cert = sd.certificates![0] as pkijs.Certificate;
  const certDer = new Uint8Array(cert.toSchema().toBER(false));
  const gostKey = si.signatureAlgorithm.algorithmId === OID_GOST_SIGNATURE;

  const content = detachedData ?? new Uint8Array(sd.encapContentInfo.eContent!.valueBlock.valueHexView);
  const md = si.signedAttrs!.attributes.find((a) => a.type === OID_MESSAGE_DIGEST)!.values[0] as asn1js.OctetString;
  const actual = gostKey ? gost.digest(content) : await sha256(content);
  if (!Buffer.from(md.valueBlock.valueHexView).equals(Buffer.from(actual))) return { valid: false, signerCertDer: certDer };

  const attrsDer = new Uint8Array(new asn1js.Set({ value: si.signedAttrs!.attributes.map((a) => a.toSchema()) }).toBER(false));
  const sig = new Uint8Array(si.signature.valueBlock.valueHexView);
  const valid = gostKey
    ? gost.verify(gost.digest(attrsDer), sig, gost.publicKeyFromCert(certDer))
    : await rsaVerify(attrsDer, sig, certDer);
  return { valid, signerCertDer: certDer };
}
```

pkijs при разборе может переупорядочить атрибуты в `SET`. Если `verifyCms` проваливается на собственной подписи, бери исходные байты `signedAttrs` из `si.signedAttrs.encodedValue` и меняй первый байт `0xA0` на `0x31`, вместо того чтобы перекодировать атрибуты.

- [ ] **Step 4: Тесты** — `npx vitest run` → PASS (все).

- [ ] **Step 5: Коммит**

```bash
git add src/core/signer.ts test/unit/signer.test.ts
git commit -m "feat(core): CAdES-BES подпись и проверка (ГОСТ, RSA)"
```

---

### Task 7: Внешняя проверка — сравнение с эталоном НУЦ

Наши собственные тесты проверяют только согласованность с самими собой. Здесь подпись проверяет независимая сторона.

**Files:**
- Create: `scripts/sign-file.ts`
- Create: `docs/decisions/0002-external-verification.md`

**Interfaces:**
- Consumes: `parseP12` (Task 3), `signCms` (Task 6).

- [ ] **Step 1: CLI для подписи файла**

`scripts/sign-file.ts`:

```ts
import { readFileSync, writeFileSync } from "node:fs";
import { parseP12 } from "../src/core/p12";
import { signCms } from "../src/core/signer";

const [p12Path, password, inPath, mode = "attached"] = process.argv.slice(2);
if (!p12Path || !password || !inPath) {
  console.error("usage: tsx scripts/sign-file.ts <key.p12> <password> <file> [attached|detached]");
  process.exit(2);
}
const key = parseP12(new Uint8Array(readFileSync(p12Path)), password);
const cms = await signCms(new Uint8Array(readFileSync(inPath)), key, { detached: mode === "detached" });
writeFileSync(`${inPath}.cms`, cms);
console.log(`${inPath}.cms`, cms.length, "bytes", key.algorithm);
```

- [ ] **Step 2: Подписать образцы**

```bash
mkdir -p out && echo "test KZSign $(date +%F)" > out/sample.txt
npx tsx scripts/sign-file.ts test/fixtures/nca/ncanode-go-official/individual/valid/individual_valid.p12 Qwerty12 out/sample.txt
cp out/sample.txt out/sample-rsa.txt
npx tsx scripts/sign-file.ts test/fixtures/nca/danikarik/personal/active/RSA256_11c707bd54cbfcccb3815e39c4eb57b1dc7dfea9.p12 Qwerty12 out/sample-rsa.txt
openssl cms -cmsout -print -inform DER -in out/sample-rsa.txt.cms | head -40
openssl cms -verify -noverify -inform DER -in out/sample-rsa.txt.cms
```

Expected: последняя команда печатает текст файла и `CMS Verification successful`. Для ГОСТ OpenSSL не знает OID НУЦ, поэтому достаточно, что `-cmsout -print` разбирает структуру без ошибок.

- [ ] **Step 3: Проверка независимой стороной (вручную, человек)**

Проверить оба `.cms` (ГОСТ и RSA) на ezsigner.kz или в тестовом сервисе проверки подписей НУЦ (test.pki.gov.kz). Если есть Docker, поднять эталонный NCANode (`docker run -p 14579:14579 malikzh/ncanode`) и вызвать `POST /cms/verify` с base64 подписи. Ожидаемо: подпись математически валидна. Цепочка тестового УЦ может не доверяться — это нормально.

Записать результат в `docs/decisions/0002-external-verification.md`: чем проверяли, что ответил сервис, скриншот или JSON-ответ. Если проверка не прошла: в RSA-подписи сравни порядок атрибутов, в ГОСТ — порядок байтов подписи. Исправь и вернись к Step 2.

- [ ] **Step 4: Коммит**

```bash
git add scripts docs/decisions/0002-external-verification.md
git commit -m "test: внешняя проверка CMS-подписи (ГОСТ, RSA)"
```

**Стоп-точка:** без успешной внешней проверки план 2 не начинается.

---

## Покрытие спецификации

| Требование спецификации | Где |
|---|---|
| §3 `p12.ts`, отказ от ГОСТ 2004 | Task 3 |
| §3 `crypto/gost.ts`, §10 спайк ГОСТ | Task 2, 4 |
| §3 `crypto/rsa.ts` (неэкспортируемый ключ) | Task 5 |
| §3 `signer.ts` CAdES-BES attached/detached | Task 6 |
| §1 критерий «проверяется на ezsigner.kz» | Task 7 |
| §5 затирание ключа после подписи | Task 4 (Step 3) |
| §3 shim, bridge, proto, policy, native-proxy, keystore, confirm, popup; §6 TSP; §8 ошибки | План 2 |
