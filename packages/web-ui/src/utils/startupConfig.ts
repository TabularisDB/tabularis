import type { TabularisClient } from "../api/client";
import type { Settings } from "../contexts/SettingsContext";

type StartupConfig = Partial<Settings> & {
  theme?: string;
  followSystemTheme?: boolean;
  lightThemeId?: string;
  darkThemeId?: string;
};

let pending: Promise<StartupConfig> | undefined;

/** Share simultaneous boot reads without retaining a stale config after boot. */
export function loadStartupConfig(client: TabularisClient): Promise<StartupConfig> {
  pending ??= client.call("get_config", undefined).finally(() => {
    pending = undefined;
  });
  return pending;
}
