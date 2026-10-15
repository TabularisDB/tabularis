import type { Theme, ThemeSettings } from "../types/theme";
import { DEFAULT_THEME_SETTINGS } from "../types/theme";
import type { CatalogTheme, NativeThemeCatalog, NativeThemeContribution, ResolvedThemeCatalog, ThemeSelection } from "../types/themeCatalog";
import { themeRegistry } from "../themes/themeRegistry";
import { registerResolvedEditorTheme } from "../themes/themeRuntime";
import { resolveLegacyTheme, resolveThemeDefinition } from "./themeResolver";

/** Only accepts native-issued catalog entries, never author JSON as provenance. */
export function resolveCatalogEntry(entry: NativeThemeContribution): CatalogTheme {
  const context = { id: entry.id, name: entry.name, revision: entry.revision, origin: entry.origin };
  const resolved = entry.format === "v1"
    ? resolveThemeDefinition(entry.source, context)
    : resolveLegacyTheme(JSON.parse(entry.source) as Theme, context);
  if (entry.editor) {
    resolved.editor = structuredClone(entry.editor);
    resolved.theme.monacoTheme = structuredClone(entry.editor);
    registerResolvedEditorTheme(resolved.theme, resolved.editor);
  }
  return { entry, resolved };
}

export function builtinCatalog(): ResolvedThemeCatalog {
  return {
    themes: themeRegistry.getAllPresets().map((theme) => resolveCatalogEntry({
      id: theme.id, name: theme.name, revision: "builtin-v1", origin: { kind: "builtin" },
      readOnly: true, mode: theme.monacoTheme.base === "vs" ? "light" : theme.monacoTheme.base === "hc-black" ? "high-contrast" : "dark",
      format: "legacy", source: JSON.stringify(theme), available: true,
    })),
    issues: [],
  };
}

export function resolveNativeCatalog(native: NativeThemeCatalog, previous?: ResolvedThemeCatalog): ResolvedThemeCatalog {
  const themes: CatalogTheme[] = [];
  const issues = native.issues.map((message) => ({ location: "", message }));
  const ids = new Set<string>();
  for (const entry of native.themes) {
    try {
      if (ids.has(entry.id)) throw new Error("Duplicate native theme identity");
      ids.add(entry.id);
      const old = previous?.themes.find((theme) => theme.entry.id === entry.id);
      themes.push(old && old.entry.revision === entry.revision && old.entry.source === entry.source
        && JSON.stringify(old.entry.origin) === JSON.stringify(entry.origin)
        && JSON.stringify(old.entry.editor) === JSON.stringify(entry.editor) && old.entry.name === entry.name
        ? { entry, resolved: old.resolved } : resolveCatalogEntry(entry));
    } catch (error) {
      issues.push({ location: entry.id, message: String(error) });
    }
  }
  return { themes, issues };
}

/** Hydration reads preferences; it does not migrate, repair, or persist them. */
export function hydrateThemePreferences(config: Record<string, unknown>, legacy: string | null, systemDark: boolean): ThemeSettings {
  let legacyId: unknown;
  if (!config.theme && legacy) {
    try { legacyId = (JSON.parse(legacy) as { activeThemeId?: unknown }).activeThemeId; } catch { /* Ignore invalid legacy storage without changing it. */ }
  }
  return {
    ...DEFAULT_THEME_SETTINGS,
    activeThemeId: typeof config.theme === "string" && config.theme ? config.theme
      : typeof legacyId === "string" && legacyId ? legacyId : systemDark ? "tabularis-dark" : "tabularis-light",
    followSystemTheme: config.followSystemTheme === true,
    lightThemeId: typeof config.lightThemeId === "string" ? config.lightThemeId : DEFAULT_THEME_SETTINGS.lightThemeId,
    darkThemeId: typeof config.darkThemeId === "string" ? config.darkThemeId : DEFAULT_THEME_SETTINGS.darkThemeId,
  };
}

export function selectEffectiveTheme(settings: ThemeSettings, available: Theme[], systemDark: boolean, preview?: Theme): ThemeSelection {
  const requestedId = settings.followSystemTheme ? (systemDark ? settings.darkThemeId : settings.lightThemeId) : settings.activeThemeId;
  const selected = available.find((theme) => theme.id === requestedId);
  const fallback = settings.followSystemTheme ? themeRegistry.getPreset(systemDark ? "tabularis-dark" : "tabularis-light") : undefined;
  return { theme: preview ?? selected ?? fallback ?? themeRegistry.getDefault(), requestedId, missingId: selected ? undefined : requestedId, previewing: !!preview };
}
