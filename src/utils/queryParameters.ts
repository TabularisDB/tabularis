import { scanNonCodeSpans } from "./sqlSplitter";

/**
 * Converts an arbitrary identifier (e.g. a column name) into a valid named
 * bind-parameter name compatible with the editor's `:param` syntax.
 * The result always matches /^[a-zA-Z_][a-zA-Z0-9_]*$/, so that
 * extractQueryParams / interpolateQueryParams recognise it.
 */
export const toBindParamName = (name: string): string => {
  // Replace every character that is not a letter, digit or underscore.
  const sanitized = name.replace(/[^a-zA-Z0-9_]/g, "_");
  // A bind-parameter name must start with a letter or underscore, never a digit.
  if (sanitized === "" || /^[0-9]/.test(sanitized)) {
    return `_${sanitized}`;
  }
  return sanitized;
};

// Matches :paramName but ignores ::cast (Postgres)
// Look for colon followed by word characters, ensuring it's not preceded by a colon
const PARAM_RE = /(?<!:):([a-zA-Z_][a-zA-Z0-9_]*)(?!\w)/g;

/**
 * Returns `sql` with every string literal and comment replaced by spaces
 * so the parameter regex only ever sees executable SQL (issue #458). The
 * mask is length-preserving: a match index on it is valid on the
 * original. Without a known dialect there is nothing to mask (see
 * scanNonCodeSpans) and detection behaves exactly as it did before
 * dialects were threaded through.
 */
const maskNonCode = (sql: string, dialect?: string): string => {
  const spans = scanNonCodeSpans(sql, dialect);
  if (spans.length === 0) return sql;
  let masked = "";
  let cursor = 0;
  for (const { start, end } of spans) {
    masked += sql.slice(cursor, start) + " ".repeat(end - start);
    cursor = end;
  }
  return masked + sql.slice(cursor);
};

export const extractQueryParams = (sql: string, dialect?: string): string[] => {
  if (!sql) return [];
  const matches = maskNonCode(sql, dialect).match(PARAM_RE);
  if (!matches) return [];

  // Remove duplicate parameters and the leading colon
  const uniqueParams = new Set(matches.map((m) => m.substring(1)));
  return Array.from(uniqueParams);
};

export const interpolateQueryParams = (
  sql: string,
  params: Record<string, string>,
  dialect?: string,
): string => {
  if (!sql) return "";

  // Values are substituted verbatim; callers are responsible for quoting.
  // SQL injection risk is accepted at the UI layer — this is a developer tool.
  // Matches are found on the masked text so a `:name` inside a string
  // literal or comment is never rewritten; the output is assembled from
  // slices of the original (the mask is length-preserving, so indices
  // transfer 1:1).
  const masked = maskNonCode(sql, dialect);
  let result = "";
  let cursor = 0;
  for (const match of masked.matchAll(PARAM_RE)) {
    // Own-property check: a plain `params[name]` lookup would resolve
    // names like :toString via Object.prototype and splice function
    // source into the SQL.
    if (!Object.hasOwn(params, match[1])) continue; // Leave it if no value found (though logic should prevent this)
    result += sql.slice(cursor, match.index) + params[match[1]];
    cursor = match.index + match[0].length;
  }
  return result + sql.slice(cursor);
};
