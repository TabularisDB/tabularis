import { invoke } from "@tauri-apps/api/core";
import type { Settings } from "../contexts/SettingsContext";

type StartupConfig = Partial<Settings> & {
  theme?: string;
  followSystemTheme?: boolean;
  lightThemeId?: string;
  darkThemeId?: string;
};

let pending: Promise<StartupConfig> | undefined;

/** Share simultaneous boot reads without retaining a stale config after boot. */
export function loadStartupConfig(): Promise<StartupConfig> {
  pending ??= invoke<StartupConfig>("get_config").finally(() => {
    pending = undefined;
  });
  return pending;
}
