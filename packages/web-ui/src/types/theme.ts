export interface MonacoThemeDefinition {
  base: 'vs' | 'vs-dark' | 'hc-black';
  inherit: boolean;
  rules?: Array<{
    token: string;
    foreground?: string;
    background?: string;
    fontStyle?: string;
  }>;
  colors?: Record<string, string>;
  /** Optional: Name of the monaco-themes theme to use */
  themeName?: string;
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

export interface ThemeTypography {
  fontFamily: {
    base: string;
    mono: string;
  };
  fontSize: {
    xs: string;
    sm: string;
    base: string;
    lg: string;
    xl: string;
  };
}

export interface ThemeLayout {
  borderRadius: {
    sm: string;
    base: string;
    lg: string;
    xl: string;
  };
  spacing: {
    xs: string;
    sm: string;
    base: string;
    lg: string;
    xl: string;
  };
}

export interface TaskbarIconConfig {
  type: 'tint' | 'custom';
  color?: string;
  iconPath?: string;
}

export interface Theme {
  id: string;
  name: string;
  author?: string;
  version?: string;
  isPreset: boolean;
  isReadOnly: boolean;
  createdAt?: string;
  updatedAt?: string;
  colors: ThemeColors;
  typography: ThemeTypography;
  layout: ThemeLayout;
  monacoTheme: MonacoThemeDefinition;
  taskbarIcon?: TaskbarIconConfig;
}

export interface ThemeSettings {
  activeThemeId: string;
  followSystemTheme: boolean;
  lightThemeId: string;
  darkThemeId: string;
  customThemes: string[];
}

export const DEFAULT_THEME_SETTINGS: ThemeSettings = {
  activeThemeId: 'tabularis-dark',
  followSystemTheme: false,
  lightThemeId: 'tabularis-light',
  darkThemeId: 'tabularis-dark',
  customThemes: [],
};
