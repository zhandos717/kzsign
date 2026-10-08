# 0002. Внешняя проверка CMS-подписи

Дата: 2026-10-08. Эталон: NCANode (`malikzh/ncanode`, внутри Kalkan/DSS), запущен локально с тестовыми УЦ НУЦ:

```bash
docker run -d --name ncanode-test -p 14579:14579 \
  -e NCANODE_CA_URL="http://test.pki.gov.kz/cert/root_test_gost_2022.cer http://test.pki.gov.kz/cert/nca_gost2022_test.cer" \
  -e NCANODE_CRL_ENABLED=false -e NCANODE_CA_CRL_ENABLED=false \
  -e NCANODE_OCSP_URL=http://test.pki.gov.kz/ocsp/ malikzh/ncanode
```

Подпись: `npx tsx scripts/sign-file.ts <key.p12> Qwerty12 <file> [detached]`, проверка: `POST /cms/verify`.

## Результат

| Случай | Ответ NCANode |
|---|---|
| ГОСТ 2015, физлицо, attached | `VALID`, CAdES-B |
| то же + OCSP тестового НУЦ | `VALID` |
| ГОСТ, detached + верные данные | `VALID` |
| ГОСТ, detached + чужие данные | 400 (отклонено) |
| ГОСТ, отозванный ключ + OCSP | `INVALID / CERT_REVOKED` |
| ГОСТ, юрлицо: employee, employee_signright, head, infosystem, treasury_client | все `VALID` |
| RSA, attached | структура принята (CAdES-B), `OUT_OF_BOUNDS_NO_POE` — тестовый RSA-сертификат истёк в 2021; OpenSSL: `CMS Verification successful` |

## Найдено и исправлено

Самопроверки (`verifyCms`) этих ошибок не видели: подпись и проверка были согласованы между собой, но не с Kalkan.

1. **`messageDigest` в ГОСТ-подписи** был в обратном порядке байтов → `content hash found in signed attributes different`. Правильно: в атрибуте Стрибог-512 как есть, в обратном порядке — только как число для подписи. Тест: `ГОСТ: messageDigest — Стрибог-512 в обычном порядке байтов`.
2. **`SigningCertificateV2`** с хэшем ГОСТ НУЦ → `CERT_HASH_MISMATCH`. Правильно: SHA-256 (значение по умолчанию для ESSCertIDv2, RFC 5035). Тест: `SigningCertificateV2 — SHA-256 сертификата подписанта`.

## CAdES-T (план 2, Task 8)

`npx tsx scripts/sign-file.ts <ГОСТ individual_valid.p12> Qwerty12 out/t.txt attached --tsp` → запрос к боевому `http://tsp.pki.gov.kz/` (уходит только хэш значения подписи). NCANode: `VALID`, `adesLevel: "T"`, метка `policy 1.2.398.3.3.2.6.2`. Боевой TSA ставит метки и на подписи тестовыми ключами.

Подпись TSA на токене в `parseTimeStampResp` не проверяется (нет доверенной цепочки TSA в расширении): проверяются статус, nonce и `messageImprint`. Полную проверку токена делает верификатор подписи.
