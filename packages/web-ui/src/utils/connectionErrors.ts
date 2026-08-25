/**
 * Classification of raw connection-test error strings into user-facing
 * categories with translatable summaries and recovery hints.
 *
 * The backend returns plain strings (driver text, ssh stderr, ...), so the
 * mapping is keyword-based. The raw text is preserved (sanitized) as detail.
 */

export type ConnectionErrorKind =
  | "ssh-auth"
  | "ssh-unreachable"
  | "ssh"
  | "db-auth"
  | "network"
  | "db-not-found"
  | "unknown";

export interface ClassifiedConnectionError {
  kind: ConnectionErrorKind;
  /** i18n key for the short human-readable summary. */
  summaryKey: string;
  /** i18n key for the actionable recovery hint, when one applies. */
  recoveryKey: string | null;
  /** Sanitized raw backend message, for the collapsible details block. */
  detail: string;
}

/** Redacts credentials that may appear inside raw error text. */
export function sanitizeErrorDetail(raw: string): string {
  return raw
    .replace(/(\w+:\/\/[^/\s:@]+):[^@\s/]+@/g, "$1:[redacted]@")
    .replace(/(password\s*=\s*)[^\s&;,]+/gi, "$1[redacted]");
}

const SSH_CONTEXT = /\bssh\b|tunnel/i;
const SSH_AUTH =
  /auth|password|passphrase|credential|permission denied|publickey|keyboard-interactive/i;
const SSH_UNREACHABLE =
  /timed?\s?out|timeout|refused|unreachable|resolve|resolution|failed to connect|exited prematurely|failed to launch|handshake|host key/i;
const DB_AUTH =
  /access denied|authentication failed|password authentication|login failed|role ".*" does not exist|invalid credentials/i;
const NETWORK =
  /connection refused|timed?\s?out|timeout|no route to host|name or service not known|could not translate host|failed to lookup|unreachable|connection reset|broken pipe|os error/i;
const DB_NOT_FOUND =
  /unknown database|database ".*" does not exist|no such database|database file not found/i;

/**
 * Maps a raw backend error string to a category plus i18n keys.
 *
 * `sshEnabled` refines network failures: with a tunnel active the database is
 * dialed through 127.0.0.1, so "connection refused" points at the tunnel, not
 * at the database host.
 */
export function classifyConnectionError(
  raw: string,
  context: { sshEnabled?: boolean } = {},
): ClassifiedConnectionError {
  const detail = sanitizeErrorDetail(raw);
  const build = (
    kind: ConnectionErrorKind,
    hasRecovery = true,
  ): ClassifiedConnectionError => ({
    kind,
    summaryKey: `connectionErrors.${kind}.summary`,
    recoveryKey: hasRecovery ? `connectionErrors.${kind}.recovery` : null,
    detail,
  });

  if (SSH_CONTEXT.test(raw)) {
    if (SSH_AUTH.test(raw)) return build("ssh-auth");
    if (SSH_UNREACHABLE.test(raw)) return build("ssh-unreachable");
    return build("ssh");
  }
  if (DB_AUTH.test(raw)) return build("db-auth");
  if (DB_NOT_FOUND.test(raw)) return build("db-not-found");
  if (NETWORK.test(raw)) {
    if (context.sshEnabled) return build("ssh-unreachable");
    return build("network");
  }
  return build("unknown", false);
}
