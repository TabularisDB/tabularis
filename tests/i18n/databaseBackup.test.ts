import { describe, expect, it } from "vitest";
import en from "../../src/i18n/locales/en.json";

const locales = import.meta.glob<{ default: typeof en }>("../../src/i18n/locales/*.json", { eager: true });

const backupKeys = Object.keys(en.settings.backup).filter(
  (key) => key.startsWith("dbBackup") || key.startsWith("database") || key.startsWith("connectionProfiles"),
) as (keyof typeof en.settings.backup)[];

describe("scheduled database backup translations", () => {
  it.each(Object.entries(locales))("covers every database backup string in %s", (_path, locale) => {
    const backup = locale.default.settings.backup as Record<string, string>;
    for (const key of backupKeys) {
      expect(backup[key]?.trim(), key).toBeTruthy();
      const placeholders = (text: string) => (text.match(/\{\{\w+\}\}/g) ?? []).sort();
      expect(placeholders(backup[key]), key).toEqual(placeholders(en.settings.backup[key]));
    }
  });
});
