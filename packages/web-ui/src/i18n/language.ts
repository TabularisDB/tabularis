import { SUPPORTED_LANGUAGES, type AppLanguage } from "./config";

export function getAiExplanationLanguage(language: AppLanguage): string {
  const fallBackLanguage = "English";

  if (language === "auto") {
    return fallBackLanguage;
  }

  const supportedLanguage = SUPPORTED_LANGUAGES.find(
    ({ id }) => id === language,
  );
  return supportedLanguage?.label || fallBackLanguage;
}
