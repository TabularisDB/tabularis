import { describe, expect, it } from "vitest";
import en from "../../src/i18n/locales/en.json";

const locales = import.meta.glob<{ default: typeof en }>("../../src/i18n/locales/*.json", { eager: true });

describe("filter match-case translations", () => {
  it.each(Object.entries(locales))("covers the toggle and its hint in %s", (_path, locale) => {
    const { toolbar } = locale.default;
    expect(toolbar.matchCase.trim()).not.toBe("");
    expect(toolbar.matchCaseHint.trim()).not.toBe("");
    // The hint names the SQL keyword the toggle switches to, so translators
    // can't drop it without the tooltip becoming misleading.
    expect(toolbar.matchCaseHint).toContain("ILIKE");
  });
});
