# Тестовые ключи НУЦ РК

Тестовые ключи и сертификаты тестового УЦ НУЦ РК. Юридической силы не имеют. Пароль ко всем `.p12`: `Qwerty12`.

| Папка | Источник | Лицензия | Алгоритм ключа |
|---|---|---|---|
| `ncanode-go-official/` | https://github.com/ncanode-kz/NCANode-Go (`internal/testdata/certs`) | MIT | ГОСТ 34.10-2015, OID `1.2.398.3.10.1.1.2.2` |
| `danikarik/` `RSA256_*`, `AUTH_RSA256_*` | https://github.com/danikarik/ncanode-go (`testdata`) | MIT | RSA |
| `danikarik/` `GOSTKNCA_*` | там же | MIT | ГОСТ 34.310-2004, OID `1.2.398.3.10.1.1.1.1` |

Ключи в папках `revoked/` отозваны тестовым УЦ: на них проверяем реакцию на OCSP.
