import { describe, expect, it } from "vitest";
import {
  assertThemeRuntimeVersion, parseBoundedThemeJson, parseThemeDefinition,
  parseThemePackageManifest, THEME_INPUT_LIMITS,
} from "../../src/utils/themePackageValidation";

const manifest = {
  name: "fixture-theme", version: "1.0.0", kind: "theme", min_runtime_version: "0.99.0",
  theme_schema_version: 1,
  theme_variants: [{ id: "dark", name: "Dark", file: "themes/dark.json" }],
};

describe("bounded theme JSON", () => {
  it("accepts valid JSON at the byte boundary", () => {
    expect(parseBoundedThemeJson('{"a":"é"}', 10)).toEqual({ a: "é" });
    expect(() => parseBoundedThemeJson('{"a":"é"}', 9)).toThrow("byte");
  });
  it.each([
    '', ' ', '{} {}', '{"x":1,}', '{/* comment */"x":1}', 'NaN', '{"x":Infinity}',
    '{"x":1,"x":2}', '{"mode":1,"\\u006dode":2}', '{"nested":{"x":1,"x":2}}',
  ])("rejects malformed, JSONC or duplicate-key input: %s", (input) => {
    expect(() => parseBoundedThemeJson(input, 1024)).toThrow();
  });
  it("bounds containers before JSON.parse can recurse", () => {
    expect(parseBoundedThemeJson('['.repeat(16) + '0' + ']'.repeat(16), 1024)).toBeDefined();
    expect(() => parseBoundedThemeJson('['.repeat(17) + '0' + ']'.repeat(17), 1024)).toThrow("depth");
  });
  it("bounds value count independently of byte count", () => {
    const input = JSON.stringify(Array(THEME_INPUT_LIMITS.jsonNodes).fill(0));
    expect(() => parseBoundedThemeJson(input, THEME_INPUT_LIMITS.definitionBytes)).toThrow("node");
  });
  it("does not confuse repeated keys in independent objects with duplicates", () => {
    expect(parseBoundedThemeJson('[{"x":1},{"x":2}]', 100)).toEqual([{ x: 1 }, { x: 2 }]);
  });
});

describe("theme definition v1", () => {
  it.each(["light", "dark", "high-contrast"])("accepts a minimal %s definition", (mode) => {
    const value = { schemaVersion: 1, mode };
    expect(parseThemeDefinition(JSON.stringify(value))).toEqual(value);
  });
  it("accepts implemented visual fields, alpha, local fonts and ordered SQL rules", () => {
    const value = {
      schemaVersion: 1, mode: "dark", attribution: "Fixture author",
      colors: { bg: { base: "#01020380" }, semantic: { string: "#abcdef" } },
      typography: { fontFamily: { mono: ["Fira Code", "monospace"] } },
      layout: { borderRadius: { base: 3.5 } },
      editor: { colors: { "editor.background": "#04050600" }, rules: [
        { token: "string.sql", foreground: "#ff0000", fontStyle: "bold italic" },
        { token: "string.sql", foreground: "#00ff00" },
      ] },
    };
    expect(parseThemeDefinition(JSON.stringify(value))).toEqual(value);
  });
  it.each([
    { origin: "builtin" }, { isReadOnly: false }, { base: "some-package" }, { schemaVersion: 2 },
    { css: "body {}" }, { taskbarIcon: { iconPath: "/tmp/icon" } },
    { colors: { bg: { base: "red" } } }, { colors: { bg: { base: "url(https://example.test)" } } },
    { colors: { semantic: { connectionActive: "#ffffff" } } },
    { typography: { fontSize: { base: "14px" } } }, { layout: { spacing: { base: 2 } } },
    { layout: { borderRadius: { base: 100 } } },
    { typography: { fontFamily: { base: ["url(remote)"] } } },
    { editor: { colors: { "gitlens.gutterBackgroundColor": "#123456" } } },
    { editor: { themeName: "GitHub Dark" } },
    { editor: { rules: [{ token: "unknown.scope", foreground: "#123456" }] } },
    { editor: { rules: [{ token: "string", fontStyle: "blink" }] } },
    { editor: { rules: Array(1025).fill({ token: "string" }) } },
  ])("rejects unsupported or unsafe new-format overrides: %j", (override) => {
    expect(() => parseThemeDefinition(JSON.stringify({ schemaVersion: 1, mode: "dark", ...override }))).toThrow();
  });
  it("rejects author-owned prototype and identity keys", () => {
    expect(() => parseThemeDefinition('{"schemaVersion":1,"mode":"dark","__proto__":{"isPreset":true}}')).toThrow();
    expect(Object.prototype).not.toHaveProperty("isPreset");
  });
});

describe("theme package manifest v1", () => {
  it("retains supported registry metadata", () => {
    const value = { ...manifest, license: "MIT", readmes: { en: "README.md" }, support: { email: "author@example.test" } };
    expect(parseThemePackageManifest(JSON.stringify(value))).toEqual(value);
  });
  it("accepts SemVer prerelease/build identities without silently normalizing them", () => {
    const value = { ...manifest, version: "1.0.0-beta.1+build.42" };
    expect(parseThemePackageManifest(JSON.stringify(value)).version).toBe(value.version);
  });
  it("tolerates registry-owned metadata it does not validate", () => {
    const value = { ...manifest, description: 42, unknown_registry_field: { nested: true } };
    expect(parseThemePackageManifest(JSON.stringify(value))).toEqual(value);
  });
  it("prefers id as identity and frees the display name", () => {
    const value = { ...manifest, id: "fixture-theme", name: "Fixture Theme for Tabularis" };
    expect(parseThemePackageManifest(JSON.stringify(value))).toEqual(value);
  });
  it.each([
    { name: "Fixture Theme" }, { id: "Fixture", name: "x" }, { id: "con", name: "x" },
    { id: "", name: "x" }, { id: 7, name: "x" }, { id: "a".repeat(65), name: "x" },
  ])("rejects invalid identities: %j", (override) => {
    expect(() => parseThemePackageManifest(JSON.stringify({ ...manifest, ...override }))).toThrow();
  });
  it.each([
    { kind: "driver" }, { kind: undefined }, { name: "con" },
    { min_runtime_version: "^0.99.0" }, { version: "01.0.0" }, { version: "1.0.0-01" },
    { theme_variants: [] }, { theme_variants: Array(33).fill(manifest.theme_variants[0]) },
    { theme_variants: [manifest.theme_variants[0], manifest.theme_variants[0]] },
    { theme_variants: [{ id: "dark", name: "Dark", file: "themes/../escape.json" }] },
    { theme_variants: [{ id: "dark", name: "Dark", file: "themes/CON.json" }] },
    { theme_variants: [{ id: "dark", name: "Dark", file: "themes/folder./dark.json" }] },
    { theme_variants: [manifest.theme_variants[0], { id: "light", name: "Light", file: "themes/DARK.json" }] },
  ])("rejects mismatched kind, invalid versions or variants: %j", (override) => {
    expect(() => parseThemePackageManifest(JSON.stringify({ ...manifest, ...override }))).toThrow();
  });
  it("enforces the runtime floor without a development escape hatch", () => {
    const parsed = parseThemePackageManifest(JSON.stringify(manifest));
    expect(() => assertThemeRuntimeVersion(parsed, "0.99.0")).not.toThrow();
    expect(() => assertThemeRuntimeVersion(parsed, "1.0.0")).not.toThrow();
    for (const host of ["0.24.0", "0.99.0-beta.1", "garbage"]) {
      expect(() => assertThemeRuntimeVersion(parsed, host)).toThrow();
    }
  });
});
