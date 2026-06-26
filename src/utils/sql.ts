import {
  type Dialect,
  splitStatements,
  stripLeadingComments,
  isExplainable,
} from './sqlSplitter';

export type SqlDialect = Dialect;

export { splitQueries } from './sqlSplitter';

export const stripLeadingSqlComments = stripLeadingComments;

export const isExplainableQuery = isExplainable;

function isIdentifierChar(char: string): boolean {
  return /[A-Za-z0-9_$]/.test(char);
}

function skipQuotedSegment(sql: string, start: number, quote: string): number {
  let index = start + 1;

  while (index < sql.length) {
    if (sql[index] === quote) {
      if (sql[index + 1] === quote) {
        index += 2;
        continue;
      }

      return index + 1;
    }

    index += 1;
  }

  return sql.length;
}

function skipBracketIdentifier(sql: string, start: number): number {
  let index = start + 1;

  while (index < sql.length) {
    if (sql[index] === ']') {
      if (sql[index + 1] === ']') {
        index += 2;
        continue;
      }

      return index + 1;
    }

    index += 1;
  }

  return sql.length;
}

function skipLineComment(sql: string, start: number): number {
  let index = start + 2;

  while (index < sql.length && sql[index] !== '\n' && sql[index] !== '\r') {
    index += 1;
  }

  return index;
}

function skipHashComment(sql: string, start: number): number {
  let index = start + 1;

  while (index < sql.length && sql[index] !== '\n' && sql[index] !== '\r') {
    index += 1;
  }

  return index;
}

function skipBlockComment(sql: string, start: number): number {
  let index = start + 2;

  while (index < sql.length - 1) {
    if (sql[index] === '*' && sql[index + 1] === '/') {
      return index + 2;
    }

    index += 1;
  }

  return sql.length;
}

function readTopLevelWord(sql: string, start: number): { word: string; end: number } | null {
  const firstChar = sql[start];
  if (!/[A-Za-z_]/.test(firstChar)) {
    return null;
  }

  let end = start + 1;
  while (end < sql.length && isIdentifierChar(sql[end])) {
    end += 1;
  }

  return {
    word: sql.slice(start, end),
    end,
  };
}

export function extractEditableViewDefinition(sql: string): string {
  const trimmed = sql.trim();
  if (!trimmed) {
    return trimmed;
  }

  let depth = 0;
  let sawCreate = false;
  let sawView = false;
  let firstWord: string | null = null;

  for (let index = 0; index < trimmed.length;) {
    const char = trimmed[index];
    const nextChar = trimmed[index + 1];

    if (char === "'" || char === '"' || char === '`') {
      index = skipQuotedSegment(trimmed, index, char);
      continue;
    }

    if (char === '[') {
      index = skipBracketIdentifier(trimmed, index);
      continue;
    }

    if (char === '-' && nextChar === '-') {
      index = skipLineComment(trimmed, index);
      continue;
    }

    if (char === '#') {
      index = skipHashComment(trimmed, index);
      continue;
    }

    if (char === '/' && nextChar === '*') {
      index = skipBlockComment(trimmed, index);
      continue;
    }

    if (char === '(') {
      depth += 1;
      index += 1;
      continue;
    }

    if (char === ')') {
      depth = Math.max(0, depth - 1);
      index += 1;
      continue;
    }

    const word = readTopLevelWord(trimmed, index);
    if (!word) {
      index += 1;
      continue;
    }

    const upperWord = word.word.toUpperCase();
    if (firstWord === null) {
      firstWord = upperWord;
      if (upperWord !== 'CREATE') {
        return trimmed;
      }

      sawCreate = true;
    }

    if (depth === 0 && sawCreate) {
      if (upperWord === 'VIEW') {
        sawView = true;
      } else if (upperWord === 'AS' && sawView) {
        return trimmed.slice(word.end).trim();
      }
    }

    index = word.end;
  }

  return trimmed;
}

/**
 * Splits a SQL text into individual queries and returns only those
 * that are explainable (DML: SELECT, INSERT, UPDATE, DELETE, REPLACE, WITH, TABLE).
 *
 * `index` is 1-based and counts *all* statements emitted by the splitter,
 * including non-explainable ones (DDL etc.). Example: for
 * `CREATE TABLE t (...); SELECT * FROM t;` the SELECT gets `index: 2`,
 * matching its position in the run-button dropdown.
 *
 * Comment-only fragments are folded into adjacent statements by the
 * splitter and do not consume an index slot.
 */
export function getExplainableQueries(
  sql: string,
  dialect?: SqlDialect,
): { query: string; index: number }[] {
  return splitStatements(sql, dialect).flatMap((s, i) =>
    s.isExplainable ? [{ query: s.text, index: i + 1 }] : [],
  );
}

/**
 * Returns the user-facing label for a SQL statement in dropdowns and
 * pickers. Strips leading comments so the first keyword surfaces, and
 * falls back to the raw text when the statement is entirely comments
 * (so the label is never blank).
 */
export function statementLabel(query: string): string {
  return stripLeadingComments(query) || query;
}

/**
 * Extracts the table name from a SELECT query.
 * Handles quotes: `table`, "table", 'table', and unquoted table names.
 * Returns null if no table is found or if it's not a SELECT query.
 * Returns null for aggregate queries (COUNT, SUM, etc.) since they don't return table rows.
 */
export function extractTableName(sql: string): string | null {
  // Remove comments and normalize whitespace
  const cleaned = sql
    .replace(/--[^\n]*/g, '') // Remove line comments
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();

  // Check if it's a SELECT query
  if (!/^\s*SELECT\s+/i.test(cleaned)) {
    return null;
  }

  // DISTINCT removes duplicates - editing a row could affect deduplication
  if (/\bSELECT\s+DISTINCT\b/i.test(cleaned)) {
    return null;
  }

  // Check if it's an aggregate query (COUNT, SUM, AVG, MIN, MAX, GROUP BY, HAVING)
  // These don't return table rows, so we shouldn't fetch PK
  if (/\b(COUNT|SUM|AVG|MIN|MAX)\s*\(/i.test(cleaned) || /\bGROUP\s+BY\b/i.test(cleaned) || /\bHAVING\b/i.test(cleaned)) {
    return null;
  }

  // JOINs produce rows from multiple tables - not safely editable against a single table
  if (/\bJOIN\b/i.test(cleaned)) {
    return null;
  }

  // Set operations combine results from multiple queries
  if (/\b(UNION|INTERSECT|EXCEPT)\b/i.test(cleaned)) {
    return null;
  }

  // Subquery in FROM clause (derived table)
  if (/\bFROM\s*\(/i.test(cleaned)) {
    return null;
  }

  // Match FROM clause with optional quotes
  // Matches: FROM table, FROM `table`, FROM "table", FROM 'table'
  const fromMatch = cleaned.match(/\bFROM\s+([`"']?)(\w+)\1/i);

  if (fromMatch && fromMatch[2]) {
    return fromMatch[2];
  }

  return null;
}
