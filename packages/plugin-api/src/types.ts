import type { ReactNode } from "react";

export interface PluginModalOptions {
  title: string;
  content: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}

export interface PluginConfig {
  interpreter?: string;
  settings?: Record<string, unknown>;
}

export interface ThemeColors {
  bg: {
    base: string;
    elevated: string;
    overlay: string;
    input: string;
    tooltip: string;
  };
  surface: {
    primary: string;
    secondary: string;
    tertiary: string;
    hover: string;
    active: string;
    disabled: string;
  };
  text: {
    primary: string;
    secondary: string;
    muted: string;
    disabled: string;
    accent: string;
    inverse: string;
  };
  accent: {
    primary: string;
    secondary: string;
    success: string;
    warning: string;
    error: string;
    info: string;
  };
  border: {
    subtle: string;
    default: string;
    strong: string;
    focus: string;
  };
  semantic: {
    string: string;
    number: string;
    boolean: string;
    date: string;
    null: string;
    primaryKey: string;
    foreignKey: string;
    index: string;
    connectionActive: string;
    connectionInactive: string;
    modified: string;
    deleted: string;
    new: string;
  };
}

export interface PluginQueryResult {
  columns: string[];
  rows: unknown[][];
}

export interface UsePluginQueryReturn {
  executeQuery: (query: string) => Promise<PluginQueryResult>;
  loading: boolean;
  error: string | null;
}

export interface UsePluginConnectionReturn {
  connectionId: string | null;
  driver: string | null;
  schema: string | null;
}

export interface UsePluginToastReturn {
  showInfo: (text: string) => Promise<void>;
  showError: (text: string) => Promise<void>;
  showWarning: (text: string) => Promise<void>;
}

export interface UsePluginSettingReturn {
  getSetting: <T = unknown>(key: string, defaultValue?: T) => T;
  setSetting: (key: string, value: unknown) => void;
  setSettings: (updates: Record<string, unknown>) => void;
}

export interface UsePluginModalReturn {
  openModal: (options: PluginModalOptions) => void;
  closeModal: () => void;
}

export interface UsePluginThemeReturn {
  themeId: string | null;
  themeName: string | null;
  isDark: boolean;
  colors: ThemeColors | null;
}

/**
 * Plugin translator: `(key, options?) => string`. Resolves against your plugin's
 * own `locales/<lang>.json` (active language → English → the key itself) and
 * interpolates placeholders from `options`. Accepts both `{{var}}` (i18next, kept
 * for backwards compatibility) and `{var}` (ICU/Lingui) syntax. Read-only.
 */
export type PluginTranslator = (key: string, options?: Record<string, unknown>) => string;

/**
 * The full host API surface injected by Tabularis at runtime as
 * `window.__TABULARIS_API__`. Plugin code should not use this directly —
 * import the named hooks/helpers from `@tabularis/plugin-api` instead.
 */
export interface TabularisHostApi {
  usePluginQuery: () => UsePluginQueryReturn;
  usePluginConnection: () => UsePluginConnectionReturn;
  usePluginToast: () => UsePluginToastReturn;
  usePluginSetting: (pluginId: string) => UsePluginSettingReturn;
  usePluginTranslation: (pluginId: string) => PluginTranslator;
  usePluginModal: () => UsePluginModalReturn;
  usePluginTheme: () => UsePluginThemeReturn;
  openUrl: (url: string) => Promise<void>;
}
