import { invoke } from "@tauri-apps/api/core";

/**
 * Plugin translations are kept in a self-contained, i18next-compatible store —
 * deliberately NOT routed through Lingui. This preserves the public plugin API
 * contract (`PluginTranslator`, BC since the i18next era): short keys scoped per
 * plugin (so two plugins may both ship "greeting"), `{{var}}` interpolation, and
 * "return the key on miss". Plugin bundles are pre-built and never see the Lingui
 * macro, so they rely on this runtime behaviour rather than the host catalog.
 */

// pluginId -> lang -> (key -> translated string)
const store = new Map<string, Map<string, Record<string, string>>>();
// `${pluginId}:${lang}` we've already tried to load (success or not), so we don't refetch.
const attempted = new Set<string>();

/** Load a plugin's locale bundle (current language + English fallback) into the store. */
export async function loadPluginTranslations(pluginId: string, locale: string): Promise<void> {
  const langs = Array.from(new Set([locale?.split("-")[0], "en"])).filter(Boolean) as string[];
  for (const lang of langs) {
    const cacheKey = `${pluginId}:${lang}`;
    if (attempted.has(cacheKey)) continue;
    attempted.add(cacheKey);
    try {
      const raw = await invoke<string>("read_plugin_file", {
        pluginId,
        filePath: `locales/${lang}.json`,
      });
      const translations = JSON.parse(raw) as Record<string, string>;
      if (!store.has(pluginId)) store.set(pluginId, new Map());
      store.get(pluginId)!.set(lang, translations);
    } catch {
      // Locale file absent or invalid — silently skip (English/key fallback applies).
    }
  }
}

/**
 * i18next-compatible lookup: current language → English fallback → the key itself.
 * Interpolates both `{{var}}` (i18next, BC for existing plugins) and `{var}` (ICU,
 * so new authors can write Lingui/ICU-style placeholders) from `options`.
 */
export function translatePlugin(
  pluginId: string,
  locale: string,
  key: string,
  options?: Record<string, unknown>,
): string {
  const lang = locale?.split("-")[0] ?? "en";
  const byLang = store.get(pluginId);
  const raw = byLang?.get(lang)?.[key] ?? byLang?.get("en")?.[key] ?? key;
  if (!options) return raw;
  return raw
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (m, name) => (name in options ? String(options[name]) : m))
    .replace(/\{\s*(\w+)\s*\}/g, (m, name) => (name in options ? String(options[name]) : m));
}
