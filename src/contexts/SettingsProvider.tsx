import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  SettingsContext,
  DEFAULT_SETTINGS,
  type Settings,
} from "./SettingsContext";
import { getFontCSS } from "../utils/settings";
import { dynamicActivate, SUPPORTED_LANGUAGES } from "../i18n/lingui";

// Resolve the "auto" language setting to a supported locale via the browser
// language, falling back to English.
function resolveLocale(language: string): string {
  if (language !== "auto") {
    return language;
  }
  const ids = SUPPORTED_LANGUAGES.map((l) => l.id) as readonly string[];
  const preferred = (navigator.languages ?? [navigator.language])
    .map((tag) => tag.split("-")[0])
    .find((base) => ids.includes(base));
  return preferred ?? "en";
}

export const SettingsProvider = ({ children }: { children: ReactNode }) => {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);

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

        setSettings(finalSettings);
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
    void dynamicActivate(resolveLocale(settings.language));
  }, [settings.language]);

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
    <SettingsContext.Provider value={{ settings, updateSetting, isLoading }}>
      {children}
    </SettingsContext.Provider>
  );
};
