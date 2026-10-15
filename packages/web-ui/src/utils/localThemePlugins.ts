import type { NativeThemeContribution } from "../types/themeCatalog";
import type { RegistryPluginWithStatus } from "../types/plugins";
import { versionGte } from "./plugins";

/** Include local-only packages even when registry discovery is offline. */
export function mergeLocalThemePlugins(
  registry: RegistryPluginWithStatus[],
  themes: NativeThemeContribution[],
): RegistryPluginWithStatus[] {
  const result = [...registry];
  const seen = new Set<string>();
  for (const theme of themes) {
    if (theme.origin.kind !== "installed") continue;
    const { packageName } = theme.origin.identity;
    if (seen.has(packageName)) continue;
    seen.add(packageName);
    const index = result.findIndex((plugin) => plugin.kind === "theme" && plugin.id === packageName);
    if (index >= 0) {
      const remote = result[index];
      const version = theme.origin.packageVersion;
      result[index] = {
        ...remote,
        installed_version: version,
        update_available: remote.installed_version === version ? remote.update_available
          : remote.latest_version !== version && versionGte(remote.latest_version, version),
      };
      continue;
    }
    result.push({
      id: packageName, name: packageName, kind: "theme",
      description: "", author: "", homepage: "",
      latest_version: theme.origin.packageVersion,
      installed_version: theme.origin.packageVersion,
      releases: [], update_available: false, platform_supported: true,
    });
  }
  return result;
}
