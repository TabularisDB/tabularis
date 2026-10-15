import type { SystemThemeListener } from "./capabilities";

export function prefersDarkColorScheme(): MediaQueryList {
  return window.matchMedia("(prefers-color-scheme: dark)");
}

/** Media-query based system theme subscription shared by every adapter. */
export async function listenForColorSchemeChanges(
  onChange: SystemThemeListener,
): Promise<() => void> {
  const mediaQuery = prefersDarkColorScheme();
  const handleChange = (event: MediaQueryListEvent) => onChange(event.matches);
  mediaQuery.addEventListener("change", handleChange);
  await Promise.resolve();
  onChange(mediaQuery.matches);
  return () => mediaQuery.removeEventListener("change", handleChange);
}
