export const EXCERPT_MAX_LENGTH = 80;
export const EXCERPT_LEADING_CONTEXT = 20;

export interface SavedQueryExcerpt {
  before: string;
  match: string;
  after: string;
  truncatedStart: boolean;
  truncatedEnd: boolean;
}

export interface SearchableSavedQuery {
  name: string;
  sql: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findFirstMatch(
  text: string,
  term: string,
): { index: number; length: number } | null {
  if (!term) return null;
  const found = new RegExp(escapeRegExp(term), "i").exec(text);
  return found ? { index: found.index, length: found[0].length } : null;
}

export function matchesSavedQuery(
  query: SearchableSavedQuery,
  rawTerm: string,
): boolean {
  const term = rawTerm.trim();
  if (!term) return true;
  return (
    findFirstMatch(query.name, term) !== null ||
    findFirstMatch(query.sql, term) !== null
  );
}

/**
 * Picks one short excerpt around the first case-insensitive SQL match, taken
 * from the line that contains it. Returns null when there is no search or the
 * SQL body does not match, so callers keep the default preview.
 */
export function getSavedQueryExcerpt(
  sql: string,
  rawTerm: string,
  maxLength = EXCERPT_MAX_LENGTH,
): SavedQueryExcerpt | null {
  const term = rawTerm.trim();
  const found = findFirstMatch(sql, term);
  if (!found) return null;

  const lineStart = sql.lastIndexOf("\n", found.index - 1) + 1;
  const newline = sql.indexOf("\n", found.index);
  const lineEnd = newline === -1 ? sql.length : newline;
  const rawLine = sql.slice(lineStart, lineEnd).replace(/\r$/, "");

  const indent = rawLine.length - rawLine.trimStart().length;
  const line = rawLine.trim();
  const matchStart = found.index - lineStart - indent;
  const matchEnd = matchStart + found.length;

  let start = 0;
  let end = line.length;
  if (line.length > maxLength) {
    start = Math.max(0, matchStart - EXCERPT_LEADING_CONTEXT);
    end = Math.min(line.length, Math.max(start + maxLength, matchEnd));
  }

  return {
    before: line.slice(start, matchStart),
    match: line.slice(matchStart, matchEnd),
    after: line.slice(matchEnd, end),
    truncatedStart: start > 0,
    truncatedEnd: end < line.length,
  };
}
