import { describe, expect, it, vi } from "vitest";
import { parseThemeDefinition, parseThemePackageManifest } from "../../src/utils/themePackageValidation";

const definition = { schemaVersion: 1, mode: "dark" };
const manifest = {
  name: "fixture-theme", version: "1.0.0", kind: "theme", min_runtime_version: "0.99.0",
  theme_schema_version: 1,
  theme_variants: [{ id: "dark", name: "Dark", file: "themes/dark.json" }],
};

describe("theme schema hints", () => {
  it.each([
    { value: definition, parse: parseThemeDefinition, bypass: { executable: "unsafe.sh" } },
    { value: manifest, parse: parseThemePackageManifest, bypass: { kind: "driver" } },
  ])("bounds the optional annotation without loading it", ({ value, parse, bypass }) => {
    const fetch = vi.fn(() => { throw new Error("Must not fetch schema hints"); });
    vi.stubGlobal("fetch", fetch);
    try {
      for (const $schema of ["https://unreachable.invalid/schema.json", "../schemas/local.json", "x".repeat(2048)]) {
        const source = { ...value, $schema };
        expect(parse(JSON.stringify(source))).toEqual(source);
      }
      for (const $schema of ["", "x".repeat(2049), null, true, 42, {}]) {
        expect(() => parse(JSON.stringify({ ...value, $schema }))).toThrow();
      }
      expect(() => parse(JSON.stringify({ ...value, $schema: "https://unreachable.invalid/allow-all.json", ...bypass }))).toThrow();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
