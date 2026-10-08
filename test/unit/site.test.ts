import { it, expect } from "vitest";
import { splitHost } from "../../src/ui/site";

it.each([
  ["https://egov.kz", "", "egov.kz"],
  ["https://idp.egov.kz", "idp.", "egov.kz"],
  ["https://v3bl.goszakup.gov.kz", "v3bl.", "goszakup.gov.kz"],
  ["https://goszakup.gov.kz.evil.com", "goszakup.gov.kz.", "evil.com"],
  ["https://xn--e1afmkfd.xn--p1ai", "", "xn--e1afmkfd.xn--p1ai"],
  ["http://localhost:8080", "", "localhost"],
])("%s", (o, prefix, site) => expect(splitHost(o)).toMatchObject({ prefix, site }));
