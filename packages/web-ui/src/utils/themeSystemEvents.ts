import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isLinuxDesktop } from "./systemTheme";

export const getSystemIsDark = async (): Promise<boolean> => {
  if (isLinuxDesktop()) {
    try {
      const portalTheme = await invoke<"dark" | "light" | null>("get_linux_system_theme");
      if (portalTheme) return portalTheme === "dark";
    } catch { /* Browser previews and desktops without a portal use fallbacks. */ }
  }
  try {
    const nativeTheme = await getCurrentWindow().theme();
    if (nativeTheme) return nativeTheme === "dark";
  } catch { /* Browser previews do not expose the native window API. */ }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
};

export const listenForSystemThemeChanges = async (onChange: (isDark: boolean) => void): Promise<() => void> => {
  if (isLinuxDesktop()) {
    let disposed = false;
    let revision = 0;
    const refresh = async () => {
      const request = ++revision;
      const isDark = await getSystemIsDark();
      if (!disposed && request === revision) onChange(isDark);
    };
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => { void refresh(); };
    mediaQuery.addEventListener("change", handleChange);
    let stopPortal: (() => void) | undefined;
    try { stopPortal = await listen("linux-system-theme-changed", handleChange); } catch { /* Keep the media-query fallback. */ }
    await refresh();
    return () => { disposed = true; stopPortal?.(); mediaQuery.removeEventListener("change", handleChange); };
  }
  try {
    let disposed = false;
    let revision = 0;
    const stopNative = await getCurrentWindow().onThemeChanged(({ payload }) => {
      const request = ++revision;
      if (payload === null) {
        void getSystemIsDark().then((isDark) => { if (!disposed && request === revision) onChange(isDark); });
      } else { onChange(payload === "dark"); }
    });
    // A user may enable follow-system after the OS changed in static mode.
    // Subscribe before reading and never let a stale read override an event.
    const request = ++revision;
    const isDark = await getSystemIsDark();
    if (!disposed && request === revision) onChange(isDark);
    return () => { disposed = true; stopNative(); };
  } catch {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => { onChange(event.matches); };
    mediaQuery.addEventListener("change", handleChange);
    await Promise.resolve();
    onChange(mediaQuery.matches);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }
};
