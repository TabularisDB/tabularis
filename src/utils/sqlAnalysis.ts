// SQL Analysis Utilities - Pure logic functions for parsing and analyzing SQL

import { leadingKeyword } from './sqlSplitter/classify';

export interface ParsedTableRef {
  name: string;
  schema?: string;
}

// Removes wrapping SQL identifier quotes/backticks.
// Unquoted identifiers are normalized to lowercase.
function stripIdentifierQuotes(token: string): string {
  const q = token[0];
  if (q === '"' || q === '`') return token.slice(1, -1).replaceAll(q + q, q);
  return token.toLowerCase();
}

// Isolate the FROM/JOIN section of a SQL statement so clause keywords
// (WHERE, HAVING, etc.) are never present when the alias-capture regex runs.
const extractFromSection = (sql: string): string => {
  const fromIdx = sql.toLowerCase().search(/\bfrom\b/);
  if (fromIdx === -1) return '';

  const fromText = sql.slice(fromIdx);
  // Stop at the first clause that cannot appear inside a FROM/JOIN list
  const boundary = /\b(?:where|group\s+by|order\s+by|having|limit|offset|union|intersect|except)\b/i.exec(fromText);
  const section = boundary ? fromText.slice(0, boundary.index) : fromText;

  // Strip ON <cond> and USING(...) within JOIN clauses so those keywords
  // are not captured as table aliases.
  return section
    .replace(/\bon\b.+?(?=\b(?:join|left|right|inner|outer|cross|natural)\b|$)/gis, ' ')
    .replace(/\busing\s*\([^)]*\)/gi, ' ');
};

// Returns alias → ParsedTableRef. Handles quoted identifiers, schema.table, and comma-separated FROM.
export const parseTablesFromQuery = (sql: string): Map<string, ParsedTableRef> | null => {
  if (!sql || sql.length === 0) return null;

  const fromSection = extractFromSection(sql);
  if (!fromSection) return null;

  const tableMap = new Map<string, ParsedTableRef>();
  const fromPattern =
    /(?:from|join|,)\s+("(?:[^"]|"")*"|`[^`]+`|[a-zA-Z_][a-zA-Z0-9_]*)(?:\.("(?:[^"]|"")*"|`[^`]+`|[a-zA-Z_][a-zA-Z0-9_]*))?(?:\s+(?:as\s+)?("(?:[^"]|"")*"|`[^`]+`|(?!(?:join|left|right|inner|outer|cross|natural|full|on|using|where|group|order|having|limit|offset|union|intersect|except|for|fetch|window|lateral|tablesample|qualify|straight_join)\b)[a-zA-Z_][a-zA-Z0-9_]*))?/gi;

  let match;
  let matchCount = 0;
  const MAX_MATCHES = 10;

  while ((match = fromPattern.exec(fromSection)) !== null && matchCount++ < MAX_MATCHES) {
    const schemaToken = match[2] ? match[1] : undefined;
    const tableToken = match[2] ?? match[1];
    if (!tableToken) continue;

    const tableName = stripIdentifierQuotes(tableToken);
    const schema = schemaToken ? stripIdentifierQuotes(schemaToken) : undefined;
    const aliasToken = match[3];
    const alias = aliasToken ? stripIdentifierQuotes(aliasToken) : tableName;
    tableMap.set(alias, { name: tableName, schema });
  }

  return tableMap.size > 0 ? tableMap : null;
};

// Strips comments and quoted literals so the keyword/depth scan below never
// matches text that only looks like SQL because it's inside a string or a
// comment. `\\.` handles backslash-escaped quotes (MySQL's default string
// escaping) in addition to the standard doubled-quote escaping.
const stripCommentsAndLiterals = (sql: string): string =>
  sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^'\\]|\\.|'')*'/g, "''")
    .replace(/"(?:[^"\\]|\\.|"")*"/g, '""')
    .replace(/`(?:[^`]|``)*`/g, '``');

const CTE_STATEMENT_KEYWORDS = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MERGE']);

// A data-modifying CTE (`WITH x AS (...) DELETE FROM t ...`) carries its
// real statement type after the CTE definitions, not at the start. Scan for
// the first keyword that sits outside any parenthesized CTE body.
function finalCteStatementKeyword(cleaned: string): string | null {
  const tokenRe = /\(|\)|[A-Za-z_][A-Za-z0-9_]*/g;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(cleaned)) !== null) {
    const token = match[0];
    if (token === '(') { depth++; continue; }
    if (token === ')') { depth = Math.max(0, depth - 1); continue; }
    if (depth === 0) {
      const word = token.toUpperCase();
      if (CTE_STATEMENT_KEYWORDS.has(word)) return word;
    }
  }
  return null;
}

// True if `WHERE` appears outside of any parenthesized group — a WHERE
// nested in a subquery (e.g. an UPDATE...SET with a correlated subquery)
// doesn't count, since it doesn't limit which rows of the target table are
// affected.
function hasTopLevelWhere(cleaned: string): boolean {
  const tokenRe = /\(|\)|\bWHERE\b/gi;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(cleaned)) !== null) {
    const token = match[0];
    if (token === '(') { depth++; continue; }
    if (token === ')') { depth = Math.max(0, depth - 1); continue; }
    if (depth === 0) return true;
  }
  return false;
}

// The distinct ways a statement can be flagged as dangerous. Each maps to its
// own confirmation copy so the dialog can explain the specific risk.
//   - 'no-where':  DELETE/UPDATE with no top-level WHERE (wipes a whole table)
//   - 'drop':      DROP removes an object (and its data) irreversibly
//   - 'truncate':  TRUNCATE empties a table irreversibly
export type DangerousQueryKind = 'no-where' | 'drop' | 'truncate';

// Classifies a single statement's danger, or null when it is safe to run
// without confirmation. Handles the same edge cases as the WHERE detection:
// comments, string literals, and data-modifying CTEs.
export const classifyDangerousQuery = (sql: string): DangerousQueryKind | null => {
  const cleaned = stripCommentsAndLiterals(sql);
  let keyword = leadingKeyword(cleaned);
  if (keyword === 'WITH') {
    keyword = finalCteStatementKeyword(cleaned) ?? keyword;
  }

  if (keyword === 'DROP') return 'drop';
  if (keyword === 'TRUNCATE') return 'truncate';
  if ((keyword === 'DELETE' || keyword === 'UPDATE') && !hasTopLevelWhere(cleaned)) {
    return 'no-where';
  }
  return null;
};

// True when a statement should be gated behind a confirmation dialog.
export const isDangerousQuery = (sql: string): boolean => classifyDangerousQuery(sql) !== null;

// Flags DELETE/UPDATE statements with no top-level WHERE clause — the
// classic "forgot the WHERE" accident that wipes or overwrites a whole
// table.
export const isDestructiveWithoutWhere = (sql: string): boolean =>
  classifyDangerousQuery(sql) === 'no-where';

// Optimized statement extractor - avoid full text scan when possible
export const getCurrentStatement = (model: { getValue: () => string; getOffsetAt: (position: { lineNumber: number; column: number }) => number }, position: { lineNumber: number; column: number }): string => {
  const fullText = model.getValue();

  // For small files, just return full text
  if (fullText.length < 500) {
    return fullText;
  }

  const offset = model.getOffsetAt(position);
  let start = 0;
  let end = fullText.length;


  // Search within reasonable bounds (±2000 chars from cursor)
  const searchStart = Math.max(0, offset - 2000);
  const searchEnd = Math.min(fullText.length, offset + 2000);

  // Find previous semicolon
  for (let i = offset - 1; i >= searchStart; i--) {
    if (fullText[i] === ';') {
      start = i + 1;
      break;
    }
  }

  // Find next semicolon
  for (let i = offset; i < searchEnd; i++) {
    if (fullText[i] === ';') {
      end = i;
      break;
    }
  }

  return fullText.substring(start, end).trim();
};
