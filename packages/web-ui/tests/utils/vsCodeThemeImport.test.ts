import { describe, expect, it, vi } from "vitest";
import { convertVsCodeTheme } from "../../src/utils/vsCodeThemeImport";
import { parseThemeDefinition, THEME_INPUT_LIMITS } from "../../src/utils/themePackageValidation";

const theme = (extra: Record<string, unknown> = {}) => JSON.stringify({ type: "dark", colors: { "editor.background": "#123456" }, ...extra });

describe("bounded, pure VS Code theme conversion", () => {
  it("accepts JSONC while package definitions remain strict JSON", () => {
    const converted = convertVsCodeTheme('{ // local only\n "type":"dark", "colors":{"editor.background":"#123",},}');
    expect(converted.definition.colors?.bg?.base).toBe("#112233");
    expect(() => parseThemeDefinition('{"schemaVersion":1,"mode":"dark",}')).toThrow();
    expect(() => parseThemeDefinition('{/* no comments */"schemaVersion":1,"mode":"dark"}')).toThrow();
  });
  it.each([["light", "light"], ["dark", "dark"], ["hc", "high-contrast"], ["hcDark", "high-contrast"]])("maps explicit mode %s", (type, expected) => {
    expect(convertVsCodeTheme(theme({ type })).definition.mode).toBe(expected);
  });
  it("requires explicit choice for missing or unsupported mode", () => {
    for (const type of [undefined, "hcLight", "unknown"]) {
      expect(() => convertVsCodeTheme(theme({ type }))).toThrow("modeRequired");
      expect(convertVsCodeTheme(theme({ type }), { mode: "light" }).definition.mode).toBe("light");
    }
    expect(convertVsCodeTheme(theme({ type: "hcLight" }), { mode: "light" }).diagnostics).toContainEqual({ code: "modeApproximation", path: "type" });
  });
  it("maps application and registered editor colors, including shorthand alpha", () => {
    const result = convertVsCodeTheme(theme({ colors: { "editor.background": "#1234", "sideBar.background": "#223344", "editorCursor.foreground": "#aabbcc", "unknown.color": "#112233" } }));
    expect(result.definition.colors?.bg?.base).toBe("#11223344");
    expect(result.definition.colors?.surface?.primary).toBe("#223344");
    expect(result.definition.editor?.colors?.["editorCursor.foreground"]).toBe("#aabbcc");
    expect(result.diagnostics).toContainEqual({ code: "unsupportedColor", path: "colors.unknown.color" });
  });
  it("maps only tested SQL scope families and reports specificity/style losses", () => {
    const result = convertVsCodeTheme(theme({ tokenColors: [
      { scope: ["keyword.control.sql", "keyword.operator.sql"], settings: { foreground: "#ff0", fontStyle: "bold italic glow", background: "#000000" } },
      { scope: "source.sql comment", settings: { foreground: "#00ff00" } },
      { scope: "string", settings: { fontStyle: "" } },
    ] }));
    expect(result.definition.editor?.rules).toEqual([
      { token: "keyword.sql", foreground: "#ffff00", fontStyle: "bold italic" },
      { token: "operator.sql", foreground: "#ffff00", fontStyle: "bold italic" },
      { token: "string.sql", fontStyle: "" },
    ]);
    expect(result.diagnostics.map(({ code }) => code)).toEqual(expect.arrayContaining(["unsupportedStyle", "unsupportedSetting", "unsupportedScope", "scopeApproximation"]));
  });
  it("preserves ordered updates and default rules", () => {
    const result = convertVsCodeTheme(theme({ tokenColors: [
      { settings: { foreground: "#abcdef" } },
      { scope: "comment", settings: { foreground: "#112233", fontStyle: "italic" } },
      { scope: "comment", settings: { foreground: "#445566" } },
    ] }));
    expect(result.definition.editor?.rules?.map((rule) => rule.token)).toEqual(["", "comment.sql", "comment.sql"]);
  });
  it("reports semantic rules, includes, references and token alpha without fetching", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    try {
      const result = convertVsCodeTheme(theme({ include: "https://example.invalid/remote.json", semanticTokenColors: { variable: "#abcdef" }, tokenColors: "../external.tmTheme", executable: "do-not-execute" }));
      expect(result.diagnostics.map(({ code }) => code)).toEqual(expect.arrayContaining(["ignoredInclude", "ignoredSemanticTokens", "unsupportedReference", "unsupportedKey"]));
      expect(fetch).not.toHaveBeenCalled();
      expect(convertVsCodeTheme(theme({ tokenColors: [{ scope: "string", settings: { foreground: "#ff000080" } }] })).diagnostics.map(({ code }) => code)).toContain("tokenAlphaFlattened");
    } finally { vi.unstubAllGlobals(); }
  });
  it("fails rather than manufacturing a fallback-only theme", () => {
    expect(() => convertVsCodeTheme('{}', { mode: "dark" })).toThrow("unrecognized");
    expect(() => convertVsCodeTheme('{"include":"../external.json"}', { mode: "dark" })).toThrow("includeOnly");
    expect(() => convertVsCodeTheme(theme({ colors: { unsupported: "#123456" } }))).toThrow("noSupportedData");
  });
  it.each(["red", "url(https://example.invalid)", "#12", "#gg0000", 123, null])("rejects malformed supported color %s", (value) => {
    expect(() => convertVsCodeTheme(theme({ colors: { "editor.background": value } }))).toThrow("invalidColor");
  });
  it("preserves optional attribution without implying a license", () => {
    const result = convertVsCodeTheme(theme({ name: "Original", author: "Original author" }));
    expect(result.name).toBe("Original"); expect(result.definition.attribution).toBe("Original author");
    expect("license" in result.definition).toBe(false);
  });
  it("rejects decoded duplicate keys, invalid Unicode, nonfinite values and prototype-only input", () => {
    expect(() => convertVsCodeTheme('{"type":"dark","colors":{},"\\u0063olors":{}}')).toThrow("Duplicate");
    expect(() => convertVsCodeTheme('{"name":"\\ud800"}')).toThrow("Unicode");
    expect(() => convertVsCodeTheme('{"unknown":1e999}')).toThrow("number");
    expect(() => convertVsCodeTheme('{"__proto__":{"type":"dark","colors":{"editor.background":"#123456"}}}')).toThrow("unrecognized");
  });
  it("bounds raw bytes, nesting, JSON nodes and expanded scope lists", () => {
    expect(() => convertVsCodeTheme(" ".repeat(THEME_INPUT_LIMITS.definitionBytes + 1))).toThrow("byte limit");
    expect(() => convertVsCodeTheme("[".repeat(20) + "0" + "]".repeat(20))).toThrow("depth limit");
    expect(() => convertVsCodeTheme(JSON.stringify(Array(32768).fill(0)))).toThrow("node limit");
    expect(() => convertVsCodeTheme(theme({ tokenColors: [{ scope: "string,".repeat(2048), settings: { foreground: "#abcdef" } }] }))).toThrow("invalidRules");
  });
  it("bounds diagnostic count and path size", () => {
    const colors = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`unknown${i}`, "#123456"]));
    const result = convertVsCodeTheme(theme({ colors: { ...colors, "editor.background": "#123456" } }));
    expect(result.diagnostics).toHaveLength(129);
    expect(result.diagnostics.at(-1)?.code).toBe("diagnosticsTruncated");
  });
});
