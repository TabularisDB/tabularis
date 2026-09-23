import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { loadStartupConfig } from "../utils/startupConfig";
import { useTranslation } from "react-i18next";
import { ThemeContext } from "./ThemeContext";
import { themeRegistry } from "../themes/themeRegistry";
import { applyThemeToCSS } from "../themes/themeUtils";
import { isLinuxDesktop } from "../utils/systemTheme";
import { builtinCatalog, hydrateThemePreferences, resolveCatalogEntry, resolveNativeCatalog, selectEffectiveTheme } from "../utils/themeCatalog";
import { editThemeDefinition } from "../utils/themeDefinitionEditing";
import { getSystemIsDark, listenForSystemThemeChanges } from "../utils/themeSystemEvents";
import { resolveLegacyTheme, resolveThemeDefinition } from "../utils/themeResolver";
import { DEFAULT_THEME_SETTINGS, type Theme, type ThemeSettings, type MonacoThemeDefinition } from "../types/theme";
import type { NativeThemeCatalog, NativeThemeContribution } from "../types/themeCatalog";
import { useTabularisClient } from "../hooks/useTabularisClient";
import { detectPlatformEnvironment } from "../platform/environment";

type SettingsPatch = Partial<ThemeSettings> | ((previous: ThemeSettings) => Partial<ThemeSettings>);

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const { t } = useTranslation();
  const client = useTabularisClient();
  const [catalog, setCatalog] = useState(builtinCatalog);
  const [settings, setSettings] = useState(DEFAULT_THEME_SETTINGS);
  const [systemDark, setSystemDark] = useState(true);
  const [preview, setPreview] = useState<Theme>();
  const [isLoading, setIsLoading] = useState(true);
  const catalogRef = useRef(catalog);
  const settingsRef = useRef(settings);
  const catalogRequest = useRef({ version: 0 });
  const previewRevision = useRef(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());

  const refreshCatalog = useCallback(async () => {
    const request = ++catalogRequest.current.version;
    const native = await invoke<NativeThemeCatalog>("get_theme_catalog");
    const resolved = resolveNativeCatalog(native, catalogRef.current);
    if (request === catalogRequest.current.version) { catalogRef.current = resolved; setCatalog(resolved); }
    return resolved;
  }, []);

  useEffect(() => {
    let disposed = false;
    const requests = catalogRequest.current;
    let stopCatalog: (() => void) | undefined;
    // Subscribe before reading. Out-of-order reads cannot undo a later refresh.
    void listen("theme-catalog-changed", () => {
      if (!disposed) void refreshCatalog().catch((error) => console.error("Failed to refresh themes:", error));
    }).then((stop) => { if (disposed) stop(); else stopCatalog = stop; }).catch((error) => console.error("Failed to subscribe to theme changes:", error));
    void (async () => {
      try {
        const startup = Promise.all([loadStartupConfig(client), getSystemIsDark()]);
        const catalogReady = refreshCatalog().catch((error) => console.error("Failed to load theme catalog:", error));
        const [config, dark] = await startup;
        if (disposed) return;
        const hydrated = hydrateThemePreferences(config, localStorage.getItem("tabularis_theme_settings"), dark);
        // Apply known builtin colors without waiting for package disk reads.
        // Selection and persistence remain governed by the complete catalog.
        const startupThemeId = hydrated.followSystemTheme
          ? dark ? hydrated.darkThemeId : hydrated.lightThemeId
          : hydrated.activeThemeId;
        const preset = themeRegistry.getPreset(startupThemeId);
        if (preset) applyThemeToCSS(preset);
        await catalogReady;
        if (disposed) return;
        settingsRef.current = hydrated;
        setSettings(hydrated);
        setSystemDark(dark);
      } catch (error) { console.error("Failed to load themes:", error); }
      finally { if (!disposed) setIsLoading(false); }
    })();
    return () => { disposed = true; ++requests.version; stopCatalog?.(); };
  }, [client, refreshCatalog]);

  useEffect(() => {
    if (!settings.followSystemTheme) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void listenForSystemThemeChanges((dark) => { if (!disposed) setSystemDark(dark); }).then((unsubscribe) => {
      if (disposed) unsubscribe(); else stop = unsubscribe;
    });
    return () => { disposed = true; stop?.(); };
  }, [settings.followSystemTheme]);

  const allThemes = useMemo(() => catalog.themes.filter(({ entry }) => entry.available).map(({ resolved }) => resolved.theme), [catalog]);
  const selection = useMemo(() => selectEffectiveTheme(settings, allThemes, systemDark, preview), [settings, allThemes, systemDark, preview]);
  const currentTheme = selection.theme;

  useEffect(() => {
    if (isLoading) return;
    applyThemeToCSS(currentTheme);
    // Native window chrome only exists in the desktop host.
    if (detectPlatformEnvironment() !== "tauri") return;
    getCurrentWindow().setTheme(settings.followSystemTheme && !preview && !isLinuxDesktop() ? null : themeRegistry.isDarkTheme(currentTheme) ? "dark" : "light")
      .catch((error) => console.error("Failed to set window theme:", error));
  }, [currentTheme, isLoading, settings.followSystemTheme, preview]);

  // Persistence only follows explicit user actions, never hydration, system
  // changes, preview, package refresh, or missing-package fallback.
  const updateSettings = useCallback(async (patch: SettingsPatch) => {
    if (isLoading) throw new Error("Theme preferences are still loading");
    const previewAtRequest = previewRevision.current;
    const task = saveQueue.current.catch(() => undefined).then(async () => {
      const previous = settingsRef.current;
      const merged = { ...previous, ...(typeof patch === "function" ? patch(previous) : patch) };
      await client.call("save_config", { config: { theme: merged.activeThemeId, followSystemTheme: merged.followSystemTheme, lightThemeId: merged.lightThemeId, darkThemeId: merged.darkThemeId } });
      settingsRef.current = merged;
      setSettings(merged);
      try { localStorage.removeItem("tabularis_theme_settings"); }
      catch (error) { console.warn("Theme preference saved; legacy browser storage cleanup failed:", error); }
      if (previewAtRequest === previewRevision.current) setPreview(undefined);
    });
    saveQueue.current = task;
    return task;
  }, [client, isLoading]);

  const setTheme = useCallback(async (themeId: string) => {
    if (isLoading) throw new Error("Theme preferences are still loading");
    if (!catalogRef.current.themes.some(({ entry }) => entry.id === themeId && entry.available)) throw new Error(`Theme ${themeId} is unavailable`);
    await updateSettings({ activeThemeId: themeId, followSystemTheme: false });
  }, [isLoading, updateSettings]);

  const previewTheme = useCallback((theme: string | NativeThemeContribution) => {
    const resolved = typeof theme === "string" ? catalogRef.current.themes.find(({ entry }) => entry.id === theme && entry.available) : resolveCatalogEntry(theme);
    if (!resolved) throw new Error("Theme is unavailable");
    ++previewRevision.current;
    setPreview(resolved.resolved.theme);
  }, []);

  const previewDefinition = useCallback((source: string, name: string) => {
    const resolved = resolveThemeDefinition(source, { id: "theme:preview-definition", name, revision: source, origin: { kind: "personal" } });
    ++previewRevision.current;
    setPreview(resolved.theme);
  }, []);

  const cancelPreview = useCallback(() => { ++previewRevision.current; setPreview(undefined); }, []);

  const refreshAfterCommit = useCallback(async () => {
    const request = catalogRequest.current.version + 1;
    try { await refreshCatalog(); }
    catch (error) {
      // The native write already committed. Do not report it as a failed
      // creation and tempt the caller to retry with another personal identity.
      console.warn("Theme change committed; catalog refresh failed:", error);
      if (request === catalogRequest.current.version) {
        const previous = catalogRef.current;
        const next = { ...previous, issues: [...previous.issues, { location: "", message: `Theme change committed; refresh failed: ${String(error)}` }] };
        catalogRef.current = next;
        setCatalog(next);
      }
    }
  }, [refreshCatalog]);

  const duplicateTheme = useCallback(async (themeId: string, newName: string): Promise<Theme> => {
    const base = catalogRef.current.themes.find(({ entry }) => entry.id === themeId && entry.available);
    if (!base) throw new Error("Theme is unavailable");
    const entry = await invoke<NativeThemeContribution>("duplicate_personal_theme", { themeId, name: newName, editor: base.entry.format === "legacy" ? base.resolved.editor : null });
    await refreshAfterCommit();
    return resolveCatalogEntry(entry).resolved.theme;
  }, [refreshAfterCommit]);
  const createCustomTheme = duplicateTheme;

  const updatePersonalSource = useCallback(async (themeId: string, name: string, source: string, expectedRevision?: string, editor?: MonacoThemeDefinition): Promise<Theme> => {
    const previous = catalogRef.current.themes.find(({ entry }) => entry.id === themeId);
    if (!previous || previous.entry.origin.kind !== "personal") throw new Error("Theme is not an editable personal definition");
    const snapshot = previous.entry.format === "legacy" && !!previous.entry.editor;
    if (previous.entry.format !== "v1" && (!snapshot || !editor)) throw new Error("An independent snapshot requires its exact editor definition");
    const request = { themeId, name, source, expectedRevision: expectedRevision ?? previous.entry.revision };
    const entry = snapshot
      ? await invoke<NativeThemeContribution>("update_personal_snapshot", { ...request, editor })
      : await invoke<NativeThemeContribution>("update_personal_theme", request);
    await refreshAfterCommit();
    return resolveCatalogEntry(entry).resolved.theme;
  }, [refreshAfterCommit]);

  const updateCustomTheme = useCallback(async (theme: Theme) => {
    const previous = catalogRef.current.themes.find(({ entry }) => entry.id === theme.id);
    if (!previous || previous.entry.origin.kind !== "personal") throw new Error("Cannot modify preset or installed themes");
    if (previous.entry.format === "v1") {
      await updatePersonalSource(theme.id, theme.name, editThemeDefinition(previous.entry.source, previous.resolved.theme, theme));
    } else {
      await client.call("save_custom_theme", { theme });
      await refreshAfterCommit();
    }
  }, [client, refreshAfterCommit, updatePersonalSource]);

  const deleteCustomTheme = useCallback(async (themeId: string) => {
    const previous = catalogRef.current.themes.find(({ entry }) => entry.id === themeId);
    if (!previous || previous.entry.origin.kind !== "personal") throw new Error("Cannot delete preset or installed themes");
    await client.call("delete_custom_theme", { themeId });
    await refreshAfterCommit();
    // Preserve the explicit legacy personal-delete behavior. Package removal
    // does NOT use this operation and never changes the user's saved choices.
    try {
      await updateSettings((value) => ({ activeThemeId: value.activeThemeId === themeId ? "tabularis-dark" : value.activeThemeId,
        lightThemeId: value.lightThemeId === themeId ? "tabularis-light" : value.lightThemeId,
        darkThemeId: value.darkThemeId === themeId ? "tabularis-dark" : value.darkThemeId }));
    } catch (error) {
      const previous = catalogRef.current;
      const next = { ...previous, issues: [...previous.issues, { location: themeId, message: `Personal theme deleted; preference update failed: ${String(error)}` }] };
      catalogRef.current = next; setCatalog(next);
    }
  }, [client, refreshAfterCommit, updateSettings]);

  const importTheme = useCallback(async (themeJson: string, name?: string): Promise<Theme> => {
    const parsed: unknown = JSON.parse(themeJson);
    if (parsed && typeof parsed === "object" && "themeSnapshotVersion" in parsed && !("colors" in parsed)) {
      const entry = await invoke<NativeThemeContribution>("create_personal_snapshot", { name: name ?? t("themePackages.importedTheme"), source: themeJson });
      await refreshAfterCommit();
      return resolveCatalogEntry(entry).resolved.theme;
    }
    // monacoTheme is required by the legacy format; its schemaVersion may be opaque metadata.
    if (parsed && typeof parsed === "object" && "schemaVersion" in parsed && !("monacoTheme" in parsed)) {
      const entry = await invoke<NativeThemeContribution>("create_personal_theme", { name: name ?? t("themePackages.importedTheme"), source: themeJson });
      await refreshAfterCommit();
      return resolveCatalogEntry(entry).resolved.theme;
    }
    const legacy = await invoke<Theme>("import_theme", name === undefined ? { themeJson } : { themeJson, name });
    await refreshAfterCommit();
    const imported = catalogRef.current.themes.find(({ entry }) => entry.id === legacy.id);
    // This fallback is only the returned runtime object, never the raw export
    // source or persisted data. A later refresh reads original native bytes.
    return imported?.resolved.theme ?? resolveLegacyTheme(legacy, { id: legacy.id, name: legacy.name, revision: "native-commit", origin: { kind: "personal" } }).theme;
  }, [refreshAfterCommit, t]);

  const exportTheme = useCallback(async (themeId: string): Promise<string> => {
    const theme = catalogRef.current.themes.find(({ entry }) => entry.id === themeId);
    if (!theme) throw new Error("Theme is unavailable");
    if (theme.entry.origin.kind === "personal") return invoke<string>("export_theme", { themeId });
    return theme.entry.source;
  }, []);

  const value = useMemo(() => ({ currentTheme, settings, allThemes, isLoading, catalog, selection, setTheme, createCustomTheme,
    updateCustomTheme, deleteCustomTheme, duplicateTheme, importTheme, exportTheme, updateSettings, refreshCatalog,
    previewTheme, previewDefinition, cancelPreview, updatePersonalSource }),
  [currentTheme, settings, allThemes, isLoading, catalog, selection, setTheme, createCustomTheme, updateCustomTheme,
    deleteCustomTheme, duplicateTheme, importTheme, exportTheme, updateSettings, refreshCatalog, previewTheme, previewDefinition, cancelPreview, updatePersonalSource]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};
