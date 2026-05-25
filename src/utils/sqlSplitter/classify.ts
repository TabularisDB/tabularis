// Single-statement classifiers. Mirror of
// src-tauri/src/drivers/common/query.rs:7-84.
//
// Deliberate divergence from the Rust side: Rust uses `starts_with` after
// stripping leading comments, which means inputs like `SELECTIVE ...`
// would match `SELECT`. The TS side instead extracts the leading
// identifier and compares whole-word against a keyword set, so
// `SELECTIVE` does not classify as a SELECT. The split-button dropdown
// is user-facing, where the stricter rule avoids surprising false
// positives; the Rust side is internal and the looser rule is fine
// there. Keep these two implementations in sync semantically (same
// keyword sets) but accept the matching strategy difference.

export const RESULT_SET_KEYWORDS: ReadonlySet<string> = new Set([
  'SELECT',
  'WITH',
  'SHOW',
  'EXPLAIN',
  'DESCRIBE',
  'DESC',
  'VALUES',
  'TABLE',
  'PRAGMA',
  'CALL',
]);

export const EXPLAINABLE_KEYWORDS: ReadonlySet<string> = new Set([
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'REPLACE',
  'WITH',
  'TABLE',
  // PostgreSQL 15+ and Oracle both support EXPLAIN MERGE.
  'MERGE',
]);

export function stripLeadingComments(query: string): string {
  let s = query;
  for (;;) {
    s = s.replace(/^\s+/, '');
    if (s.startsWith('--')) {
      const nl = s.indexOf('\n');
      s = nl === -1 ? '' : s.slice(nl + 1);
    } else if (s.startsWith('/*')) {
      const end = s.indexOf('*/');
      s = end === -1 ? '' : s.slice(end + 2);
    } else {
      break;
    }
  }
  return s;
}

const LEADING_KEYWORD_RE = /^([A-Za-z_][A-Za-z0-9_]*)/;
const LEADING_PARENS_RE = /^[(\s]+/;

export function leadingKeyword(query: string): string {
  // Comments may sit inside the parens (`(\n-- header\nSELECT 1)`),
  // and parens may sit between leading comments (`/* x */ ( SELECT 1 )`),
  // so we strip both in a fixed-point loop instead of one pass each.
  let body = query;
  for (;;) {
    const next = stripLeadingComments(body).replace(LEADING_PARENS_RE, '');
    if (next === body) break;
    body = next;
  }
  const match = LEADING_KEYWORD_RE.exec(body);
  return match ? match[1].toUpperCase() : '';
}

export function isSelect(query: string): boolean {
  return leadingKeyword(query) === 'SELECT';
}

export function returnsResultSet(query: string): boolean {
  return RESULT_SET_KEYWORDS.has(leadingKeyword(query));
}

export function isExplainable(query: string): boolean {
  return EXPLAINABLE_KEYWORDS.has(leadingKeyword(query));
}
