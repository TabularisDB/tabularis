import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface NotebookLocale {
  editor: {
    notebook: Record<string, string>;
  };
}

const localesDirectory = resolve(__dirname, "../../src/i18n/locales");
const localeFiles = readdirSync(localesDirectory)
  .filter((file) => file.endsWith(".json"))
  .sort();
const english = JSON.parse(
  readFileSync(resolve(localesDirectory, "en.json"), "utf8"),
) as NotebookLocale;
const notebookKeys = [
  "sectionQueryPlan",
  "explainPopout",
  "toggleQueryPlan",
  "hideQueryPlan",
  "resultExportSuccess",
  "exportError",
  "queryPlanOutdated",
  "queryPlanUnresolved",
] as const;

describe("notebook query plan translations", () => {
  it("covers all 11 supported locale JSON files", () => {
    expect(localeFiles).toEqual([
      "de.json",
      "en.json",
      "es.json",
      "fr.json",
      "it.json",
      "ja.json",
      "ko.json",
      "pt-BR.json",
      "ru.json",
      "tl.json",
      "zh.json",
    ]);
  });

  it("preserves the specified English query-plan messages", () => {
    expect(english.editor.notebook.queryPlanOutdated).toBe(
      "The query or connection changed. Re-run to refresh the plan.",
    );
    expect(english.editor.notebook.queryPlanUnresolved).toBe(
      "Run referenced cells successfully before explaining this query: {{refs}}",
    );
  });

  describe.each(localeFiles)("%s", (file) => {
    const translation = JSON.parse(
      readFileSync(resolve(localesDirectory, file), "utf8"),
    ) as NotebookLocale;

    it.each(notebookKeys)("defines %s with matching interpolation", (key) => {
      const value = translation.editor.notebook[key];
      expect(value).toBeTypeOf("string");
      expect(value.trim()).not.toBe("");

      const tokens = (value.match(/\{\{[^{}]+\}\}/g) ?? []).sort();
      const englishTokens = (
        english.editor.notebook[key].match(/\{\{[^{}]+\}\}/g) ?? []
      ).sort();
      expect(tokens).toEqual(englishTokens);
      expect(tokens).toEqual(key === "queryPlanUnresolved" ? ["{{refs}}"] : []);
    });
  });
});