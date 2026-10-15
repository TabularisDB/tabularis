import { describe, expect, it } from "vitest";
import builtins from "../../src/themes/builtin-themes.json";
import { DEFAULT_THEME_SETTINGS } from "../../src/types/theme";
import type { NativeThemeContribution } from "../../src/types/themeCatalog";
import { builtinCatalog, hydrateThemePreferences, resolveCatalogEntry, resolveNativeCatalog, selectEffectiveTheme } from "../../src/utils/themeCatalog";
import { getMonacoThemeDefinition } from "../../src/themes/themeUtils";
import { themeRegistry } from "../../src/themes/themeRegistry";

const installed = (available = true, source = '{"schemaVersion":1,"mode":"light"}'): NativeThemeContribution => ({
  id: `theme:${"a".repeat(64)}:fixture:light`, name: "Fixture", revision: source, source, available,
  origin: { kind: "installed", identity: { registryKey: "a".repeat(64), packageName: "fixture", variantId: "light" }, packageVersion: "1.0.0" },
  mode: "light", format: "v1", readOnly: true,
});

describe("native theme catalog materialization", () => {
  it("keeps the native builtin inventory and complete rendering in sync", () => {
    expect(builtins).toEqual(JSON.parse(JSON.stringify(themeRegistry.getAllPresets())));
    const resolved = builtinCatalog();
    for (const entry of resolved.themes) expect(entry.resolved.editor).toEqual(getMonacoThemeDefinition(themeRegistry.getPreset(entry.entry.id)!));
  });
  it("uses native provenance and preserves original source for export", () => {
    const source = '{"schemaVersion":1, "mode":"light", "attribution":"Original"}';
    const entry = resolveCatalogEntry(installed(true, source));
    expect(entry.resolved.theme.isReadOnly).toBe(true);
    expect(entry.resolved.theme.isPreset).toBe(false);
    expect(entry.entry.source).toBe(source);
  });
  it("updates availability without losing same-revision renderer associations", () => {
    const first = resolveNativeCatalog({ themes: [installed()], issues: [] });
    const next = resolveNativeCatalog({ themes: [installed(false)], issues: [] }, first);
    expect(next.themes[0].resolved).toBe(first.themes[0].resolved);
    expect(next.themes[0].entry.available).toBe(false);
  });
  it("isolates invalid contributions and carries native diagnostics", () => {
    const result = resolveNativeCatalog({ themes: [installed(true, "invalid")], issues: ["Corrupt package"] });
    expect(result.themes).toEqual([]);
    expect(result.issues).toHaveLength(2);
    expect(result.issues[0].message).toBe("Corrupt package");
  });
});

describe("saved, effective and preview theme selection", () => {
  it("keeps an unavailable saved identity and restores it after reinstall", () => {
    const settings = { ...DEFAULT_THEME_SETTINGS, activeThemeId: installed().id };
    const source = JSON.stringify(settings);
    expect(selectEffectiveTheme(settings, [], true).missingId).toBe(installed().id);
    const theme = resolveCatalogEntry(installed()).resolved.theme;
    expect(selectEffectiveTheme(settings, [theme], true).theme).toBe(theme);
    expect(JSON.stringify(settings)).toBe(source);
  });
  it("keeps both system choices independent of effective fallbacks and preview", () => {
    const settings = { ...DEFAULT_THEME_SETTINGS, followSystemTheme: true, lightThemeId: "missing-light", darkThemeId: "missing-dark" };
    expect(selectEffectiveTheme(settings, [], false).theme.id).toBe("tabularis-light");
    const preview = themeRegistry.getPreset("monokai")!;
    expect(selectEffectiveTheme(settings, [], true, preview)).toMatchObject({ theme: preview, requestedId: "missing-dark", previewing: true });
    expect(settings.activeThemeId).toBe("tabularis-dark");
  });
  it("hydrates legacy storage without rewriting or accepting non-string identities", () => {
    const legacy = '{"activeThemeId":"retained-personal"}';
    expect(hydrateThemePreferences({}, legacy, false).activeThemeId).toBe("retained-personal");
    expect(hydrateThemePreferences({ theme: "retained-installed" }, legacy, false).activeThemeId).toBe("retained-installed");
    expect(hydrateThemePreferences({}, '{"activeThemeId":{}}', false).activeThemeId).toBe("tabularis-light");
  });
});
