/**
 * Locales the Tabularium registry serves README translations in
 * (`GET /api/i18n/` → `enabledLocales`). The registry resolves fallbacks
 * itself, but we only ask for locales it understands so the request stays
 * deterministic across registry versions.
 */
const REGISTRY_LOCALES = ["en", "de", "es", "fr", "it", "zh-CN"];

/**
 * Map the app UI language (e.g. "it", "pt-BR", "zh") to the closest locale
 * the Tabularium registry can serve. Languages the registry doesn't know
 * fall back to English.
 */
export function toRegistryLocale(appLanguage: string | undefined): string {
  if (!appLanguage) return "en";
  const wanted = appLanguage.toLowerCase();
  const exact = REGISTRY_LOCALES.find((l) => l.toLowerCase() === wanted);
  if (exact) return exact;
  const base = wanted.split("-")[0];
  const match = REGISTRY_LOCALES.find(
    (l) => l.toLowerCase() === base || l.toLowerCase().startsWith(`${base}-`),
  );
  return match ?? "en";
}
