import type { RegistryPluginWithStatus } from "../types/plugins";
import { canUpdateToLatest } from "./plugins";

export function getPluginUpdates(
  plugins: RegistryPluginWithStatus[],
  appVersion: string,
) {
  return plugins.filter(
    (plugin) =>
      !!plugin.installed_version && canUpdateToLatest(plugin, appVersion),
  );
}
