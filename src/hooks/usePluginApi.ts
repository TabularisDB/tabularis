import { useState, useCallback, useContext, useMemo } from "react";
import { message } from "@tauri-apps/plugin-dialog";
import { openUrl as openExternal } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";

import { ThemeContext } from "../contexts/ThemeContext";
import { DatabaseContext } from "../contexts/DatabaseContext";
import { SettingsContext } from "../contexts/SettingsContext";
import { PluginModalContext } from "../contexts/PluginModalContext";
import type { PluginModalOptions } from "../contexts/PluginModalContext";
import { toErrorMessage } from "../utils/errors";
import { useTabularisClient } from "./useTabularisClient";

/**
 * Hook for plugin components to execute read-only database queries.
 */
export function usePluginQuery() {
  const client = useTabularisClient();
  const dbCtx = useContext(DatabaseContext);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const executeQuery = useCallback(
    async (query: string): Promise<{ columns: string[]; rows: unknown[][] }> => {
      if (!dbCtx?.activeConnectionId) {
        throw new Error("No active connection");
      }

      setLoading(true);
      setError(null);

      try {
        const result = await client.call("execute_query", {
          connectionId: dbCtx.activeConnectionId,
          query,
          ...(dbCtx.activeSchema ? { schema: dbCtx.activeSchema } : {}),
        });
        return result;
      } catch (err) {
        const msg = toErrorMessage(err);
        setError(msg);
        throw new Error(msg);
      } finally {
        setLoading(false);
      }
    },
    [client, dbCtx?.activeConnectionId, dbCtx?.activeSchema],
  );

  return { executeQuery, loading, error };
}

/**
 * Hook for plugin components to access the active connection metadata.
 */
export function usePluginConnection() {
  const dbCtx = useContext(DatabaseContext);

  return useMemo(
    () => ({
      connectionId: dbCtx?.activeConnectionId ?? null,
      driver: dbCtx?.activeDriver ?? null,
      schema: dbCtx?.activeSchema ?? null,
    }),
    [dbCtx?.activeConnectionId, dbCtx?.activeDriver, dbCtx?.activeSchema],
  );
}

/**
 * Hook for plugin components to show notifications.
 */
export function usePluginToast() {
  const showInfo = useCallback(async (text: string) => {
    await message(text, { kind: "info" });
  }, []);

  const showError = useCallback(async (text: string) => {
    await message(text, { kind: "error" });
  }, []);

  const showWarning = useCallback(async (text: string) => {
    await message(text, { kind: "warning" });
  }, []);

  return useMemo(() => ({ showInfo, showError, showWarning }), [showInfo, showError, showWarning]);
}

/**
 * Hook for plugin components to read/write their own settings.
 */
export function usePluginSetting(pluginId: string) {
  const settingsCtx = useContext(SettingsContext);

  const pluginConfig = settingsCtx?.settings.plugins?.[pluginId];

  const getSetting = useCallback(
    <T = unknown>(key: string, defaultValue?: T): T => {
      const value = pluginConfig?.settings?.[key];
      if (value !== undefined) return value as T;
      return defaultValue as T;
    },
    [pluginConfig?.settings],
  );

  const setSetting = useCallback(
    (key: string, value: unknown) => {
      if (!settingsCtx) return;

      const currentPlugins = settingsCtx.settings.plugins ?? {};
      const currentPluginConfig = currentPlugins[pluginId] ?? {};
      const currentSettings = currentPluginConfig.settings ?? {};

      settingsCtx.updateSetting("plugins", {
        ...currentPlugins,
        [pluginId]: {
          ...currentPluginConfig,
          settings: { ...currentSettings, [key]: value },
        },
      });
    },
    [settingsCtx, pluginId],
  );

  const setSettings = useCallback(
    (updates: Record<string, unknown>) => {
      if (!settingsCtx) return;

      const currentPlugins = settingsCtx.settings.plugins ?? {};
      const currentPluginConfig = currentPlugins[pluginId] ?? {};
      const currentSettings = currentPluginConfig.settings ?? {};

      settingsCtx.updateSetting("plugins", {
        ...currentPlugins,
        [pluginId]: {
          ...currentPluginConfig,
          settings: { ...currentSettings, ...updates },
        },
      });
    },
    [settingsCtx, pluginId],
  );

  return { getSetting, setSetting, setSettings };
}

/**
 * Hook for plugin components to access their own translations.
 * Uses the plugin ID as the i18next namespace, which must be pre-loaded
 * by the Tabularis plugin loader before the component mounts.
 */
export function usePluginTranslation(pluginId: string) {
  const { t } = useTranslation(pluginId);
  return t;
}

/**
 * Opens a URL in the system's default browser.
 * Plugin components should use this instead of window.open for external URLs.
 */
export async function openUrl(url: string): Promise<void> {
  await openExternal(url);
}

/**
 * Hook for plugin components to open a modal managed by the host application.
 */
export function usePluginModal() {
  const ctx = useContext(PluginModalContext);

  const openModal = useCallback(
    (options: PluginModalOptions) => {
      ctx?.openModal(options);
    },
    [ctx],
  );

  const closeModal = useCallback(() => {
    ctx?.closeModal();
  }, [ctx]);

  return useMemo(() => ({ openModal, closeModal }), [openModal, closeModal]);
}

/**
 * Hook for plugin components to access theme information.
 */
export function usePluginTheme() {
  const themeCtx = useContext(ThemeContext);

  return useMemo(
    () => ({
      themeId: themeCtx?.currentTheme?.id ?? null,
      themeName: themeCtx?.currentTheme?.name ?? null,
      isDark: !themeCtx?.currentTheme?.id?.includes("-light"),
      colors: themeCtx?.currentTheme?.colors ?? null,
    }),
    [themeCtx?.currentTheme],
  );
}
