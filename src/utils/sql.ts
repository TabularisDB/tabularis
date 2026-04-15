import { splitQuery, postgreSplitterOptions } from 'dbgate-query-splitter';

export function splitQueries(sql: string): string[] {
  return splitQuery(sql, postgreSplitterOptions).map(item => typeof item == "string" ? item : item.text);
}

/**
 * Strip leading SQL comments (single-line and block comments) and whitespace
 * so that the first keyword of the actual statement is at position 0.
 */
export function stripLeadingSqlComments(query: string): string {
  let s = query;
  for (;;) {
    s = s.trimStart();
    if (s.startsWith("--")) {
      const nl = s.indexOf("\n");
      s = nl === -1 ? "" : s.slice(nl + 1);
    } else if (s.startsWith("/*")) {
      const end = s.indexOf("*/");
      s = end === -1 ? "" : s.slice(end + 2);
    } else {
      break;
    }
  }
  return s;
}

/**
 * Check if a SQL statement supports EXPLAIN.
 *
 * EXPLAIN works with DML statements (SELECT, INSERT, UPDATE, DELETE, REPLACE)
 * and CTEs (WITH). DDL statements (CREATE, DROP, ALTER, TRUNCATE, etc.) are not supported.
 * Leading SQL comments are stripped before checking.
 */
export function isExplainableQuery(query: string): boolean {
  const upper = stripLeadingSqlComments(query).toUpperCase();
  return (
    upper.startsWith("SELECT") ||
    upper.startsWith("INSERT") ||
    upper.startsWith("UPDATE") ||
    upper.startsWith("DELETE") ||
    upper.startsWith("REPLACE") ||
    upper.startsWith("WITH") ||
    upper.startsWith("TABLE")
  );
}

/**
 * Splits a SQL text into individual queries and returns only those
 * that are explainable (DML: SELECT, INSERT, UPDATE, DELETE, REPLACE, WITH, TABLE).
 * Each returned entry carries its 1-based index in the original split.
 */
export function getExplainableQueries(
  sql: string,
): { query: string; index: number }[] {
  return splitQueries(sql).reduce<{ query: string; index: number }[]>(
    (acc, q, i) => {
      if (isExplainableQuery(q)) acc.push({ query: q, index: i + 1 });
      return acc;
    },
    [],
  );
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
