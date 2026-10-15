import { describe, expect, it } from "vitest";

const locales = import.meta.glob<{ default: { whatsNew: Record<string, string> } }>(
  "../../src/i18n/locales/*.json",
  { eager: true },
);

const requiredKeys = [
  "title", "subtitle", "features", "bugFixes", "breakingChanges",
  "readMore", "dismiss", "supportTitle", "supportDescription", "supportAction",
  "supportStarAction", "supportThanks", "supportNeverShow", "supportHideError",
];

describe("What's New translations", () => {
  it.each(Object.entries(locales))("provides all modal strings in %s", (_path, locale) => {
    for (const key of requiredKeys) {
      expect(locale.default.whatsNew[key], key).toBeTypeOf("string");
      expect(locale.default.whatsNew[key].trim(), key).not.toBe("");
    }
    expect(locale.default.whatsNew.supportDescription).toContain("Tabularis");
    expect(locale.default.whatsNew.supportDescription).toContain("GitHub Sponsors");
    expect(locale.default.whatsNew.supportAction).toContain("GitHub Sponsors");
    expect(locale.default.whatsNew.subtitle).toContain("{{version}}");
  });
});
