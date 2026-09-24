interface SemanticVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

const SEMANTIC_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parseSemanticVersion(value: string): SemanticVersion | null {
  const match = SEMANTIC_VERSION.exec(value);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareVersions(left: SemanticVersion, right: SemanticVersion): number {
  return (
    left.major - right.major ||
    left.minor - right.minor ||
    left.patch - right.patch
  );
}

/**
 * Check whether a host can execute a bundle built for the declared plugin API.
 * Legacy entries without a declaration remain supported. During the unstable
 * 0.x line, minor versions are treated as compatibility boundaries.
 */
export function isPluginApiCompatible(
  hostVersion: string,
  requiredVersion?: string,
): boolean {
  if (requiredVersion === undefined) return true;
  const host = parseSemanticVersion(hostVersion);
  const required = parseSemanticVersion(requiredVersion);
  if (!host || !required || host.major !== required.major) return false;
  if (host.major === 0 && host.minor !== required.minor) return false;
  return compareVersions(host, required) >= 0;
}
