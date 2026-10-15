import type { RegistryPluginWithStatus } from "../types/plugins";
import { versionGte } from "./plugins";

/** Shared release selection for catalogue and installed-plugin cards. */
export function getPluginVersionState(
  plugin: RegistryPluginWithStatus,
  requestedVersion: string | undefined,
  appVersion: string,
) {
  const platformReleases = plugin.releases.filter((release) => release.platform_supported);
  const installedVersion = plugin.installed_version;
  const isAtLatest = installedVersion === plugin.latest_version;
  const defaultVersion = isAtLatest
    ? plugin.latest_version
    : (platformReleases.find((release) => release.version === plugin.latest_version)?.version ??
      platformReleases.find((release) => release.version !== installedVersion)?.version ??
      installedVersion ?? plugin.latest_version);
  // Keep the installed release selectable even if it has left the registry.
  const versions = [...new Set([
    ...platformReleases.map((release) => release.version).reverse(),
    ...(installedVersion ? [installedVersion] : []),
  ])];
  const selectedVersion = requestedVersion && versions.includes(requestedVersion)
    ? requestedVersion
    : defaultVersion;
  const selectedRelease = plugin.releases.find((release) => release.version === selectedVersion);
  const isSelectedInstalled = selectedVersion === installedVersion;
  const minVersion = selectedRelease?.min_tabularis_version ?? null;
  const isUpdate = !!installedVersion && !isSelectedInstalled;

  return {
    selectedVersion,
    /** True until the user picks a release other than the card's natural target. */
    isDefaultSelection: selectedVersion === defaultVersion,
    isAtLatest,
    isSelectedInstalled,
    isUpdate,
    isDowngrade: isUpdate && !versionGte(selectedVersion, installedVersion!),
    platformSupported: selectedRelease?.platform_supported ?? false,
    isCompatible: !minVersion || versionGte(appVersion, minVersion),
    minVersion,
    options: versions.map((version) => ({
      version,
      isInstalled: version === installedVersion,
      isLatest: version === plugin.latest_version,
    })),
  };
}
