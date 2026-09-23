import { createContext } from "react";
import type { Theme, ThemeSettings, MonacoThemeDefinition } from "../types/theme";
import type { NativeThemeContribution, ResolvedThemeCatalog, ThemeSelection } from "../types/themeCatalog";

export interface ThemeContextType {
  currentTheme: Theme;
  settings: ThemeSettings;
  allThemes: Theme[];
  isLoading: boolean;
  catalog: ResolvedThemeCatalog;
  selection: ThemeSelection;
  refreshCatalog: () => Promise<ResolvedThemeCatalog>;
  previewTheme: (theme: string | NativeThemeContribution) => void;
  previewDefinition: (source: string, name: string) => void;
  cancelPreview: () => void;
  updatePersonalSource: (themeId: string, name: string, source: string, expectedRevision?: string, editor?: MonacoThemeDefinition) => Promise<Theme>;

  setTheme: (themeId: string) => Promise<void>;
  createCustomTheme: (baseThemeId: string, name: string) => Promise<Theme>;
  updateCustomTheme: (theme: Theme) => Promise<void>;
  deleteCustomTheme: (themeId: string) => Promise<void>;
  duplicateTheme: (themeId: string, newName: string) => Promise<Theme>;
  importTheme: (themeJson: string, name?: string) => Promise<Theme>;
  exportTheme: (themeId: string) => Promise<string>;
  updateSettings: (settings: Partial<ThemeSettings>) => Promise<void>;
}

export const ThemeContext = createContext<ThemeContextType | undefined>(
  undefined,
);
