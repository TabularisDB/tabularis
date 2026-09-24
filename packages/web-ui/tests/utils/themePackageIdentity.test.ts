import { describe, expect, it } from "vitest";
import {
  createInstalledThemeId,
  isThemePackagePath,
  isThemePackageSlug,
  themePackageId,
  parseInstalledThemeId,
} from "../../src/utils/themePackageIdentity";

const identity = {
  registryKey: "a".repeat(64),
  packageName: "midnight-theme",
  variantId: "dark",
};

describe("theme package identities", () => {
  it("roundtrips without embedding mutable version or display data", () => {
    const id = createInstalledThemeId(identity);
    expect(id).toBe(`theme:${identity.registryKey}:midnight-theme:dark`);
    expect(parseInstalledThemeId(id)).toEqual(identity);
    expect(createInstalledThemeId({ ...identity })).toBe(id);
  });

  it("keeps registries, packages and variants distinct", () => {
    const ids = [
      identity,
      { ...identity, registryKey: "b".repeat(64) },
      { ...identity, packageName: "another-theme" },
      { ...identity, variantId: "light" },
    ].map(createInstalledThemeId);
    expect(new Set(ids).size).toBe(4);
  });

  it("accepts the maximum portable identity without truncation", () => {
    const maximum = { ...identity, packageName: "a".repeat(64), variantId: "b".repeat(64) };
    const id = createInstalledThemeId(maximum);
    expect(id).toHaveLength(200);
    expect(parseInstalledThemeId(id)).toEqual(maximum);
  });

  it.each([
    "tabularis-dark", "custom-1700000000000", "theme:dark", "theme:::dark",
    `theme:${identity.registryKey}:midnight-theme:dark:extra`,
    `theme:${identity.registryKey}:midnight-theme:dark\n`,
    null, undefined, {}, [], 42,
  ])("does not interpret malformed or legacy selections: %j", (value) => {
    expect(parseInstalledThemeId(value)).toBeNull();
  });

  it.each([
    "", "A".repeat(64), "a".repeat(63), "a".repeat(65),
    `${"a".repeat(64)}\n`, "https://registry.example.test", "../../registry",
  ])("rejects a noncanonical registry key: %j", (registryKey) => {
    expect(() => createInstalledThemeId({ ...identity, registryKey })).toThrow();
    expect(parseInstalledThemeId(`theme:${registryKey}:midnight-theme:dark`)).toBeNull();
  });

  it.each(["packageName", "variantId"] as const)("validates the %s component", (key) => {
    for (const value of ["", "../escape", "other:dark", "CON", "nul", "a".repeat(65), "dark\n"]) {
      expect(() => createInstalledThemeId({ ...identity, [key]: value })).toThrow();
    }
  });
});

describe("theme package identity", () => {
  it("uses id when declared and the legacy slug name otherwise", () => {
    expect(themePackageId({ id: "ember-theme", name: "Ember Theme for Tabularis" })).toBe("ember-theme");
    expect(themePackageId({ name: "ember-theme" })).toBe("ember-theme");
  });
  it.each([
    { name: "Ember Theme" }, { id: "Ember", name: "x" }, { id: "con", name: "x" }, { id: "", name: "x" },
  ])("rejects %j", (manifest) => {
    expect(() => themePackageId(manifest)).toThrow();
  });
});

describe("portable theme package slugs", () => {
  it.each(["a", "dark", "high-contrast", "theme-123", "com10", "a".repeat(64)])(
    "accepts %s", (value) => expect(isThemePackageSlug(value)).toBe(true),
  );

  it.each([
    "", "Uppercase", "1theme", "a_b", "a.b", "-dark", "a".repeat(65),
    "con", "prn", "aux", "nul", "com1", "com9", "lpt1", "lpt9",
    "dark\n", "dark\r", "dark\r\n", "dark\u2028", "dark\u2029", "défaut",
    null, undefined, 7, {}, [],
  ])("rejects %j", (value) => expect(isThemePackageSlug(value)).toBe(false));
});

describe("portable theme package paths", () => {
  it.each([
    ".tabularium", "README.md", "LICENSE", "themes/dark.json",
    "themes/high-contrast.json", "screenshots/preview-1.png",
    "a/b/c/d/e/f/g/h.json", "a".repeat(240), "COM10.json",
  ])("accepts a portable relative path: %s", (value) => {
    expect(isThemePackagePath(value)).toBe(true);
  });

  it.each([
    "", ".", "..", "../outside", "themes/../dark.json", "/etc/passwd",
    "themes//dark.json", "themes/./dark.json", "themes/", "C:/theme.json",
    "C:theme.json", "C:\\theme.json", "\\\\server\\share", "//server/share",
    "themes\\dark.json", "themes/dark.json:stream", "themes/dark.json ",
    "themes/dark.json.", "themes/.hidden.json", "themes/%2e%2e/escape.json",
    "themes/%2fescape.json", "themes/dark.json\0", "themes/dark.json\n",
    "themes/dark.json\r", "themes/dark.json\u2028", "themes/dark.json\u2029",
    "themes/café.json", "themes/COM1.json", "themes/lpt9.txt", "NUL", "aux.json",
    "themes/CON/file.json", "a/b/c/d/e/f/g/h/i.json", "a".repeat(241),
    null, undefined, 42, {}, [],
  ])("rejects unsafe or ambiguous paths without normalizing them: %j", (value) => {
    expect(isThemePackagePath(value)).toBe(false);
  });
});
