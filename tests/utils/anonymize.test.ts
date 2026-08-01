import { describe, expect, it } from "vitest";
import { generateAnonymizeKey } from "../../src/utils/anonymize";

describe("generateAnonymizeKey", () => {
  it("returns 32 lowercase hex chars", () => {
    const key = generateAnonymizeKey();
    expect(key).toMatch(/^[0-9a-f]{32}$/);
  });

  it("generates a fresh key each call", () => {
    expect(generateAnonymizeKey()).not.toBe(generateAnonymizeKey());
  });
});
