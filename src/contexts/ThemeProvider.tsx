import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ThemeContext } from "./ThemeContext";
import { themeRegistry } from "../themes/themeRegistry";
import { applyThemeToCSS } from "../themes/themeUtils";
import { getSystemThemeId, resolveActiveThemeId } from "../utils/themeManagement";
import type { Theme, ThemeSettings } from "../types/theme";

const DEFAULT_THEME_SETTINGS: ThemeSettings = {
  activeThemeId: "tabularis-dark",
  followSystemTheme: false,
  lightThemeId: "tabularis-light",
  darkThemeId: "tabularis-dark",
  customThemes: [],
};

interface AppConfig {
  theme?: string;
  followSystemTheme?: boolean;
  lightThemeId?: string;
  darkThemeId?: string;
  language?: string;
  resultPageSize?: number;
  fontFamily?: string;
  fontSize?: number;
  aiEnabled?: boolean;
  aiProvider?: string;
  aiModel?: string;
  aiCustomModels?: Record<string, string[]>;
}

const getSystemIsDark = async (): Promise<boolean> => {
  try {
    const nativeTheme = await getCurrentWindow().theme();
    if (nativeTheme) return nativeTheme === "dark";
  } catch {
    // Browser previews do not expose the native Tauri window API.
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches;
};

const listenForSystemThemeChanges = async (
  onChange: (isDark: boolean) => void,
): Promise<() => void> => {
  try {
    return await getCurrentWindow().onThemeChanged(({ payload }) => {
      onChange(payload === "dark");
    });
  } catch {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => {
      onChange(event.matches);
    };
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }
};

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [currentTheme, setCurrentTheme] = useState<Theme>(() =>
    themeRegistry.getDefault(),
  );
  const [settings, setSettings] = useState<ThemeSettings>(
    DEFAULT_THEME_SETTINGS,
  );
  const [customThemes, setCustomThemes] = useState<Theme[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Combine all themes
  const allThemes = useMemo(() => {
    const presets = themeRegistry.getAllPresets();
    return [...presets, ...customThemes];
  }, [customThemes]);

  // Load theme settings and custom themes on mount
  useEffect(() => {
    const loadThemes = async () => {
      try {
        // Load theme from backend config
        const config = await invoke<AppConfig>("get_config");

        // Migration: check localStorage for old theme settings
        const oldLocalSettings = localStorage.getItem(
          "tabularis_theme_settings",
        );
        let activeThemeId = config.theme;

        if (oldLocalSettings && !config.theme) {
          // Migrate from localStorage to config.json
          try {
            const oldSettings = JSON.parse(oldLocalSettings);
            activeThemeId = oldSettings.activeThemeId;

            // Save to backend
            await invoke("save_config", {
              config: { ...config, theme: activeThemeId },
            });

            // Clean up old localStorage
            localStorage.removeItem("tabularis_theme_settings");
          } catch (e) {
            console.error("Failed to migrate theme settings:", e);
          }
        }

        // If still no theme, detect from system preferences
        if (!activeThemeId) {
          const prefersDark = await getSystemIsDark();
          activeThemeId = prefersDark ? "tabularis-dark" : "tabularis-light";

          // Save the detected theme
          await invoke("save_config", {
            config: { ...config, theme: activeThemeId },
          });
        }

        // Load custom themes from backend
        const loadedCustomThemes = await invoke<Theme[]>(
          "get_all_themes",
        ).catch(() => [] as Theme[]);
        setCustomThemes(loadedCustomThemes.filter((t) => !t.isPreset));

        // Hydrate follow-system settings (absent ⇒ static mode)
        const followSystemTheme = config.followSystemTheme ?? false;
        const lightThemeId = config.lightThemeId ?? "tabularis-light";
        const darkThemeId = config.darkThemeId ?? "tabularis-dark";

        // Resolve active theme: follow-system overrides config.theme
        let systemIsDark: boolean | undefined;
        if (followSystemTheme) {
          systemIsDark = await getSystemIsDark();
          activeThemeId = resolveActiveThemeId(
            {
              ...DEFAULT_THEME_SETTINGS,
              activeThemeId: activeThemeId ?? "tabularis-dark",
              followSystemTheme,
              lightThemeId,
              darkThemeId,
            },
            systemIsDark,
          );
        }

        // Set initial theme; follow-system falls back to the preset matching
        // the OS mode, static mode keeps the registry default
        const allAvailableThemes = [
          ...themeRegistry.getAllPresets(),
          ...loadedCustomThemes,
        ];
        const initialTheme =
          allAvailableThemes.find((t) => t.id === activeThemeId) ||
          (followSystemTheme
            ? themeRegistry.getPreset(
                systemIsDark ? "tabularis-dark" : "tabularis-light",
              )
            : undefined) ||
          themeRegistry.getDefault();

        setCurrentTheme(initialTheme);
        setSettings({
          ...DEFAULT_THEME_SETTINGS,
          activeThemeId: initialTheme.id,
          followSystemTheme,
          lightThemeId,
          darkThemeId,
        });
      } catch (error) {
        console.error("Failed to load themes:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadThemes();
  }, []);

  // Apply theme to CSS when currentTheme changes
  useEffect(() => {
    if (!isLoading && currentTheme) {
      applyThemeToCSS(currentTheme);
      const windowTheme = themeRegistry.isDarkTheme(currentTheme)
        ? "dark"
        : "light";
      getCurrentWindow()
        .setTheme(settings.followSystemTheme ? null : windowTheme)
        .catch((error) =>
          console.error("Failed to set window theme:", error),
        );
    }
  }, [currentTheme, isLoading, settings.followSystemTheme]);

  // Save theme to config.json when it changes (not on initial load)
  useEffect(() => {
    if (!isLoading && currentTheme) {
      invoke("save_config", {
        config: { theme: currentTheme.id },
      }).catch((error) => {
        console.error("Failed to save theme to config:", error);
      });
    }
  }, [currentTheme, isLoading]);

  // Optional: Listen for system theme changes and auto-switch if using system theme
  useEffect(() => {
    if (!settings.followSystemTheme) return;

    let disposed = false;
    let stopListening: (() => void) | undefined;
    const handleChange = (isDark: boolean) => {
      const newThemeId = getSystemThemeId(isDark, settings);
      const newTheme =
        allThemes.find((t) => t.id === newThemeId) ||
        themeRegistry.getPreset(
          isDark ? "tabularis-dark" : "tabularis-light",
        );
      if (newTheme) {
        setCurrentTheme(newTheme);
        setSettings((prev) => ({ ...prev, activeThemeId: newTheme.id }));
      }
    };

    void listenForSystemThemeChanges(handleChange).then((unlisten) => {
      if (disposed) {
        unlisten();
      } else {
        stopListening = unlisten;
      }
    });

    return () => {
      disposed = true;
      stopListening?.();
    };
  }, [settings, allThemes]);

  const setTheme = useCallback(
    async (themeId: string) => {
      const theme = allThemes.find((t) => t.id === themeId);
      if (!theme) {
        throw new Error(`Theme ${themeId} not found`);
      }

      setCurrentTheme(theme);
      setSettings((prev) => ({ ...prev, activeThemeId: themeId }));
    },
    [allThemes],
  );

  const createCustomTheme = useCallback(
    async (baseThemeId: string, name: string): Promise<Theme> => {
      const baseTheme = allThemes.find((t) => t.id === baseThemeId);
      if (!baseTheme) {
        throw new Error("Base theme not found");
      }

      const newTheme: Theme = {
        ...baseTheme,
        id: `custom-${Date.now()}`,
        name,
        isPreset: false,
        isReadOnly: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await invoke("save_custom_theme", { theme: newTheme });

      setCustomThemes((prev) => [...prev, newTheme]);
      setSettings((prev) => ({
        ...prev,
        customThemes: [...prev.customThemes, newTheme.id],
      }));

      return newTheme;
    },
    [allThemes],
  );

  const updateCustomTheme = useCallback(
    async (theme: Theme) => {
      if (theme.isPreset) {
        throw new Error("Cannot modify preset themes");
      }

      const updatedTheme: Theme = {
        ...theme,
        updatedAt: new Date().toISOString(),
      };

      await invoke("save_custom_theme", { theme: updatedTheme });

      setCustomThemes((prev) =>
        prev.map((t) => (t.id === updatedTheme.id ? updatedTheme : t)),
      );

      // Update current theme if it's the one being edited
      if (currentTheme.id === updatedTheme.id) {
        setCurrentTheme(updatedTheme);
      }
    },
    [currentTheme.id],
  );

  const deleteCustomTheme = useCallback(
    async (themeId: string) => {
      const theme = allThemes.find((t) => t.id === themeId);
      if (!theme || theme.isPreset) {
        throw new Error("Cannot delete preset themes");
      }

      await invoke("delete_custom_theme", { themeId });

      setCustomThemes((prev) => prev.filter((t) => t.id !== themeId));
      setSettings((prev) => ({
        ...prev,
        customThemes: prev.customThemes.filter((id) => id !== themeId),
      }));

      // Reset per-mode picks that referenced the deleted theme.
      // Compute from current state and persist outside the updater so
      // StrictMode double-invocation cannot fire save_config twice.
      const lightThemeId =
        settings.lightThemeId === themeId
          ? "tabularis-light"
          : settings.lightThemeId;
      const darkThemeId =
        settings.darkThemeId === themeId
          ? "tabularis-dark"
          : settings.darkThemeId;
      if (
        lightThemeId !== settings.lightThemeId ||
        darkThemeId !== settings.darkThemeId
      ) {
        invoke("save_config", {
          config: { lightThemeId, darkThemeId },
        }).catch((error) =>
          console.error("Failed to reset per-mode theme picks:", error),
        );
        setSettings((prev) => ({ ...prev, lightThemeId, darkThemeId }));
      }

      // Active branch: in follow-system mode, resolve through the current OS
      // mode and the just-reset per-mode picks (same fallback chain as the
      // listener and load path). Static mode keeps the registry default.
      if (currentTheme.id === themeId) {
        let replacement: Theme;
        if (settings.followSystemTheme) {
          const systemIsDark = await getSystemIsDark();
          const targetId = getSystemThemeId(systemIsDark, {
            ...settings,
            lightThemeId,
            darkThemeId,
          });
          replacement =
            allThemes.find((t) => t.id === targetId) ||
            themeRegistry.getPreset(
              systemIsDark ? "tabularis-dark" : "tabularis-light",
            ) ||
            themeRegistry.getDefault();
        } else {
          replacement = themeRegistry.getDefault();
        }
        setCurrentTheme(replacement);
        setSettings((prev) => ({ ...prev, activeThemeId: replacement.id }));
      }
    },
    [allThemes, currentTheme.id, settings],
  );

  const duplicateTheme = useCallback(
    async (themeId: string, newName: string): Promise<Theme> => {
      const baseTheme = allThemes.find((t) => t.id === themeId);
      if (!baseTheme) {
        throw new Error("Theme not found");
      }

      const duplicatedTheme: Theme = {
        ...baseTheme,
        id: `custom-${Date.now()}`,
        name: newName,
        isPreset: false,
        isReadOnly: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await invoke("save_custom_theme", { theme: duplicatedTheme });

      setCustomThemes((prev) => [...prev, duplicatedTheme]);
      setSettings((prev) => ({
        ...prev,
        customThemes: [...prev.customThemes, duplicatedTheme.id],
      }));

      return duplicatedTheme;
    },
    [allThemes],
  );

  const importTheme = useCallback(async (themeJson: string): Promise<Theme> => {
    let importedTheme: Theme;
    try {
      importedTheme = JSON.parse(themeJson) as Theme;
    } catch (e) {
      throw new Error(`Invalid theme JSON: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Ensure it's marked as custom
    const customTheme: Theme = {
      ...importedTheme,
      id: `custom-${Date.now()}`,
      isPreset: false,
      isReadOnly: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await invoke("save_custom_theme", { theme: customTheme });

    setCustomThemes((prev) => [...prev, customTheme]);
    setSettings((prev) => ({
      ...prev,
      customThemes: [...prev.customThemes, customTheme.id],
    }));

    return customTheme;
  }, []);

  const exportTheme = useCallback(
    async (themeId: string): Promise<string> => {
      const theme = allThemes.find((t) => t.id === themeId);
      if (!theme) {
        throw new Error("Theme not found");
      }

      return JSON.stringify(theme, null, 2);
    },
    [allThemes],
  );

  const updateSettings = useCallback(
    async (newSettings: Partial<ThemeSettings>) => {
      const merged = { ...settings, ...newSettings };
      setSettings(merged);

      await invoke("save_config", {
        config: {
          followSystemTheme: merged.followSystemTheme,
          lightThemeId: merged.lightThemeId,
          darkThemeId: merged.darkThemeId,
        },
      }).catch((error) => {
        console.error("Failed to save theme settings:", error);
      });

      // Follow-system on: immediately apply the theme for the current OS mode
      if (merged.followSystemTheme) {
        const systemIsDark = await getSystemIsDark();
        const targetId = getSystemThemeId(systemIsDark, merged);
        const target =
          allThemes.find((t) => t.id === targetId) ||
          themeRegistry.getPreset(
            systemIsDark ? "tabularis-dark" : "tabularis-light",
          );
        if (target && target.id !== currentTheme.id) {
          setCurrentTheme(target);
          setSettings((prev) => ({ ...prev, activeThemeId: target.id }));
        }
      }
    },
    [settings, allThemes, currentTheme.id],
  );

  const value = useMemo(
    () => ({
      currentTheme,
      settings,
      allThemes,
      isLoading,
      setTheme,
      createCustomTheme,
      updateCustomTheme,
      deleteCustomTheme,
      duplicateTheme,
      importTheme,
      exportTheme,
      updateSettings,
    }),
    [
      currentTheme,
      settings,
      allThemes,
      isLoading,
      setTheme,
      createCustomTheme,
      updateCustomTheme,
      deleteCustomTheme,
      duplicateTheme,
      importTheme,
      exportTheme,
      updateSettings,
    ],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
};
