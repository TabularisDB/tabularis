import { getHost } from "./host";
import type {
  UsePluginConnectionReturn,
  UsePluginModalReturn,
  UsePluginQueryReturn,
  UsePluginSettingReturn,
  UsePluginThemeReturn,
  UsePluginToastReturn,
  PluginTranslator,
} from "./types";

/**
 * Execute read-only SQL queries against the active connection.
 * Returns `{ executeQuery, loading, error }` — `executeQuery` resolves with
 * `{ columns, rows }` or throws a plain Error with the host's error message.
 */
export function usePluginQuery(): UsePluginQueryReturn {
  return getHost().usePluginQuery();
}

/**
 * Active connection metadata. Fields are null when no connection is active.
 */
export function usePluginConnection(): UsePluginConnectionReturn {
  return getHost().usePluginConnection();
}

/**
 * Show system-level info/warning/error notifications.
 */
export function usePluginToast(): UsePluginToastReturn {
  return getHost().usePluginToast();
}

/**
 * Read and write settings owned by a specific plugin.
 * Pass your plugin id (the one declared in the `.tabularium` manifest).
 */
export function usePluginSetting(pluginId: string): UsePluginSettingReturn {
  return getHost().usePluginSetting(pluginId);
}

/**
 * Access the plugin's translations. Uses the plugin id as the i18next
 * namespace — the host registers it automatically from locales/*.json.
 */
export function usePluginTranslation(pluginId: string): PluginTranslator {
  return getHost().usePluginTranslation(pluginId);
}

/**
 * Open and close host-managed modals with custom content.
 */
export function usePluginModal(): UsePluginModalReturn {
  return getHost().usePluginModal();
}

/**
 * Current theme metadata plus the full design-token color map.
 */
export function usePluginTheme(): UsePluginThemeReturn {
  return getHost().usePluginTheme();
}

/**
 * Open a URL in the system's default browser.
 * Plugin components should use this instead of window.open for external URLs.
 */
export async function openUrl(url: string): Promise<void> {
  return getHost().openUrl(url);
}
