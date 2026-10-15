import { useTheme } from "./useTheme";
import { useSettings } from "./useSettings";
import type { Theme } from "../types/theme";

/**
 * Resolves the effective Monaco editor theme: the dedicated editor theme
 * override from settings when set, otherwise the current UI theme.
 *
 * Monaco themes are global (one theme for every editor instance on the page),
 * so every Monaco-based component must resolve its theme through this hook —
 * otherwise mounting one editor switches the colors of all the others.
 */
export function useEditorTheme(): Theme {
  const { currentTheme, allThemes } = useTheme();
  const { settings } = useSettings();

  return settings.editorTheme
    ? (allThemes.find((t) => t.id === settings.editorTheme) ?? currentTheme)
    : currentTheme;
}
