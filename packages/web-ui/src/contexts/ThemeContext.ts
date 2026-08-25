import { createContext } from "react";
import type { Theme, ThemeSettings } from "../types/theme";

export interface ThemeContextType {
  currentTheme: Theme;
  settings: ThemeSettings;
  allThemes: Theme[];
  isLoading: boolean;

  setTheme: (themeId: string) => Promise<void>;
  createCustomTheme: (baseThemeId: string, name: string) => Promise<Theme>;
  updateCustomTheme: (theme: Theme) => Promise<void>;
  deleteCustomTheme: (themeId: string) => Promise<void>;
  duplicateTheme: (themeId: string, newName: string) => Promise<Theme>;
  importTheme: (themeJson: string) => Promise<Theme>;
  exportTheme: (themeId: string) => Promise<string>;
  updateSettings: (settings: Partial<ThemeSettings>) => Promise<void>;
}

export const ThemeContext = createContext<ThemeContextType | undefined>(
  undefined,
);
