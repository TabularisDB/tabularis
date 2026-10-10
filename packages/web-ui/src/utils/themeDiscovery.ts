import { gte, valid } from "semver";
import type { RegistryPluginWithStatus } from "../types/plugins";

export interface ThemeRegistryRelease {
  version: string;
  min_tabularis_version: string | null;
  assets: Record<string, string>;
}
export interface ThemeRegistryPlugin extends Pick<RegistryPluginWithStatus, "id" | "name" | "author" | "description" | "latest_version" | "downloads"> {
  releases: ThemeRegistryRelease[];
  screenshots?: Array<{ url: string; alt?: string | null; caption?: string | null }>;
}
export interface ThemeRegistrySnapshot {
  registryKey: string;
  registryUrl: string;
  plugins: ThemeRegistryPlugin[];
}

export function themeDownloadCount(value: number | null | undefined, locale: string): { compact: string; exact: string } | undefined {
  if (value == null || !Number.isSafeInteger(value) || value < 0) return undefined;
  return { compact: new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value), exact: new Intl.NumberFormat(locale).format(value) };
}

export function isCompatibleThemeRelease(release: ThemeRegistryRelease, host: string): boolean {
  return !!valid(release.version) && Object.keys(release.assets).length === 1 && Object.hasOwn(release.assets, "universal")
    && !!valid(host) && (release.min_tabularis_version == null || (!!valid(release.min_tabularis_version) && gte(host, release.min_tabularis_version)));
}
