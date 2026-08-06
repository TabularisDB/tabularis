import type {
  Settings,
  AppLanguage,
  AiProvider,
} from "../contexts/SettingsContext";

export const FONT_MAP: Record<string, string> = {
  System:
    "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Ubuntu, sans-serif",
  "Open Sans": "Open Sans, system-ui, sans-serif",
  Roboto: "Roboto, RobotoDraft, Helvetica, Arial, sans-serif",
  "JetBrains Mono": "JetBrains Mono, Menlo, Monaco, Consolas, monospace",
  "JetBrains Mono ExtraBold":
    "JetBrains Mono ExtraBold, JetBrains Mono, Menlo, Monaco, Consolas, monospace",
  "JetBrains Mono ExtraBold Italic":
    "JetBrains Mono ExtraBold Italic, JetBrains Mono ExtraBold, JetBrains Mono, Menlo, Monaco, Consolas, monospace",
  Hack: "Hack, Menlo, Monaco, Consolas, monospace",
  Menlo: "Menlo, Monaco, Consolas, monospace",
  "DejaVu Sans Mono": "DejaVu Sans Mono, Menlo, Monaco, Consolas, monospace",
};

export const DEFAULT_FONT_SIZE = 14;
export const DEFAULT_FONT_FAMILY = "System";
export const FONT_CACHE_KEY = "tabularis_font_cache";
export const OLD_SETTINGS_KEY = "tabularis_settings";

export interface FontCache {
  fontFamily: string;
  fontSize: number;
}

export interface MigrationResult {
  settings: Partial<Settings>;
  migrated: boolean;
}

export function getFontCSS(fontFamily: string): string {
  return FONT_MAP[fontFamily] || fontFamily || FONT_MAP["System"];
}

export function createFontCSSVariables(
  fontFamily: string,
  fontSize: number,
): Record<string, string> {
  return {
    "--font-base": getFontCSS(fontFamily),
    "--font-size-base": `${fontSize || DEFAULT_FONT_SIZE}px`,
  };
}

export function loadFontCache(): FontCache | null {
  try {
    const cached = localStorage.getItem(FONT_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached) as FontCache;
    }
  } catch (e) {
    console.warn("Failed to load font cache:", e);
  }
  return null;
}

export function saveFontCache(fontFamily: string, fontSize: number): void {
  try {
    localStorage.setItem(
      FONT_CACHE_KEY,
      JSON.stringify({ fontFamily, fontSize }),
    );
  } catch (e) {
    console.warn("Failed to save font cache:", e);
  }
}

export function migrateFromLocalStorage(
  backendConfig: Partial<Settings>,
): MigrationResult {
  // Check if migration is needed (backend is empty/default)
  const needsMigration =
    !backendConfig.resultPageSize && !backendConfig.language;

  if (!needsMigration) {
    return { settings: backendConfig, migrated: false };
  }

  try {
    const savedLocal = localStorage.getItem(OLD_SETTINGS_KEY);
    if (!savedLocal) {
      return { settings: backendConfig, migrated: false };
    }

    const localData = JSON.parse(savedLocal);
    const migratedSettings: Partial<Settings> = {
      resultPageSize: localData.queryLimit || 500,
      language: localData.language || "auto",
    };

    return { settings: migratedSettings, migrated: true };
  } catch (e) {
    console.error("Failed to migrate settings from localStorage:", e);
    return { settings: backendConfig, migrated: false };
  }
}

export function mergeSettings(
  defaults: Settings,
  backendConfig: Partial<Settings>,
  migratedSettings: Partial<Settings>,
  wasMigrated: boolean,
): Settings {
  const baseSettings = wasMigrated ? migratedSettings : backendConfig;

  const merged: Settings = {
    ...defaults,
    ...baseSettings,
  };

  // Ensure aiEnabled is boolean (not null/undefined)
  // When no config is provided (empty object), use default value
  if (baseSettings.aiEnabled === null || baseSettings.aiEnabled === undefined) {
    merged.aiEnabled = defaults.aiEnabled;
  }

  return merged;
}

export interface DetectedAIConfig {
  provider: AiProvider | null;
  model: string | null;
}

export function detectAIProviderFromKeys(
  keyStatus: Record<AiProvider, boolean>,
  availableModels: Record<string, string[]>,
): DetectedAIConfig {
  const providers: AiProvider[] = ["openai", "anthropic", "openrouter", "minimax"];

  for (const provider of providers) {
    if (keyStatus[provider]) {
      const models = availableModels[provider] || [];
      return {
        provider,
        model: models[0] || null,
      };
    }
  }

  return { provider: null, model: null };
}

export function shouldDetectAIProvider(settings: Settings): boolean {
  return settings.aiEnabled && (!settings.aiProvider || !settings.aiModel);
}

export function applyFontToDocument(
  fontFamily: string,
  fontSize: number,
): void {
  if (typeof document === "undefined") return;

  const cssFont = getFontCSS(fontFamily);
  const size = fontSize || DEFAULT_FONT_SIZE;

  document.documentElement.style.setProperty("--font-base", cssFont);
  document.documentElement.style.setProperty("--font-size-base", `${size}px`);
  document.body.style.fontFamily = cssFont;
  document.body.style.fontSize = `${size}px`;
}

export function getLanguageForI18n(
  language: AppLanguage,
  systemLanguage?: string,
): string | undefined {
  if (language === "auto") {
    return systemLanguage;
  }
  return language;
}

/**
 * Session-persistence fields that the DatabaseProvider writes through
 * dedicated backend commands (`set_last_open_connections`,
 * `set_last_active_connection`). They ride in `get_config`'s response and
 * therefore end up in the React `Settings` state, but settings saves
 * (`save_config`) must NOT carry them — the Rust merge treats any `Some` as
 * authoritative, so a stale list captured at app start would overwrite what
 * the session code persisted. Strip them before every `save_config` call.
 */
export const SESSION_FIELDS = [
  'lastOpenConnectionIds',
  'lastActiveConnectionId',
] as const;

export type SessionField = (typeof SESSION_FIELDS)[number];

export function stripSessionFields<T extends Record<string, unknown>>(
  config: T,
): Omit<T, SessionField> {
  const out = { ...config };
  for (const key of SESSION_FIELDS) {
    delete (out as Record<string, unknown>)[key];
  }
  return out;
}

// Available fonts from public/fonts + System option
export const AVAILABLE_FONTS = [
  { name: "System", label: "System Default (Automatic)" },
  { name: "DejaVu Sans Mono", label: "DejaVu Sans Mono" },
  { name: "Hack", label: "Hack" },
  { name: "JetBrains Mono", label: "JetBrains Mono" },
  { name: "JetBrains Mono ExtraBold", label: "JetBrains Mono ExtraBold" },
  {
    name: "JetBrains Mono ExtraBold Italic",
    label: "JetBrains Mono ExtraBold Italic",
  },
  { name: "Open Sans", label: "Open Sans" },
  { name: "Roboto", label: "Roboto" },
] as const;

// Project roadmap - feature status tracking
export interface RoadmapItem {
  label: string;
  done: boolean;
  url?: string;
}

import roadmapData from '../../roadmap.json';
export const ROADMAP: readonly RoadmapItem[] = roadmapData;
