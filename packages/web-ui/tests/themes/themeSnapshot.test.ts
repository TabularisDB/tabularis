import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resolveCatalogEntry } from "../../src/utils/themeCatalog";
import { resolveLegacyTheme } from "../../src/utils/themeResolver";
import legacy from "../../../../tests/fixtures/themes/legacy-frontend.json";
import type { Theme } from "../../src/types/theme";

beforeAll(() => vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })));
afterAll(() => vi.unstubAllGlobals());

describe("portable independent snapshot rendering", () => {
  it("preserves exact SQL rules where flattening into the historical format cannot", async () => {
    const { StandaloneThemeService } = await import("monaco-editor/esm/vs/editor/standalone/browser/standaloneThemeService.js");
    const { TokenMetadata } = await import("monaco-editor/esm/vs/editor/common/encodedTokenAttributes.js");
    const engine = new StandaloneThemeService();
    const source = structuredClone(legacy) as Theme;
    source.colors.semantic.string = "#00ff00";
    const editor = { base: "vs-dark" as const, inherit: true, colors: { "editor.background": "#010203" }, rules: [{ token: "string.sql", foreground: "ff0000", fontStyle: "italic" }] };
    try {
      const naive = resolveLegacyTheme({ ...source, monacoTheme: editor }, { id: "naive-export", name: "Naive", revision: "1", origin: { kind: "personal" } });
      engine.defineTheme("naive-export", naive.editor); engine.setTheme("naive-export");
      let tokens = engine.getColorTheme().tokenTheme;
      expect(tokens.getColorMap()[TokenMetadata.getForeground(tokens.match(0, "string.sql"))].toString()).toBe("#00ff00");
      // This is the DTO produced by native snapshot preview/import. The source
      // remains legacy JSON, while the validated exact editor stays separate.
      const imported = resolveCatalogEntry({ id: "custom-import", name: "Import", revision: "1", source: JSON.stringify(source), editor, format: "legacy", mode: "dark", readOnly: false, available: true, origin: { kind: "personal" } });
      engine.defineTheme("custom-import", imported.resolved.editor); engine.setTheme("custom-import");
      tokens = engine.getColorTheme().tokenTheme;
      expect(tokens.getColorMap()[TokenMetadata.getForeground(tokens.match(0, "string.sql"))].toString()).toBe("#ff0000");
      expect(engine.getColorTheme().getColor("editor.background")?.toString()).toBe("#010203");
      expect(imported.entry.source).toBe(JSON.stringify(source));
    } finally { engine.dispose(); }
  });
});
