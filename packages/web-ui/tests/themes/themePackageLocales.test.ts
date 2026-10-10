import { describe, expect, it } from "vitest";

const locales = import.meta.glob("../../src/i18n/locales/*.json", { eager: true, import: "default" }) as Record<string, { themePackages: Record<string, unknown> }>;
function leaves(value: Record<string, unknown>, prefix = ""): Record<string, string> {
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => typeof item === "string" ? [[prefix + key, item]] : Object.entries(leaves(item as Record<string, unknown>, `${prefix}${key}.`))));
}

describe("theme package translations", () => {
  it("provides every label, conversion diagnostic and interpolation in all 11 locales", () => {
    const english = leaves(locales["../../src/i18n/locales/en.json"].themePackages);
    expect(Object.keys(locales)).toHaveLength(11);
    for (const [locale, value] of Object.entries(locales)) {
      const translated = leaves(value.themePackages);
      expect(Object.keys(translated).sort(), locale).toEqual(Object.keys(english).sort());
      for (const [key, text] of Object.entries(english)) {
        expect(translated[key].trim(), `${locale}: ${key}`).not.toBe("");
        expect(translated[key].match(/\{\{\w+\}\}/g) ?? [], `${locale}: ${key}`).toEqual(text.match(/\{\{\w+\}\}/g) ?? []);
      }
    }
  });
});
