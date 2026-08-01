/**
 * Column anonymization for file exports (#483).
 *
 * The export dialog lets the user assign a per-column rule; the spec is sent
 * to the backend where a transform layer applies it between the row stream
 * and the CSV/JSON/Markdown sinks. Field names use snake_case to match the
 * Rust `AnonymizeSpec` serde payload verbatim.
 */

export type AnonymizeRule =
  /** Replace with a fixed value; `null` writes a real NULL. */
  | { type: "fixed"; value: string | null }
  /** Keep the first/last N chars, mask the middle (email-aware). */
  | { type: "partial"; keep_start: number; keep_end: number }
  /** Deterministic HMAC-SHA256 pseudonym, stable per export key. */
  | { type: "hmac" };

export interface AnonymizeSpec {
  /** Per-export HMAC key — reuse it across exports for stable joins. */
  key: string;
  /** Column name → rule; unlisted columns pass through unchanged. */
  rules: Record<string, AnonymizeRule>;
}

/** Generates a random per-export pseudonymization key (32 hex chars). */
export function generateAnonymizeKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
