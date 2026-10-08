# 0003. XML-подпись (XMLDSig) в формате НУЦ

Дата: 2026-10-09. Эталон — NCANode (Kalkan), `/xml/sign` и `/xml/verify`.

## Формат

- Enveloped-подпись последним дочерним элементом корня, `Reference URI=""`.
- Transforms: `enveloped-signature`, затем `REC-xml-c14n-20010315#WithComments`. По стандарту XMLDSig `URI=""` отбрасывает комментарии до трансформаций, поэтому **хэш считается от C14N без комментариев** (так делает и Kalkan; комментарии в подпись не входят).
- `SignedInfo` канонизируется по `REC-xml-c14n-20010315` с пространствами имён предков.
- ГОСТ: `urn:ietf:params:xml:ns:pkigovkz:xmlsec:algorithms:gostr34102015-gostr34112015-512`, хэш `…:gostr34112015-512`. `DigestValue` — Стрибог-512 в обычном порядке; `SignatureValue` — тот же формат, что в CMS (0001).
- RSA: `xmldsig-more#rsa-sha256`, `xmlenc#sha256`.
- XML с `<!DOCTYPE>` отклоняется (`MALFORMED_XML`): сущности DTD позволяют показать одно, а подписать другое.

## Проверка

Эталонные подписи Kalkan (`test/fixtures/xml/`) проходят нашу проверку. Наши подписи NCANode признаёт VALID: `<login>` (как вход на egov), пространства имён, комментарии, CDATA, сущности, CRLF; ГОСТ физлица и юрлица; с тестовым OCSP. Изменённый документ — INVALID. Сквозной тест: ncalayer-js-client `basicsSignXML` в Chromium.

## Не сделано

- Фильтр ключей по `signerParams.extKeyUsageOids` (egov просит ключ для аутентификации). Сейчас пользователь выбирает ключ сам.
- `signXmlByElementId`, подпись отдельных элементов.
