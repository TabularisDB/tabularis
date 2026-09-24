function parseVersion(version: string): number[] {
  return version.split(".").map((part) => Number.parseInt(part, 10) || 0);
}

export function compareVersions(versionA: string, versionB: string): number {
  const a = parseVersion(versionA);
  const b = parseVersion(versionB);
  const len = Math.max(a.length, b.length);

  for (let i = 0; i < len; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }

  return 0;
}

export function isVersionNewer(candidate: string, baseline: string): boolean {
  return compareVersions(candidate, baseline) > 0;
}

export function isVersionAtMost(candidate: string, baseline: string): boolean {
  return compareVersions(candidate, baseline) <= 0;
}
