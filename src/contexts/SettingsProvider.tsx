import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import {
  SettingsContext,
  DEFAULT_SETTINGS,
  type Settings,
} from "./SettingsContext";
import { getFontCSS } from "../utils/settings";

const LANGUAGE_APPLICATION_TIMEOUT_MS = 3000;

type LanguageState = {
  language: Settings["language"] | null;
  ready: boolean;
  settled: boolean;
};

function matchesAppliedLanguage(
  activeLanguage: string | null | undefined,
  requestedLanguage: Settings["language"],
): boolean {
  if (requestedLanguage === "auto") {
    return true;
  }

  if (!activeLanguage) {
    return false;
  }

  return (
    activeLanguage === requestedLanguage ||
    activeLanguage.startsWith(`${requestedLanguage}-`) ||
    activeLanguage.startsWith(`${requestedLanguage}_`)
  );
}

export const SettingsProvider = ({ children }: { children: ReactNode }) => {
  const { i18n } = useTranslation();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [languageState, setLanguageState] = useState<LanguageState>({
    language: null,
    ready: false,
    settled: false,
  });
  const appliedLanguageRef = useRef<Settings["language"] | null>(null);
  const requestedLanguageRef = useRef<Settings["language"] | null>(null);
  const languageRequestIdRef = useRef(0);
  const languageQueueRef = useRef(Promise.resolve(false));

  const isLanguageApplied = useCallback((language: Settings["language"]) => {
    const activeLanguage = i18n.resolvedLanguage ?? i18n.language;
    return matchesAppliedLanguage(activeLanguage, language);
  }, [i18n.language, i18n.resolvedLanguage]);

  const queueLanguageApplication = useCallback((language: Settings["language"]) => {
    if (
      requestedLanguageRef.current === language &&
      appliedLanguageRef.current !== language
    ) {
      return languageQueueRef.current;
    }

    requestedLanguageRef.current = language;
    const requestId = ++languageRequestIdRef.current;

    languageQueueRef.current = languageQueueRef.current
      .catch(() => false)
      .then(async () => {
        if (requestId !== languageRequestIdRef.current) {
          return false;
        }

        const nextLanguage = language === "auto" ? undefined : language;

        try {
          await new Promise<void>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
              reject(new Error(
                `Language application timed out after ${LANGUAGE_APPLICATION_TIMEOUT_MS}ms`,
              ));
            }, LANGUAGE_APPLICATION_TIMEOUT_MS);

            Promise.resolve(i18n.changeLanguage(nextLanguage)).then(
              () => {
                clearTimeout(timeoutId);
                resolve();
              },
              (error) => {
                clearTimeout(timeoutId);
                reject(error);
              },
            );
          });
        } catch (error) {
          console.error("Failed to apply language:", error);

          if (requestId === languageRequestIdRef.current) {
            requestedLanguageRef.current = appliedLanguageRef.current;
          }

          return false;
        }

        if (requestId !== languageRequestIdRef.current) {
          return false;
        }

        appliedLanguageRef.current = language;
        requestedLanguageRef.current = language;
        return true;
      });

    return languageQueueRef.current;
  }, [i18n]);

  const currentLanguageApplied = isLanguageApplied(settings.language);
  const trackedLanguageState =
    languageState.language === settings.language ? languageState : null;
  const isLanguageReady =
    !isLoading && (currentLanguageApplied || trackedLanguageState?.ready === true);
  const isLanguageSettled =
    !isLoading &&
    (currentLanguageApplied || trackedLanguageState?.settled === true);

  // Load settings from backend on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const config = await invoke<Partial<Settings>>("get_config");

        // Migration logic: Check localStorage if backend is empty/default
        const savedLocal = localStorage.getItem("tabularis_settings");
        let finalSettings = { ...DEFAULT_SETTINGS };

        if (savedLocal && !config.resultPageSize && !config.language) {
          // Migration needed
          const localData = JSON.parse(savedLocal);
          finalSettings = {
            ...finalSettings,
            resultPageSize: localData.queryLimit || 500,
            language: localData.language || "auto",
          };
          // Save migrated data to backend
          await invoke("save_config", { config: finalSettings });
        } else {
          // Use backend config
          finalSettings = {
            ...DEFAULT_SETTINGS,
            ...config,
          };

          // If aiEnabled is null or undefined in config, treat it as disabled (false)
          if (config.aiEnabled === null || config.aiEnabled === undefined) {
            finalSettings.aiEnabled = false;
          }

          // Ensure resultPageSize has a valid default
          if (!finalSettings.resultPageSize || finalSettings.resultPageSize < 0) {
            finalSettings.resultPageSize = DEFAULT_SETTINGS.resultPageSize;
          }

          // Ensure erDiagramDefaultLayout has a valid default
          if (!finalSettings.erDiagramDefaultLayout) {
            finalSettings.erDiagramDefaultLayout = DEFAULT_SETTINGS.erDiagramDefaultLayout;
          }
        }

        // Smart detect AI Provider and Model if aiEnabled but provider/model not set
        if (
          finalSettings.aiEnabled &&
          (!finalSettings.aiProvider || !finalSettings.aiModel)
        ) {
          // First, detect which provider has an API key
          let detectedProvider: string | null = null;
          const hasOpenAI = await invoke<boolean>("check_ai_key", {
            provider: "openai",
          });
          if (hasOpenAI) {
            detectedProvider = "openai";
          } else {
            const hasAnthropic = await invoke<boolean>("check_ai_key", {
              provider: "anthropic",
            });
            if (hasAnthropic) {
              detectedProvider = "anthropic";
            } else {
              const hasOpenRouter = await invoke<boolean>("check_ai_key", {
                provider: "openrouter",
              });
              if (hasOpenRouter) detectedProvider = "openrouter";
            else {
              const hasMiniMax = await invoke<boolean>("check_ai_key", {
                provider: "minimax",
              });
              if (hasMiniMax) detectedProvider = "minimax";
            }
            }
          }

          if (detectedProvider) {
            // Get available models for the detected provider
            const models =
              await invoke<Record<string, string[]>>("get_ai_models");
            const providerModels = models[detectedProvider] || [];
            const firstModel = providerModels[0] || null;

            // Only set provider if not already set
            if (!finalSettings.aiProvider) {
              finalSettings.aiProvider = detectedProvider as "openai" | "anthropic" | "openrouter" | "minimax";
            }
            // Only set model if not already set AND we have a model available
            if (!finalSettings.aiModel && firstModel) {
              finalSettings.aiModel = firstModel;
            }
          }
        }

        // IMMEDIATELY apply font settings from backend config BEFORE setting state
        // This prevents flash if localStorage cache was stale
        const fontFamily = getFontCSS(finalSettings.fontFamily);
        const fontSize = finalSettings.fontSize || 14;

        // Apply immediately to override any stale cache from pre-load script
        document.documentElement.style.setProperty("--font-base", fontFamily);
        document.documentElement.style.setProperty(
          "--font-size-base",
          `${fontSize}px`,
        );
        document.body.style.fontFamily = fontFamily;
        document.body.style.fontSize = `${fontSize}px`;

        const languageAlreadyApplied = isLanguageApplied(finalSettings.language);
        if (languageAlreadyApplied) {
          appliedLanguageRef.current = finalSettings.language;
          requestedLanguageRef.current = finalSettings.language;
        }

        setSettings(finalSettings);
        setLanguageState({
          language: finalSettings.language,
          ready: languageAlreadyApplied,
          settled: languageAlreadyApplied,
        });

        if (!languageAlreadyApplied) {
          void queueLanguageApplication(finalSettings.language);
        }
      } catch (error) {
        console.error("Failed to load settings:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadSettings();
  }, []);

  // Update i18n when language changes
  useEffect(() => {
    if (isLoading || currentLanguageApplied || trackedLanguageState?.settled) {
      if (currentLanguageApplied) {
        appliedLanguageRef.current = settings.language;
        requestedLanguageRef.current = settings.language;
      }
      return;
    }

    let cancelled = false;

    const applyLanguage = async () => {
      const didApply = await queueLanguageApplication(settings.language);

      if (cancelled) return;

      setLanguageState((previous) => {
        if (previous.language !== settings.language) {
          return previous;
        }

        return {
          language: settings.language,
          ready: didApply && appliedLanguageRef.current === settings.language,
          settled: true,
        };
      });
    };

    void applyLanguage();

    return () => {
      cancelled = true;
    };
  }, [
    currentLanguageApplied,
    isLoading,
    queueLanguageApplication,
    settings.language,
    trackedLanguageState?.settled,
  ]);

  // Apply font family
  useEffect(() => {
    const fontFamily = getFontCSS(settings.fontFamily);

    // Apply to CSS variable
    document.documentElement.style.setProperty("--font-base", fontFamily);

    // ALSO apply directly to body as fallback
    document.body.style.fontFamily = fontFamily;

    // Cache for next startup
    try {
      localStorage.setItem(
        "tabularis_font_cache",
        JSON.stringify({
          fontFamily: settings.fontFamily,
          fontSize: settings.fontSize,
        }),
      );
    } catch (e) {
      console.warn("Failed to cache font settings:", e);
    }
  }, [settings.fontFamily, settings.fontSize]);

  // Apply font size
  useEffect(() => {
    const size = settings.fontSize || 14;

    // Apply to CSS variable
    document.documentElement.style.setProperty("--font-size-base", `${size}px`);

    // ALSO apply directly to body as fallback
    document.body.style.fontSize = `${size}px`;
  }, [settings.fontSize]);

  const updateSetting = <K extends keyof Settings>(
    key: K,
    value: Settings[K],
  ): Promise<void> => {
    let persistPromise = Promise.resolve();

    if (key === "language") {
      const nextLanguage = value as Settings["language"];
      const languageAlreadyApplied = isLanguageApplied(nextLanguage);

      if (languageAlreadyApplied) {
        appliedLanguageRef.current = nextLanguage;
        requestedLanguageRef.current = nextLanguage;
      }

      setLanguageState({
        language: nextLanguage,
        ready: languageAlreadyApplied,
        settled: languageAlreadyApplied,
      });
    }

    setSettings((prev) => {
      const newSettings = { ...prev, [key]: value };

      // Persist to backend
      persistPromise = invoke<void>("save_config", { config: newSettings }).catch((err) => {
        console.error("Failed to save settings:", err);
      });

      // If font setting changed, update cache immediately
      if (key === "fontFamily" || key === "fontSize") {
        try {
          localStorage.setItem(
            "tabularis_font_cache",
            JSON.stringify({
              fontFamily: newSettings.fontFamily,
              fontSize: newSettings.fontSize,
            }),
          );
        } catch (e) {
          console.warn("Failed to update font cache:", e);
        }
      }

      return newSettings;
    });

    return persistPromise;
  };

  return (
    <SettingsContext.Provider value={{
      settings,
      updateSetting,
      isLoading,
      isLanguageReady,
      isLanguageSettled,
    }}>
      {children}
    </SettingsContext.Provider>
  );
};
