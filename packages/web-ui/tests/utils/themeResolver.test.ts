import { describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import type { ThemeContributionContext } from "../../src/types/themePackage";
import { resolveLegacyTheme, resolveThemeDefinition } from "../../src/utils/themeResolver";
import { createInstalledThemeId } from "../../src/utils/themePackageIdentity";
import { getMonacoThemeDefinition, loadMonacoTheme } from "../../src/themes/themeUtils";
import { themeRegistry } from "../../src/themes/themeRegistry";

const personal: ThemeContributionContext = { id: "custom-fixture", name: "Fixture", revision: "r1", origin: { kind: "personal" } };
const identity = { registryKey: "a".repeat(64), packageName: "fixture-theme", variantId: "dark" };
const installed: ThemeContributionContext = {
  id: createInstalledThemeId(identity), name: "Fixture", revision: "r1",
  origin: { kind: "installed", identity, packageVersion: "1.0.0" },
};

function monacoMock() {
  const defineTheme = vi.fn();
  const setTheme = vi.fn();
  return { defineTheme, setTheme, instance: { editor: { defineTheme, setTheme } } as unknown as typeof Monaco };
}

describe("common theme resolver", () => {
  it.each([
    "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
    "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "emoji", "math", "fangsong", "UI-MONOSPACE",
  ])("keeps CSS generic family %s unquoted rather than requesting a literal local font", (family) => {
    const resolved = resolveThemeDefinition(JSON.stringify({ schemaVersion: 1, mode: "dark", typography: {
      fontFamily: { base: ["Local Font", family] },
    } }), personal);
    expect(resolved.theme.typography.fontFamily.base).toBe(`"Local Font", ${family}`);
  });

  it("uses host provenance and produces equivalent visuals when bundled or installed", () => {
    const source = JSON.stringify({ schemaVersion: 1, mode: "dark", colors: { bg: { base: "#123456" } } });
    const bundled = resolveThemeDefinition(source, { ...personal, origin: { kind: "builtin" } });
    const external = resolveThemeDefinition(source, installed);
    expect(external.theme.colors).toEqual(bundled.theme.colors);
    expect(external.theme.typography).toEqual(bundled.theme.typography);
    expect(external.theme.layout).toEqual(bundled.theme.layout);
    expect(external.editor).toEqual(bundled.editor);
    expect(bundled.theme.isPreset).toBe(true);
    expect(external.theme.isPreset).toBe(false);
    expect(external.theme.isReadOnly).toBe(true);
    expect(external.theme.version).toBe("1.0.0");
    expect(external.descriptor.origin).toEqual(installed.origin);
  });

  it.each(["light", "dark", "high-contrast"])("has a deterministic offline %s fallback", (mode) => {
    const input = JSON.stringify({ schemaVersion: 1, mode });
    const first = resolveThemeDefinition(input, personal);
    const second = resolveThemeDefinition(input, personal);
    expect(first).toEqual(second);
    expect(first.theme.isReadOnly).toBe(false);
    expect(first.editor.base).toBe(mode === "light" ? "vs" : mode === "dark" ? "vs-dark" : "hc-black");
  });

  it("keeps partial defaults, numeric alpha and final explicit editor precedence", () => {
    const resolved = resolveThemeDefinition(JSON.stringify({
      schemaVersion: 1, mode: "dark",
      colors: { accent: { primary: "#11223380" }, surface: { active: "#12345680" } },
      editor: { colors: { "editor.background": "#abcdef" }, rules: [
        { token: "string.sql", foreground: "#ff0000" },
        { token: "string.sql", foreground: "#00ff00", fontStyle: "bold" },
      ] },
    }), personal);
    expect(resolved.theme.colors.text.primary).toBeDefined();
    expect(resolved.editor.colors?.["editor.inactiveSelectionBackground"]).toBe("#12345640");
    expect(resolved.editor.colors?.["editor.background"]).toBe("#abcdef");
    expect(resolved.editor.rules?.filter((rule) => rule.token === "string.sql")).toEqual([
      { token: "string.sql", foreground: "00ff00", fontStyle: "bold" },
    ]);
    expect(resolved.source.kind === "v1" && resolved.source.value.editor?.rules).toEqual([
      { token: "string.sql", foreground: "#ff0000" },
      { token: "string.sql", foreground: "#00ff00", fontStyle: "bold" },
    ]);
    // The application path must not append legacy string defaults after v1 rules.
    expect(getMonacoThemeDefinition(resolved.theme)).toBe(resolved.editor);
    const monaco = monacoMock();
    loadMonacoTheme(resolved.theme, monaco.instance);
    expect(monaco.defineTheme).toHaveBeenCalledWith(personal.id, resolved.editor);
  });

  it("applies only implemented typography/layout leaves", () => {
    const resolved = resolveThemeDefinition(JSON.stringify({ schemaVersion: 1, mode: "light",
      typography: { fontFamily: { mono: ["Fira Code", "monospace"] } },
      layout: { borderRadius: { base: 0 } },
    }), personal);
    expect(resolved.theme.typography.fontFamily.mono).toBe('"Fira Code", monospace');
    expect(resolved.theme.layout.borderRadius.base).toBe("0px");
    expect(resolved.theme.layout.spacing.base).toBeDefined();
  });

  it("rejects mismatched installed identity and author-owned aliases", () => {
    expect(() => resolveThemeDefinition('{"schemaVersion":1,"mode":"dark"}', { ...installed, id: "tabularis-dark" })).toThrow("identity");
    expect(() => resolveThemeDefinition('{"schemaVersion":1,"mode":"dark","origin":"builtin"}', personal)).toThrow();
    expect(() => resolveThemeDefinition('{"schemaVersion":1,"mode":"dark","base":"other-package"}', personal)).toThrow();
  });

  it("keeps source data independent and read-only provenance out of the author payload", () => {
    const base = themeRegistry.getDefault();
    const before = JSON.stringify(base);
    const resolved = resolveLegacyTheme(base, personal);
    expect(resolved.theme.isPreset).toBe(false);
    expect(resolved.theme.isReadOnly).toBe(false);
    expect(resolved.source).toEqual({ kind: "legacy", value: base });
    resolved.theme.colors.bg.base = "#ffffff";
    expect(JSON.stringify(base)).toBe(before);
    expect(JSON.stringify(resolved.source.value)).toBe(before);
  });
});

describe("Monaco revision and instance cache", () => {
  it("defines the same ID independently for separate Monaco module instances", () => {
    const theme = themeRegistry.getDefault();
    const first = monacoMock();
    const second = monacoMock();
    loadMonacoTheme(theme, first.instance);
    loadMonacoTheme(theme, second.instance);
    expect(first.defineTheme).toHaveBeenCalledTimes(1);
    expect(second.defineTheme).toHaveBeenCalledTimes(1);
  });
  it("refreshes same-ID package content and does not redefine identical output", () => {
    const monaco = monacoMock();
    const original = resolveThemeDefinition('{"schemaVersion":1,"mode":"dark"}', installed);
    const changed = resolveThemeDefinition('{"schemaVersion":1,"mode":"dark","editor":{"colors":{"editor.background":"#123456"}}}', { ...installed, revision: "r2" });
    loadMonacoTheme(original.theme, monaco.instance);
    loadMonacoTheme(original.theme, monaco.instance);
    expect(monaco.defineTheme).toHaveBeenCalledTimes(1);
    loadMonacoTheme(changed.theme, monaco.instance);
    expect(monaco.defineTheme).toHaveBeenCalledTimes(2);
    expect(monaco.setTheme).toHaveBeenCalledTimes(3);
    expect(monaco.defineTheme.mock.lastCall?.[1].colors["editor.background"]).toBe("#123456");
  });
  it("refreshes same-ID legacy personal edits too", () => {
    const monaco = monacoMock();
    const original = structuredClone(themeRegistry.getDefault());
    original.monacoTheme = { base: "vs-dark", inherit: true };
    loadMonacoTheme(original, monaco.instance);
    const changed = structuredClone(original);
    changed.colors.semantic.string = "#123456";
    loadMonacoTheme(changed, monaco.instance);
    expect(monaco.defineTheme).toHaveBeenCalledTimes(2);
  });
  it("retries a failed definition rather than caching a failure", () => {
    const monaco = monacoMock();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    monaco.defineTheme.mockImplementationOnce(() => { throw new Error("definition failed"); });
    const theme = themeRegistry.getDefault();
    loadMonacoTheme(theme, monaco.instance);
    loadMonacoTheme(theme, monaco.instance);
    expect(monaco.defineTheme).toHaveBeenCalledTimes(2);
    expect(monaco.setTheme).toHaveBeenLastCalledWith(theme.id);
    error.mockRestore();
  });
});
