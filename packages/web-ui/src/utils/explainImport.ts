// Pure helpers shared between the CLI-driven Visual Explain page and the modal.
// Kept free of React/Tauri deps so they remain trivially unit-testable.

/**
 * Extract a display-friendly filename from a path (POSIX or Windows).
 * Falls back to the full path if no separator is found.
 */
export function getExplainFileName(path: string): string {
  if (!path) return "";
  const normalized = path.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

/**
 * Read the `?file=` query param from a URL search string.
 * Returns `null` when missing, empty, or whitespace-only.
 */
export function parseExplainFileParam(search: string): string | null {
  const params = new URLSearchParams(search);
  const raw = params.get("file");
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Minimal structural check that catches obvious non-EXPLAIN inputs before we
 * hand a file path off to the backend. This is NOT a full validator — the
 * Rust side remains the source of truth.
 */
export function looksLikePostgresExplainJson(raw: string): boolean {
  const trimmed = raw.trimStart();
  return trimmed.startsWith("[") || trimmed.startsWith("{");
}
