/**
 * Sanitize a pasted local filesystem path into something usable for open/exists checks.
 *
 * Single cleanup entry for SQLite / DuckDB / CSV / Excel / Parquet (and other
 * file/folder) connection paths:
 * 1. Remove BOM / zero-width characters
 * 2. Trim surrounding whitespace and peel matching outer quotes
 *    (`"…"`, `'…'`, `` `…` ``, curly/fullwidth pairs)
 * 3. Convert a `file:` URI into a local path (authority and percent-encoding
 *    are handled by the WHATWG `URL` parser)
 *
 * Does **not** delete characters from the middle of the path (e.g. Windows-illegal
 * `<>:|?*` inside a name) — that would silently corrupt paths; the OS/driver reports those.
 * Mirrors `sanitize_local_file_path` in `src-tauri/src/fs_path.rs`.
 */
export function sanitizeLocalFilePath(raw: string): string {
  const withoutInvisible = Array.from(raw)
    .filter((c) => !isInvisiblePathNoise(c))
    .join("");
  const unquoted = peelOuterQuotes(withoutInvisible);
  const fromUri = fileUriToPath(unquoted);
  return fromUri === null ? unquoted : peelOuterQuotes(fromUri);
}

/** Normalize a connection database field when it stores a local file/folder path. */
export function normalizeLocalDatabasePath(
  database: string | string[] | undefined | null,
): string | string[] | undefined | null {
  if (database == null) return database;
  if (typeof database === "string") return sanitizeLocalFilePath(database);
  return database.map((entry) => sanitizeLocalFilePath(entry));
}

function isInvisiblePathNoise(c: string): boolean {
  return (
    c === "\uFEFF" ||
    c === "\u200B" ||
    c === "\u200C" ||
    c === "\u200D" ||
    c === "\u2060" ||
    c === "\u00AD"
  );
}

/**
 * Convert a `file:` URI into a local path, or `null` when `value` is not one.
 * Handles `file://localhost/p`, UNC-style `file://server/share/p`
 * (→ `//server/share/p`), Windows drive letters and percent-encoding.
 */
export function fileUriToPath(value: string): string | null {
  if (!value.toLowerCase().startsWith("file:")) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    path = url.pathname;
  }
  const drive = /^\/([a-zA-Z])[:|](.*)$/.exec(path);
  if (drive) return `${drive[1]}:${drive[2]}`;
  return url.hostname ? `//${url.hostname}${path}` : path;
}

function matchingQuoteClose(open: string): string | undefined {
  switch (open) {
    case '"':
    case "'":
    case "`":
      return open;
    case "\u201C":
      return "\u201D";
    case "\u2018":
      return "\u2019";
    case "\u201F":
      return "\u201D";
    case "\u201B":
      return "\u2019";
    case "\uFF02":
      return "\uFF02";
    case "\uFF07":
      return "\uFF07";
    case "\u00AB":
      return "\u00BB";
    case "\u2039":
      return "\u203A";
    default:
      return undefined;
  }
}

function peelOuterQuotes(raw: string): string {
  let current = raw.trim();
  while (current.length >= 2) {
    const open = current[0];
    const closeExpected = matchingQuoteClose(open);
    if (!closeExpected) break;
    const close = current[current.length - 1];
    if (close !== closeExpected) break;
    current = current.slice(open.length, current.length - close.length).trim();
  }
  return current;
}
