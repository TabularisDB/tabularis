import { describe, expect, it } from "vitest";
import { exportThemePackage, materializePackageDefinition } from "../../src/utils/themePackageExport";
import { resolveCatalogEntry, builtinCatalog } from "../../src/utils/themeCatalog";
import type { ThemePackageManifestV1 } from "../../src/types/themePackage";

const manifest: ThemePackageManifestV1 = { name: "author-theme", version: "1.0.0", kind: "theme", min_runtime_version: "0.24.0", theme_schema_version: 1, theme_variants: [{ id: "main", name: "Main", file: "themes/main.json" }] };

describe("theme package export", () => {
  it("inherits matching frozen rem radii and editor defaults instead of converting or rejecting them", () => {
    const original = builtinCatalog().themes[0].entry;
    const source = JSON.parse(original.source); source.monacoTheme = { base: "vs-dark", inherit: true };
    const entry = resolveCatalogEntry({ ...original, id: "custom-generated", source: JSON.stringify(source), origin: { kind: "personal" }, readOnly: false });
    const before = JSON.stringify(entry);
    expect(entry.resolved.editor.colors?.["editor.lineHighlightBorder"]).toBe("transparent");
    const definition = materializePackageDefinition(entry);
    expect(JSON.stringify(entry)).toBe(before);
    expect(definition.layout?.borderRadius).toEqual({});
    expect(definition.editor?.colors).toEqual({});
    expect(exportThemePackage(entry, manifest, "Fixture license").byteLength).toBeGreaterThan(0);
  });

  it("preserves imported declaration, attribution and ordered rules without mutating the personal source", () => {
    const source = JSON.stringify({ schemaVersion: 1, mode: "dark", attribution: "Original author — permission required", editor: { rules: [{ token: "keyword.sql", foreground: "#123456", fontStyle: "italic" }, { token: "keyword.sql", fontStyle: "" }] } });
    const theme = resolveCatalogEntry({ id: "custom-export", name: "Export", revision: "original", source, format: "v1", mode: "dark", available: true, readOnly: false, origin: { kind: "personal" } });
    expect(materializePackageDefinition(theme)).toEqual(JSON.parse(source));
    const bytes = exportThemePackage(theme, manifest, "Permission obtained separately.");
    expect(new TextDecoder().decode(bytes)).toContain("Original author");
    expect(theme.entry.source).toBe(source); expect(theme.entry.revision).toBe("original");
    expect(bytes).toEqual(exportThemePackage(theme, manifest, "Permission obtained separately."));
  });
  it("gives actionable refusal for unrepresentable legacy editor behavior", () => {
    const theme = structuredClone(builtinCatalog().themes[0]);
    theme.resolved.editor.inherit = false;
    expect(() => materializePackageDefinition(theme)).toThrow("standalone JSON");
    theme.resolved.editor.inherit = true;
    theme.resolved.editor.rules = [{ token: "keyword.sql", background: "000000" }];
    expect(() => materializePackageDefinition(theme)).toThrow("background");
  });
  it("refuses unexpected manifest payload fields and ambiguous multi-variant exports", () => {
    const theme = resolveCatalogEntry({ id: "custom-export", name: "Export", revision: "1", source: '{"schemaVersion":1,"mode":"dark"}', format: "v1", mode: "dark", available: true, readOnly: false, origin: { kind: "personal" } });
    expect(() => exportThemePackage(theme, { ...manifest, theme_variants: [...manifest.theme_variants, { id: "other", name: "Other", file: "themes/other.json" }] }, "License")).toThrow("one variant");
    expect(() => exportThemePackage(theme, { ...manifest, kind: "driver" } as unknown as ThemePackageManifestV1, "License")).toThrow();
  });
});
