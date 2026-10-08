import { describe, it, expect } from "vitest";
import { readFixture, GOST2015_INDIVIDUAL, RSA_PERSONAL, NCA_GOST2022_CA } from "../helpers/fixtures";

describe("fixtures", () => {
  it("читает тестовые ключи и сертификат УЦ", () => {
    expect(readFixture(GOST2015_INDIVIDUAL).length).toBe(1803);
    expect(readFixture(RSA_PERSONAL).length).toBe(3431);
    expect(readFixture(NCA_GOST2022_CA).length).toBe(1025);
  });
});
