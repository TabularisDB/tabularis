import { describe, expect, it } from "vitest";
import { editThemeDefinition } from "../../src/utils/themeDefinitionEditing";
import { resolveThemeDefinition } from "../../src/utils/themeResolver";

const source = '{"schemaVersion":1, "mode":"dark", "attribution":"Keep me", "editor":{"rules":[{"token":"keyword","fontStyle":"italic"},{"token":"keyword","foreground":"#abcdef"}]}}';
const previous = () => resolveThemeDefinition(source, { id: "personal", name: "Personal", revision: "1", origin: { kind: "personal" } }).theme;

describe("personal v1 definition editing", () => {
  it("retains source bytes and ordered overrides for a name-only update", () => {
    const theme = previous();
    expect(editThemeDefinition(source, theme, { ...theme, name: "Renamed" })).toBe(source);
  });
  it("edits one palette leaf without flattening unrelated author rules", () => {
    const theme = previous();
    const updated = structuredClone(theme);
    updated.colors.accent.primary = "#12345678";
    const result = JSON.parse(editThemeDefinition(source, theme, updated));
    expect(result.colors).toEqual({ accent: { primary: "#12345678" } });
    expect(result.editor).toEqual(JSON.parse(source).editor);
    expect(result.attribution).toBe("Keep me");
  });
  it("supports local font lists and bounded pixel radii", () => {
    const theme = previous();
    const updated = structuredClone(theme);
    updated.typography.fontFamily.mono = '"Local Mono", monospace';
    updated.layout.borderRadius.base = "12px";
    const result = JSON.parse(editThemeDefinition(source, theme, updated));
    expect(result.typography.fontFamily.mono).toEqual(["Local Mono", "monospace"]);
    expect(result.layout.borderRadius.base).toBe(12);
  });
  it("rejects unsupported fields rather than pretending to save them", () => {
    const theme = previous();
    const updated = structuredClone(theme);
    updated.typography.fontSize.base = "30px";
    expect(() => editThemeDefinition(source, theme, updated)).toThrow("not supported");
    const unsupported = structuredClone(theme);
    unsupported.colors.semantic.connectionActive = "#123456";
    expect(() => editThemeDefinition(source, theme, unsupported)).toThrow();
  });
});
