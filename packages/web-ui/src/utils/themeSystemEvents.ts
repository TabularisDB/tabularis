import { getActivePlatformCapabilitiesOrNull } from "../platform/activeCapabilities";
import type { SystemThemeListener } from "../platform/capabilities";
import {
  listenForColorSchemeChanges,
  prefersDarkColorScheme,
} from "../platform/systemColorScheme";

/** Current OS light/dark mode as reported by the active platform. */
export const getSystemIsDark = (): Promise<boolean> => {
  const platform = getActivePlatformCapabilitiesOrNull();
  return platform
    ? platform.getSystemIsDark()
    : Promise.resolve(prefersDarkColorScheme().matches);
};

export const listenForSystemThemeChanges = (
  onChange: SystemThemeListener,
): Promise<() => void> => {
  const platform = getActivePlatformCapabilitiesOrNull();
  return platform
    ? platform.listenForSystemThemeChanges(onChange)
    : listenForColorSchemeChanges(onChange);
};
