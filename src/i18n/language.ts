import { SUPPORTED_LANGUAGES, type AppLanguage } from "./config";

function findSupportedLanguageLabel(locale?: string): string | undefined {
  if (!locale) return undefined;
  const wanted = locale.replace("_", "-").toLowerCase();
  const exact = SUPPORTED_LANGUAGES.find(
    ({ id }) => id.toLowerCase() === wanted,
  );
  if (exact) return exact.label;
  const base = wanted.split("-")[0];
  return SUPPORTED_LANGUAGES.find(({ id }) => {
    const supported = id.toLowerCase();
    return supported === base || supported.startsWith(`${base}-`);
  })?.label;
}

export function getAiExplanationLanguage(
  language: AppLanguage,
  resolvedLanguage?: string,
): string {
  const fallBackLanguage = "English";

  if (language === "auto") {
    return findSupportedLanguageLabel(resolvedLanguage) ?? fallBackLanguage;
  }

  const supportedLanguage = SUPPORTED_LANGUAGES.find(
    ({ id }) => id === language,
  );
  return supportedLanguage?.label || fallBackLanguage;
}
