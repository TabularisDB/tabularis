/**
 * Theme boot cache: the colors the window paints before React and the theme
 * provider run. `index.html` reads this synchronously so a light theme never
 * flashes the dark default on startup; `applyThemeToCSS` refreshes it on every
 * theme change.
 */
export const THEME_BOOT_CACHE_KEY = "tabularis-theme-boot";

export interface ThemeBootCache {
  /** Base background color, applied to the document root. */
  bg: string;
  /** Primary text color. */
  fg: string;
  /** CSS color-scheme, drives native controls and scrollbars. */
  scheme: "light" | "dark";
}

export function saveThemeBootCache(cache: ThemeBootCache): void {
  try {
    localStorage.setItem(THEME_BOOT_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.warn("Failed to save theme boot cache:", error);
  }
}

export function loadThemeBootCache(): ThemeBootCache | null {
  try {
    const raw = localStorage.getItem(THEME_BOOT_CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isThemeBootCache(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isThemeBootCache(value: unknown): value is ThemeBootCache {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.bg === "string" &&
    typeof record.fg === "string" &&
    (record.scheme === "light" || record.scheme === "dark")
  );
}
