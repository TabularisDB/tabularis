import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import { getMonacoThemeId } from "../../src/themes/themeRuntime";
import { loadMonacoTheme } from "../../src/themes/themeUtils";
import { resolveLegacyTheme, resolveThemeDefinition } from "../../src/utils/themeResolver";
import legacy from "../../../../tests/fixtures/themes/legacy-frontend.json";
import type { Theme } from "../../src/types/theme";
import { createInstalledThemeId } from "../../src/utils/themePackageIdentity";
import schema from "../../src/schemas/theme-definition-v1.json";

interface EngineTheme {
  themeName: string;
  getColor(name: string): { toString(): string } | undefined;
  tokenTheme: {
    match(language: number, token: string): number;
    getColorMap(): Array<{ toString(): string }>;
  };
}
interface ThemeEngine {
  defineTheme(name: string, data: Monaco.editor.IStandaloneThemeData): void;
  setTheme(name: string): void;
  getColorTheme(): EngineTheme;
  dispose(): void;
}

let Engine: new () => ThemeEngine;
let foreground: (metadata: number) => number;
let background: (metadata: number) => number;
let fontStyle: (metadata: number) => number;
let inlineStyle: (metadata: number, colors: string[]) => string;
const engines: ThemeEngine[] = [];

beforeAll(async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }));
  const implementation = await import("monaco-editor/esm/vs/editor/standalone/browser/standaloneThemeService.js");
  Engine = implementation.StandaloneThemeService;
  const metadata = await import("monaco-editor/esm/vs/editor/common/encodedTokenAttributes.js");
  foreground = metadata.TokenMetadata.getForeground;
  background = metadata.TokenMetadata.getBackground;
  fontStyle = metadata.TokenMetadata.getFontStyle;
  inlineStyle = metadata.TokenMetadata.getInlineStyleFromMetadata.bind(metadata.TokenMetadata);
});

afterEach(() => { for (const engine of engines.splice(0)) engine.dispose(); });
afterAll(() => vi.unstubAllGlobals());

function instance() {
  const engine = new Engine();
  engines.push(engine);
  const defineTheme = vi.fn((name: string, data: Monaco.editor.IStandaloneThemeData) => engine.defineTheme(name, data));
  const setTheme = vi.fn((name: string) => engine.setTheme(name));
  return { engine, defineTheme, setTheme, monaco: { editor: { defineTheme, setTheme } } as unknown as typeof Monaco };
}

const identity = { registryKey: "a".repeat(64), packageName: "fixture-theme", variantId: "dark" };
const context = {
  id: createInstalledThemeId(identity), name: "Fixture", revision: "r1",
  origin: { kind: "installed" as const, identity, packageVersion: "1.0.0" },
};

describe("actual Monaco theme engine", () => {
  it.each(["__proto__", "constructor", "toString", "hasOwnProperty"])("does not resolve inherited object member %s as a named asset", (themeName) => {
    const theme = structuredClone(legacy) as Theme;
    theme.monacoTheme.themeName = themeName;
    const resolved = resolveLegacyTheme(theme, { id: "personal-fixture", name: "Fixture", revision: "r1", origin: { kind: "personal" } });
    const { engine, monaco } = instance();
    loadMonacoTheme(resolved.theme, monaco);
    expect(engine.getColorTheme().themeName).toBe("personal-fixture");
    expect(resolved.editor.colors?.["editor.background"]).toBe(legacy.monacoTheme.colors["editor.background"]);
    expect(engine.getColorTheme().getColor("editor.background")?.toString()).toBe("rgba(18, 52, 86, 0.47)");
    expect(resolved.source.kind === "legacy" && resolved.source.value.monacoTheme.themeName).toBe(themeName);
  });

  it.each(["light", "dark", "high-contrast"])("renders the same %s definition when bundled or installed", (mode) => {
    const source = JSON.stringify({ schemaVersion: 1, mode, editor: { rules: [{ token: "string.sql", foreground: "#abcd12" }] } });
    const bundled = resolveThemeDefinition(source, { id: "bundled-fixture", name: "Fixture", revision: "r1", origin: { kind: "builtin" } });
    const installed = resolveThemeDefinition(source, context);
    const first = instance();
    const second = instance();
    loadMonacoTheme(bundled.theme, first.monaco);
    loadMonacoTheme(installed.theme, second.monaco);
    const a = first.engine.getColorTheme();
    const b = second.engine.getColorTheme();
    expect(a.getColor("editor.background")?.toString()).toBe(b.getColor("editor.background")?.toString());
    expect(a.tokenTheme.getColorMap()[foreground(a.tokenTheme.match(0, "string.sql"))].toString()).toBe("#abcd12");
    expect(b.tokenTheme.getColorMap()[foreground(b.tokenTheme.match(0, "string.sql"))].toString()).toBe("#abcd12");
  });

  it.each(["light", "dark", "high-contrast"])("renders omitted %s editor borders as transparent rather than Monaco's invalid-color red", (mode) => {
    const resolved = resolveThemeDefinition(JSON.stringify({ schemaVersion: 1, mode }), context);
    const { engine, monaco } = instance();
    loadMonacoTheme(resolved.theme, monaco);
    for (const key of ["editor.lineHighlightBorder", "editorOverviewRuler.border", "editorError.background", "editorError.border", "editorWarning.border", "editorInfo.border", "editorHint.border", "inputValidation.errorBorder"]) {
      expect(resolved.editor.colors?.[key]).toBe("#00000000");
      expect(engine.getColorTheme().getColor(key)?.toString()).toBe("rgba(0, 0, 0, 0)");
    }
    expect(Object.values(resolved.editor.colors ?? {})).not.toContain("transparent");
  });

  it("preserves explicit author border colors instead of replacing them with transparent defaults", () => {
    const colors = { "editor.lineHighlightBorder": "#f28c3c", "editorOverviewRuler.border": "#3d2f27" };
    const resolved = resolveThemeDefinition(JSON.stringify({ schemaVersion: 1, mode: "dark", editor: { colors } }), context);
    const { engine, monaco } = instance();
    loadMonacoTheme(resolved.theme, monaco);
    for (const [key, color] of Object.entries(colors)) expect(engine.getColorTheme().getColor(key)?.toString()).toBe(color);
    expect(resolved.source.kind === "v1" && resolved.source.value.editor?.colors).toEqual(colors);
  });

  it("does not advertise token backgrounds that the DOM renderer ignores", () => {
    const { engine } = instance();
    engine.defineTheme("legacy-background-fixture", { base: "vs-dark", inherit: true, colors: {}, rules: [
      { token: "string.sql", foreground: "ff0000", background: "0000ff" },
    ] });
    engine.setTheme("legacy-background-fixture");
    const tokens = engine.getColorTheme().tokenTheme;
    const metadata = tokens.match(0, "string.sql");
    expect(tokens.getColorMap()[background(metadata)].toString()).toBe("#0000ff");
    expect(inlineStyle(metadata, tokens.getColorMap().map((color) => color?.toString() ?? ""))).not.toContain("background");
    expect(() => resolveThemeDefinition('{"schemaVersion":1,"mode":"dark","editor":{"rules":[{"token":"string.sql","background":"#0000ff"}]}}', context)).toThrow();
  });

  it("materializes token alpha instead of letting Monaco silently discard it", () => {
    const source = JSON.stringify({ schemaVersion: 1, mode: "dark", editor: {
      colors: { "editor.background": "#000000", "editor.foreground": "#00ff0080" },
      rules: [{ token: "string.sql", foreground: "#ff000080" }],
    } });
    const resolved = resolveThemeDefinition(source, context);
    const { engine, monaco } = instance();
    loadMonacoTheme(resolved.theme, monaco);
    const tokens = engine.getColorTheme().tokenTheme;
    expect(tokens.getColorMap()[foreground(tokens.match(0, "string.sql"))].toString()).toBe("#800000");
    expect(tokens.getColorMap()[foreground(tokens.match(0, "identifier.sql"))].toString()).toBe("#008000");
    expect(resolved.source.kind === "v1" && resolved.source.value.editor?.rules?.[0].foreground).toBe("#ff000080");
  });

  it("supports distinct foreground colors for the complete SQL token allowlist", () => {
    const rules = schema.properties.editor.properties.rules.items.properties.token.enum.map((token, index) => ({
      token, foreground: `#01${index.toString(16).padStart(4, "0")}`,
    }));
    const resolved = resolveThemeDefinition(JSON.stringify({ schemaVersion: 1, mode: "dark", editor: { rules } }), context);
    const { engine, monaco } = instance();
    loadMonacoTheme(resolved.theme, monaco);
    const tokens = engine.getColorTheme().tokenTheme;
    for (const rule of rules) {
      const metadata = tokens.match(0, rule.token);
      expect(tokens.getColorMap()[foreground(metadata)].toString()).toBe(rule.foreground);
    }
  });

  it("retains earlier style leaves while later explicit empty styles reset them", () => {
    const rules = [{ token: "string.sql", foreground: "#ff0000", fontStyle: "bold" }, { token: "string.sql", foreground: "#00ff00" }];
    const source = { schemaVersion: 1, mode: "dark", editor: { rules } };
    const { engine, monaco } = instance();
    loadMonacoTheme(resolveThemeDefinition(JSON.stringify(source), context).theme, monaco);
    expect(fontStyle(engine.getColorTheme().tokenTheme.match(0, "string.sql"))).toBe(2);
    rules.push({ token: "string.sql", foreground: "#00ff00", fontStyle: "" });
    loadMonacoTheme(resolveThemeDefinition(JSON.stringify(source), context).theme, monaco);
    expect(fontStyle(engine.getColorTheme().tokenTheme.match(0, "string.sql"))).toBe(0);
  });

  it("proves namespaced selection IDs need a separate renderer identifier", () => {
    const { engine } = instance();
    expect(() => engine.defineTheme(context.id, { base: "vs-dark", inherit: true, colors: {}, rules: [] })).toThrow("Illegal theme name");
    const resolved = resolveThemeDefinition('{"schemaVersion":1,"mode":"dark"}', context);
    expect(() => engine.defineTheme(getMonacoThemeId(resolved.theme.id), resolved.editor as Monaco.editor.IStandaloneThemeData)).not.toThrow();
    expect(resolved.theme.id).toBe(context.id);
  });

  it("applies qualified IDs, explicit SQL rules and same-ID revisions to the real engine", () => {
    const first = resolveThemeDefinition(JSON.stringify({ schemaVersion: 1, mode: "dark", editor: {
      colors: { "editor.background": "#123456" },
      rules: [{ token: "string.sql", foreground: "#ff0000" }, { token: "string.sql", foreground: "#00ff00", fontStyle: "bold" }],
    } }), context);
    const { engine, monaco, defineTheme } = instance();
    loadMonacoTheme(first.theme, monaco);
    expect(engine.getColorTheme().themeName).toBe(getMonacoThemeId(context.id));
    expect(engine.getColorTheme().getColor("editor.background")?.toString()).toBe("#123456");
    const tokens = engine.getColorTheme().tokenTheme;
    expect(tokens.getColorMap()[foreground(tokens.match(0, "string.sql"))].toString()).toBe("#00ff00");
    const revised = resolveThemeDefinition('{"schemaVersion":1,"mode":"dark","editor":{"colors":{"editor.background":"#654321"}}}', { ...context, revision: "r2" });
    loadMonacoTheme(revised.theme, monaco);
    expect(defineTheme).toHaveBeenCalledTimes(2);
    expect(engine.getColorTheme().getColor("editor.background")?.toString()).toBe("#654321");
  });

  it("honors the last of 1024 ordered rules without overflowing encoded colors", () => {
    const rules = Array.from({ length: 1024 }, (_, index) => ({ token: "string.sql", foreground: `#${index.toString(16).padStart(6, "0")}` }));
    const resolved = resolveThemeDefinition(JSON.stringify({ schemaVersion: 1, mode: "dark", editor: { rules } }), context);
    const { engine, monaco } = instance();
    loadMonacoTheme(resolved.theme, monaco);
    const tokens = engine.getColorTheme().tokenTheme;
    expect(tokens.getColorMap()[foreground(tokens.match(0, "string.sql"))].toString()).toBe("#0003ff");
  });
});

describe("renderer identity namespace", () => {
  it.each(["tabularis-dark", "tabularis-light", "custom-123", "Legacy-Theme"])("retains ordinary identity %s", (id) => {
    expect(getMonacoThemeId(id)).toBe(id);
  });
  it("is collision-free across package tuples, legacy prefixes and Unicode units", () => {
    const packageId = context.id;
    const encoded = getMonacoThemeId(packageId);
    const ids = [packageId, encoded, encoded.toUpperCase(), "theme:a-b:c", "theme:a:b-c", "😀", "😁", "\ud800", "\ufffd", "", "vs", "vs-dark", "hc-black", "hc-light"];
    const names = ids.map(getMonacoThemeId);
    expect(new Set(names).size).toBe(ids.length);
    expect(names.every((name) => /^[a-z0-9-]+$/i.test(name))).toBe(true);
    expect(names.some((name) => ["vs", "vs-dark", "hc-black", "hc-light"].includes(name))).toBe(false);
  });
});
