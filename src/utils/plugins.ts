export function parseAuthor(author: string): { name: string; url?: string } {
  const match = author.match(/^(.+?)\s*<(.+?)>$/);
  if (match) {
    return { name: match[1].trim(), url: match[2].trim() };
  }
  return { name: author };
}

/** The registry facts an update offer depends on. */
export interface UpdatablePlugin {
  latest_version: string;
  update_available?: boolean;
  releases: {
    version: string;
    platform_supported: boolean;
    min_tabularis_version?: string | null;
  }[];
}

/**
 * Whether `latest_version` can actually be installed over what's on disk.
 * `update_available` alone only says a newer version exists — the release
 * still has to ship a build for this platform and support this app version,
 * or the offer would fail on install.
 */
export function canUpdateToLatest(
  plugin: UpdatablePlugin | undefined,
  appVersion: string,
): boolean {
  if (!plugin?.update_available) return false;
  const latest = plugin.releases.find((r) => r.version === plugin.latest_version);
  if (!latest?.platform_supported) return false;
  return (
    !latest.min_tabularis_version ||
    versionGte(appVersion, latest.min_tabularis_version)
  );
}

/** Returns true if versionA >= versionB (semver comparison) */
export function versionGte(versionA: string, versionB: string): boolean {
  const parse = (v: string) => v.split(".").map((n) => parseInt(n, 10) || 0);
  const a = parse(versionA);
  const b = parse(versionB);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return true;
}
