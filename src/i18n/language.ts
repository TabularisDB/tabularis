import { SUPPORTED_LANGUAGES, type AppLanguage } from "./config";

type SupportedLanguageId = (typeof SUPPORTED_LANGUAGES)[number]["id"];

const DEFAULT_LANGUAGE: SupportedLanguageId = "en";

function findSupportedLanguageId(
  locale?: string,
): SupportedLanguageId | undefined {
  if (!locale) return undefined;
  const wanted = locale.replace("_", "-").toLowerCase();
  const exact = SUPPORTED_LANGUAGES.find(
    ({ id }) => id.toLowerCase() === wanted,
  );
  if (exact) return exact.id;
  const base = wanted.split("-")[0];
  return SUPPORTED_LANGUAGES.find(({ id }) => {
    const supported = id.toLowerCase();
    return supported === base || supported.startsWith(`${base}-`);
  })?.id;
}

function findSupportedLanguageLabel(locale?: string): string | undefined {
  const id = findSupportedLanguageId(locale);
  return SUPPORTED_LANGUAGES.find((language) => language.id === id)?.label;
}

export function resolveAutoLanguage(
  locales?: readonly (string | undefined | null)[] | string | null,
): SupportedLanguageId {
  const candidates =
    typeof locales === "string" ? [locales] : locales ?? [];
  for (const locale of candidates) {
    const id = findSupportedLanguageId(locale ?? undefined);
    if (id) return id;
  }
  return DEFAULT_LANGUAGE;
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
