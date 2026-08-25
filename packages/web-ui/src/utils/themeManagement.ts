import type { Theme, ThemeSettings } from '../types/theme';

export const DEFAULT_THEME_SETTINGS: ThemeSettings = {
  activeThemeId: 'tabularis-dark',
  followSystemTheme: false,
  lightThemeId: 'tabularis-light',
  darkThemeId: 'tabularis-dark',
  customThemes: [],
};

export const OLD_THEME_SETTINGS_KEY = 'tabularis_theme_settings';

export interface ThemeMigrationResult {
  themeId: string | null;
  migrated: boolean;
}

let idCounter = 0;

export function generateCustomThemeId(): string {
  return `custom-${Date.now()}-${idCounter++}`;
}

export function createCustomTheme(
  baseTheme: Theme,
  name: string,
  id?: string
): Theme {
  const newId = id || generateCustomThemeId();
  const now = new Date().toISOString();
  
  return {
    ...baseTheme,
    id: newId,
    name,
    isPreset: false,
    isReadOnly: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function duplicateTheme(
  theme: Theme,
  newName: string,
  id?: string
): Theme {
  const newId = id || generateCustomThemeId();
  const now = new Date().toISOString();
  
  return {
    ...theme,
    id: newId,
    name: newName,
    isPreset: false,
    isReadOnly: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateTheme(theme: Theme, updates: Partial<Theme>): Theme {
  if (theme.isPreset) {
    throw new Error('Cannot modify preset themes');
  }
  
  return {
    ...theme,
    ...updates,
    updatedAt: new Date().toISOString(),
  };
}

export function importTheme(themeJson: string, newId?: string): Theme {
  let importedTheme: Theme;
  try {
    importedTheme = JSON.parse(themeJson) as Theme;
  } catch (e) {
    throw new Error(`Invalid theme JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  
  return {
    ...importedTheme,
    id: newId || generateCustomThemeId(),
    isPreset: false,
    isReadOnly: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function exportTheme(theme: Theme): string {
  return JSON.stringify(theme, null, 2);
}

export function migrateThemeFromLocalStorage(
  configTheme: string | undefined
): ThemeMigrationResult {
  // If backend has theme, no migration needed
  if (configTheme) {
    return { themeId: configTheme, migrated: false };
  }
  
  try {
    const oldSettings = localStorage.getItem(OLD_THEME_SETTINGS_KEY);
    if (!oldSettings) {
      return { themeId: null, migrated: false };
    }
    
    const parsed = JSON.parse(oldSettings);
    return { themeId: parsed.activeThemeId || null, migrated: true };
  } catch (e) {
    console.error('Failed to migrate theme settings:', e);
    return { themeId: null, migrated: false };
  }
}

export function detectSystemTheme(): 'dark' | 'light' {
  if (typeof window === 'undefined') {
    return 'dark';
  }
  
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function getDefaultThemeIdForSystem(): string {
  return detectSystemTheme() === 'dark' ? 'tabularis-dark' : 'tabularis-light';
}

export function findThemeById(
  themeId: string,
  presetThemes: Theme[],
  customThemes: Theme[]
): Theme | undefined {
  const allThemes = [...presetThemes, ...customThemes];
  return allThemes.find((t) => t.id === themeId);
}

export function filterPresetThemes(themes: Theme[]): Theme[] {
  return themes.filter((t) => t.isPreset);
}

export function filterCustomThemes(themes: Theme[]): Theme[] {
  return themes.filter((t) => !t.isPreset);
}

export function addCustomTheme(
  customThemes: Theme[],
  newTheme: Theme
): Theme[] {
  return [...customThemes, newTheme];
}

export function removeCustomTheme(
  customThemes: Theme[],
  themeId: string
): Theme[] {
  return customThemes.filter((t) => t.id !== themeId);
}

export function updateCustomThemeInList(
  customThemes: Theme[],
  updatedTheme: Theme
): Theme[] {
  return customThemes.map((t) =>
    t.id === updatedTheme.id ? updatedTheme : t
  );
}

export function canDeleteTheme(theme: Theme): boolean {
  return !theme.isPreset;
}

export function canEditTheme(theme: Theme): boolean {
  return !theme.isPreset;
}

export function isActiveTheme(
  themeId: string,
  activeThemeId: string
): boolean {
  return themeId === activeThemeId;
}

export function getSystemThemeId(
  isDark: boolean,
  settings: ThemeSettings
): string {
  return isDark ? settings.darkThemeId : settings.lightThemeId;
}
