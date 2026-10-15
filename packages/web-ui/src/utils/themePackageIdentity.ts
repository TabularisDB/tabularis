import type { InstalledThemeIdentity, ThemePackageManifestV1 } from "../types/themePackage";

const MONACO_NAME_PREFIX = "tabularis-renderer-";
const MONACO_BASE_NAMES = new Set(["vs", "vs-dark", "hc-black", "hc-light"]);

/** Selection IDs are not Monaco identifiers. Reserve a disjoint renderer
 * namespace and encode UTF-16 units injectively, including malformed input.
 * Ordinary legacy/builtin names remain unchanged; even a legacy ID equal to
 * an encoded name is encoded again, so it cannot collide with another ID.
 */
export function getMonacoThemeId(selectionId: string): string {
  const lower = selectionId.toLowerCase();
  if (/^[a-z0-9-]+$/i.test(selectionId)
    && !lower.startsWith(MONACO_NAME_PREFIX) && !MONACO_BASE_NAMES.has(lower)) {
    return selectionId;
  }
  const encoded = selectionId.split("").map((unit) => unit.charCodeAt(0).toString(16).padStart(4, "0")).join("");
  return `${MONACO_NAME_PREFIX}${encoded}`;
}

export const THEME_PACKAGE_LIMITS = {
  slugLength: 64,
  pathLength: 240,
  pathComponents: 8,
} as const;

const REGISTRY_KEY = /^[a-f0-9]{64}$/;
const SLUG = /^[a-z][a-z0-9-]{0,63}$/;
const PATH_COMPONENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

/** Stricter than the registry slug rule for portable native storage. */
export function isThemePackageSlug(value: unknown): value is string {
  return typeof value === "string" && SLUG.test(value) && !WINDOWS_DEVICE.test(value);
}

/**
 * Stable package identity: `id` when declared, otherwise the legacy slug `name`.
 * Only a manifest that declares `id` may use a free-form display `name`.
 */
export function themePackageId(manifest: Pick<ThemePackageManifestV1, "id" | "name">): string {
  if (manifest.id !== undefined) {
    if (!isThemePackageSlug(manifest.id)) throw new Error("Invalid theme package id");
    return manifest.id;
  }
  if (!isThemePackageSlug(manifest.name)) throw new Error("Invalid theme package name");
  return manifest.name;
}

/**
 * Construct a preference ID from already trusted host context. Structural
 * validation does not establish trust in a registry or an author identity.
 * Selection IDs must never be used as filesystem path components.
 */
export function createInstalledThemeId(identity: InstalledThemeIdentity): string {
  const { registryKey, packageName, variantId } = identity;
  if (
    !REGISTRY_KEY.test(registryKey) ||
    !isThemePackageSlug(packageName) ||
    !isThemePackageSlug(variantId)
  ) {
    throw new Error("Invalid installed theme identity");
  }
  return `theme:${registryKey}:${packageName}:${variantId}`;
}

/** Legacy builtin/personal IDs are not parsed or renamed by this helper. */
export function parseInstalledThemeId(value: unknown): InstalledThemeIdentity | null {
  if (typeof value !== "string" || value.length > 200) return null;
  const parts = value.split(":");
  if (parts.length !== 4 || parts[0] !== "theme") return null;
  const [, registryKey, packageName, variantId] = parts;
  if (
    !REGISTRY_KEY.test(registryKey) ||
    !isThemePackageSlug(packageName) ||
    !isThemePackageSlug(variantId)
  ) {
    return null;
  }
  return { registryKey, packageName, variantId };
}

/**
 * Validate one portable relative regular-file path, without normalizing it.
 * Native extraction must additionally reject symlinks, collisions, unsupported
 * payloads and escapes through existing filesystem entries. This is not an
 * archive extractor or authorization check. Directory entry trailing slashes
 * must be handled explicitly by the native entry validator, not stripped here.
 */
export function isThemePackagePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length > THEME_PACKAGE_LIMITS.pathLength) {
    return false;
  }
  if (value === ".tabularium") return true;
  const components = value.split("/");
  return (
    components.length <= THEME_PACKAGE_LIMITS.pathComponents &&
    components.every(
      (component) =>
        PATH_COMPONENT.test(component) &&
        !component.endsWith(".") &&
        !WINDOWS_DEVICE.test(component),
    )
  );
}
