import { describe, expect, it } from "vitest";
import en from "../../src/i18n/locales/en.json";

const locales = import.meta.glob<{ default: typeof en }>("../../src/i18n/locales/*.json", { eager: true });

describe("auto-refresh translations", () => {
  it.each(Object.entries(locales))("covers every control and status in %s", (_path, locale) => {
    expect(Object.keys(locale.default.toolbar.autoRefresh).sort()).toEqual(Object.keys(en.toolbar.autoRefresh).sort());
    for (const value of Object.values(locale.default.toolbar.autoRefresh)) expect(value.trim()).not.toBe("");
    expect(locale.default.toolbar.autoRefresh.seconds).toContain("{{seconds}}");
    expect(locale.default.toolbar.autoRefresh.failed).toContain("{{error}}");
  });
});
