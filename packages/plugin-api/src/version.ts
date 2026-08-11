/**
 * API version of this package. Must match the version field of package.json.
 * Bump when the host API shape changes in a way that plugin bundles can observe.
 */
export const API_VERSION = "0.1.1";

/**
 * Minimum Tabularis host version that exposes an API compatible with this package.
 * The host sets `window.__TABULARIS_API_VERSION__`; `assertHostCompat()` uses this
 * constant to decide whether the active host is new enough.
 */
export const MIN_HOST_VERSION = "0.1.0";
