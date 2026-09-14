/**
 * Sanitize a pasted local filesystem path into something usable for open/exists checks.
 *
 * Single cleanup entry for SQLite / DuckDB / CSV / Excel / Parquet (and other
 * file/folder) connection paths:
 * 1. Remove BOM / zero-width characters
 * 2. Trim surrounding whitespace
 * 3. Strip a `file:` URI prefix when present
 * 4. Peel matching outer quotes (`"…"`, `'…'`, `` `…` ``, curly/fullwidth pairs)
 *
 * Does **not** delete characters from the middle of the path (e.g. Windows-illegal
 * `<>:|?*` inside a name) — that would silently corrupt paths; the OS/driver reports those.
 */
export function sanitizeLocalFilePath(raw: string): string {
  const withoutInvisible = Array.from(raw)
    .filter((c) => !isInvisiblePathNoise(c))
    .join("");
  let current = withoutInvisible.trim();
  current = stripFileUriPrefix(current).trim();
  return peelOuterQuotes(current);
}

/** @deprecated Prefer {@link sanitizeLocalFilePath}; kept as an alias. */
export function unwrapQuotedPath(raw: string): string {
  return sanitizeLocalFilePath(raw);
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

function stripFileUriPrefix(value: string): string {
  if (!value.toLowerCase().startsWith("file:")) return value;
  const afterScheme = value.slice(5);
  const rest = afterScheme.replace(/^\/+/, "");
  if (rest.length >= 2) {
    const drive = rest[0];
    const sep = rest[1];
    if (/[a-zA-Z]/.test(drive) && (sep === ":" || sep === "|")) {
      return rest.replace("|", ":");
    }
  }
  return `/${rest.replace(/^\/+/, "")}`;
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
