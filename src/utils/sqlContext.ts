// SQL cursor-context analysis - determines which clause the cursor sits in so
// the autocomplete provider can offer only the relevant suggestion kinds
// (columns after WHERE, tables after FROM, nothing inside strings/comments).
//
// The analyzer is a single forward scan over the text that precedes the
// cursor. It is intentionally dialect-neutral and tolerant of partial input:
// an editor buffer is almost always an incomplete statement.

// Every clause context the analyzer can report. Exported as a value list so
// tests (and the suggestion-kind map) can be exhaustive over all cases.
export const SQL_CLAUSES = [
  'start', // beginning of a statement, nothing typed yet
  'select', // inside a SELECT list
  'from', // after FROM
  'join', // after JOIN
  'on', // inside a join condition
  'using', // after USING
  'where', // inside a WHERE condition
  'group-by', // after GROUP BY
  'having', // after HAVING
  'order-by', // after ORDER BY
  'limit', // after LIMIT / OFFSET / FETCH
  'update', // after UPDATE (target table)
  'set', // inside an UPDATE ... SET list
  'delete', // after DELETE, before FROM
  'insert-into', // after INSERT [INTO] (target table)
  'insert-columns', // inside the column list of an INSERT
  'values', // inside VALUES
  'case', // inside a CASE ... END expression
  'function-args', // inside function call parentheses
  'in-list', // inside an IN (...) list
  'window', // after PARTITION BY (window/OVER clause)
  'returning', // after RETURNING
  'union', // right after UNION / INTERSECT / EXCEPT
  'create', // after CREATE (new object: existing names are not useful)
  'drop', // after DROP
  'alter', // after ALTER
  'truncate', // after TRUNCATE
  'with', // after WITH, before the CTE body
  'unknown', // could not be determined - callers should not restrict anything
] as const;

export type SqlClause = (typeof SQL_CLAUSES)[number];

export interface SqlContextInfo {
  clause: SqlClause;
  /** Cursor is inside an unterminated string literal ('...'). */
  inString: boolean;
  /** Cursor is inside an unterminated -- or block comment. */
  inComment: boolean;
  /** Parenthesis depth at the cursor (0 = top level of the statement). */
  nestingLevel: number;
  /**
   * Offset (into the analyzed text) where the innermost statement scope
   * containing the cursor begins: right after the `(` of the enclosing
   * subquery/CTE body, or after the last `;` at top level. Expression groups
   * like `WHERE (...)` are not statement scopes and do not narrow it.
   */
  statementStart: number;
  /**
   * Most relevant table name or alias referenced before the cursor in the
   * current statement scope: the table being joined in an ON clause, or the
   * primary FROM table in a WHERE / other clause.
   */
  lastTableRef?: string | null;
}

export interface SuggestionKinds {
  columns: boolean;
  tables: boolean;
  keywords: boolean;
}

// Which suggestion kinds make sense for each clause. 'unknown' allows
// everything so an analyzer miss degrades to the previous behavior instead of
// hiding suggestions.
const CLAUSE_SUGGESTION_KINDS: Record<SqlClause, SuggestionKinds> = {
  start: { columns: false, tables: false, keywords: true },
  select: { columns: true, tables: false, keywords: true },
  from: { columns: false, tables: true, keywords: true },
  join: { columns: false, tables: true, keywords: true },
  on: { columns: true, tables: false, keywords: true },
  using: { columns: true, tables: false, keywords: true },
  where: { columns: true, tables: false, keywords: true },
  'group-by': { columns: true, tables: false, keywords: true },
  having: { columns: true, tables: false, keywords: true },
  'order-by': { columns: true, tables: false, keywords: true },
  limit: { columns: false, tables: false, keywords: true },
  update: { columns: false, tables: true, keywords: true },
  set: { columns: true, tables: false, keywords: true },
  delete: { columns: false, tables: false, keywords: true },
  'insert-into': { columns: false, tables: true, keywords: true },
  'insert-columns': { columns: true, tables: false, keywords: false },
  values: { columns: false, tables: false, keywords: true },
  case: { columns: true, tables: false, keywords: true },
  'function-args': { columns: true, tables: false, keywords: true },
  'in-list': { columns: true, tables: false, keywords: true },
  window: { columns: true, tables: false, keywords: true },
  returning: { columns: true, tables: false, keywords: true },
  union: { columns: false, tables: false, keywords: true },
  create: { columns: false, tables: false, keywords: true },
  drop: { columns: false, tables: true, keywords: true },
  alter: { columns: false, tables: true, keywords: true },
  truncate: { columns: false, tables: true, keywords: true },
  with: { columns: false, tables: false, keywords: true },
  unknown: { columns: true, tables: true, keywords: true },
};

export const getSuggestionKinds = (clause: SqlClause): SuggestionKinds =>
  CLAUSE_SUGGESTION_KINDS[clause];

/**
 * How relevant a keyword is in the current clause:
 * - 'high': a likely continuation, ranked above other keywords
 * - 'normal': shown with default ranking
 * - 'hidden': meaningless here (e.g. WHEN outside CASE), not offered at all
 */
export type KeywordRelevance = 'high' | 'normal' | 'hidden';

// Keywords that only make sense inside specific clauses; everywhere else they
// are hidden so they cannot outrank useful ones (typing "wh" after FROM must
// select WHERE, not WHEN).
const KEYWORD_ALLOWED_CLAUSES: Record<string, readonly SqlClause[]> = {
  WHEN: ['case'],
  THEN: ['case'],
  ELSE: ['case'],
  END: ['case'],
  ON: ['join', 'values'], // values: MySQL `... VALUES (...) ON DUPLICATE KEY UPDATE`
  VALUES: ['insert-into', 'insert-columns', 'values', 'start'],
  SET: ['update', 'start'], // start: MySQL `SET @var = ...`
  INTO: ['insert-into', 'select', 'start'], // select: `SELECT ... INTO`
};

// Likely next keywords per clause, ranked above the rest.
const BOOSTED_KEYWORDS: Partial<Record<SqlClause, ReadonlySet<string>>> = {
  start: new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE']),
  select: new Set(['FROM', 'DISTINCT', 'CASE']),
  from: new Set(['WHERE', 'JOIN', 'LEFT JOIN', 'INNER JOIN', 'GROUP BY', 'ORDER BY', 'LIMIT']),
  join: new Set(['ON']),
  on: new Set(['AND', 'OR', 'WHERE', 'JOIN', 'LEFT JOIN']),
  where: new Set(['AND', 'OR', 'GROUP BY', 'ORDER BY', 'LIMIT', 'IN', 'BETWEEN', 'LIKE', 'IS', 'NOT']),
  'group-by': new Set(['HAVING', 'ORDER BY', 'LIMIT']),
  having: new Set(['AND', 'OR', 'ORDER BY', 'LIMIT']),
  'order-by': new Set(['LIMIT']),
  limit: new Set(['OFFSET']),
  update: new Set(['SET']),
  set: new Set(['WHERE']),
  delete: new Set(['FROM']),
  'insert-into': new Set(['INTO', 'VALUES']),
  case: new Set(['WHEN', 'THEN', 'ELSE', 'END']),
  'in-list': new Set(['SELECT']),
  union: new Set(['SELECT']),
  with: new Set(['AS']),
  create: new Set(['TABLE', 'INDEX']),
  drop: new Set(['TABLE', 'INDEX']),
  alter: new Set(['TABLE']),
  truncate: new Set(['TABLE']),
};

export const getKeywordRelevance = (clause: SqlClause, keyword: string): KeywordRelevance => {
  // An analyzer miss must never hide keywords.
  if (clause === 'unknown') return 'normal';

  const allowed = KEYWORD_ALLOWED_CLAUSES[keyword];
  if (allowed && !allowed.includes(clause)) return 'hidden';

  return BOOSTED_KEYWORDS[clause]?.has(keyword) ? 'high' : 'normal';
};

// Words that can never be a table/function identifier. Used to tell a
// function call `count(` or a table name `users (` apart from a plain
// expression group `WHERE (`.
const KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER',
  'CROSS', 'NATURAL', 'FULL', 'LATERAL', 'ON', 'USING', 'AND', 'OR', 'NOT',
  'IN', 'IS', 'NULL', 'BETWEEN', 'LIKE', 'ILIKE', 'EXISTS', 'AS', 'DISTINCT',
  'ALL', 'ANY', 'SOME', 'GROUP', 'ORDER', 'PARTITION', 'BY', 'HAVING',
  'LIMIT', 'OFFSET', 'FETCH', 'UPDATE', 'SET', 'DELETE', 'INSERT', 'INTO',
  'VALUES', 'VALUE', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'UNION',
  'INTERSECT', 'EXCEPT', 'MINUS', 'CREATE', 'DROP', 'ALTER', 'TRUNCATE',
  'TABLE', 'VIEW', 'INDEX', 'IF', 'RETURNING', 'WITH', 'OVER', 'WINDOW',
  'ASC', 'DESC', 'RECURSIVE', 'REPLACE', 'STRAIGHT_JOIN',
]);

interface Frame {
  clause: SqlClause;
  // Clauses saved when entering CASE expressions (they nest), restored on END.
  caseSaved: SqlClause[];
  // Offset where this frame's content begins (after its `(` or `;`).
  contentStart: number;
  // True once the frame is known to hold its own statement (a SELECT/INSERT/
  // UPDATE/DELETE was seen directly in it) rather than a plain expression.
  isStatement: boolean;
  fromTableRef: string | null;
  currentJoinTableRef: string | null;
  lastTableRef: string | null;
  awaitingAlias: boolean;
}

const createFrame = (
  clause: SqlClause,
  contentStart: number,
  isStatement: boolean,
  parentFrame?: Frame,
): Frame => ({
  clause,
  caseSaved: [],
  contentStart,
  isStatement,
  fromTableRef: isStatement ? null : (parentFrame?.fromTableRef ?? null),
  currentJoinTableRef: isStatement ? null : (parentFrame?.currentJoinTableRef ?? null),
  lastTableRef: isStatement ? null : (parentFrame?.lastTableRef ?? null),
  awaitingAlias: false,
});

interface WordToken {
  upper: string;
  isKeyword: boolean;
}

const isWordChar = (ch: string): boolean => /[A-Za-z0-9_$]/.test(ch);

const recordIdentifier = (frame: Frame, ident: string, isQualifier: boolean): void => {
  if (frame.clause === 'from') {
    if (!frame.fromTableRef || isQualifier) {
      frame.fromTableRef = ident;
      frame.lastTableRef = ident;
      frame.awaitingAlias = true;
    } else if (frame.awaitingAlias) {
      frame.fromTableRef = ident;
      frame.lastTableRef = ident;
      frame.awaitingAlias = false;
    } else {
      frame.lastTableRef = ident;
      frame.awaitingAlias = true;
    }
  } else if (frame.clause === 'join') {
    if (!frame.currentJoinTableRef || isQualifier) {
      frame.currentJoinTableRef = ident;
      frame.lastTableRef = ident;
      frame.awaitingAlias = true;
    } else if (frame.awaitingAlias) {
      frame.currentJoinTableRef = ident;
      frame.lastTableRef = ident;
      frame.awaitingAlias = false;
    } else {
      frame.lastTableRef = ident;
    }
  } else if (frame.clause === 'update') {
    if (!frame.fromTableRef || isQualifier) {
      frame.fromTableRef = ident;
      frame.lastTableRef = ident;
      frame.awaitingAlias = true;
    } else if (frame.awaitingAlias) {
      frame.fromTableRef = ident;
      frame.lastTableRef = ident;
      frame.awaitingAlias = false;
    }
  } else if (frame.clause === 'insert-into') {
    if (!frame.fromTableRef || isQualifier) {
      frame.fromTableRef = ident;
      frame.lastTableRef = ident;
    }
  }
};

// Applies one keyword to the innermost frame. Words that are not clause
// keywords (identifiers, no-op keywords like AND/NOT) leave the clause as-is.
const applyWord = (frame: Frame, upper: string, prev: WordToken | null): void => {
  switch (upper) {
    case 'SELECT':
      frame.clause = 'select';
      frame.isStatement = true;
      frame.awaitingAlias = false;
      break;
    case 'FROM':
      frame.clause = 'from';
      frame.awaitingAlias = false;
      break;
    case 'JOIN':
    case 'STRAIGHT_JOIN':
      frame.clause = 'join';
      frame.currentJoinTableRef = null;
      frame.awaitingAlias = false;
      break;
    case 'ON':
      frame.clause = 'on';
      frame.awaitingAlias = false;
      break;
    case 'USING':
      frame.clause = 'using';
      frame.awaitingAlias = false;
      break;
    case 'WHERE':
      frame.clause = 'where';
      frame.awaitingAlias = false;
      break;
    case 'BY':
      if (prev?.upper === 'GROUP') { frame.clause = 'group-by'; frame.awaitingAlias = false; }
      else if (prev?.upper === 'ORDER') { frame.clause = 'order-by'; frame.awaitingAlias = false; }
      else if (prev?.upper === 'PARTITION') { frame.clause = 'window'; frame.awaitingAlias = false; }
      break;
    case 'HAVING':
      frame.clause = 'having';
      frame.awaitingAlias = false;
      break;
    case 'LIMIT':
    case 'OFFSET':
    case 'FETCH':
      frame.clause = 'limit';
      frame.awaitingAlias = false;
      break;
    case 'UPDATE':
      // FOR UPDATE (locking) and ON DUPLICATE KEY UPDATE are not statements.
      if (prev?.upper === 'FOR' || prev?.upper === 'KEY') break;
      frame.clause = 'update';
      frame.isStatement = true;
      frame.awaitingAlias = false;
      break;
    case 'SET':
      frame.clause = 'set';
      frame.awaitingAlias = false;
      break;
    case 'DELETE':
      frame.clause = 'delete';
      frame.isStatement = true;
      frame.awaitingAlias = false;
      break;
    case 'INSERT':
    case 'REPLACE':
      frame.clause = 'insert-into';
      frame.isStatement = true;
      frame.awaitingAlias = false;
      break;
    case 'INTO':
      frame.clause = 'insert-into';
      frame.awaitingAlias = false;
      break;
    case 'VALUES':
    case 'VALUE':
      frame.clause = 'values';
      frame.awaitingAlias = false;
      break;
    case 'AS':
      if (frame.clause === 'from' || frame.clause === 'join' || frame.clause === 'update') {
        frame.awaitingAlias = true;
      }
      break;
    case 'CASE':
      frame.caseSaved.push(frame.clause);
      frame.clause = 'case';
      frame.awaitingAlias = false;
      break;
    case 'END':
      frame.clause = frame.caseSaved.pop() ?? frame.clause;
      frame.awaitingAlias = false;
      break;
    case 'UNION':
    case 'INTERSECT':
    case 'EXCEPT':
    case 'MINUS':
      frame.clause = 'union';
      frame.awaitingAlias = false;
      break;
    case 'CREATE': frame.clause = 'create'; frame.awaitingAlias = false; break;
    case 'DROP': frame.clause = 'drop'; frame.awaitingAlias = false; break;
    case 'ALTER': frame.clause = 'alter'; frame.awaitingAlias = false; break;
    case 'TRUNCATE': frame.clause = 'truncate'; frame.awaitingAlias = false; break;
    case 'RETURNING': frame.clause = 'returning'; frame.awaitingAlias = false; break;
    case 'WITH': frame.clause = 'with'; frame.awaitingAlias = false; break;
    default:
      break;
  }
};

// Decides the clause of a new parenthesized frame from what precedes `(`.
const openFrameClause = (outer: Frame, prev: WordToken | null): SqlClause => {
  if (prev) {
    // `IN (` opens a value/subquery list.
    if (prev.upper === 'IN') return 'in-list';
    // `AS (` opens a CTE (or derived) body: a fresh statement scope.
    if (prev.upper === 'AS') return 'start';
    if (!prev.isKeyword) {
      // `INSERT INTO users (` opens the target column list.
      if (outer.clause === 'insert-into') return 'insert-columns';
      // Any other identifier directly before `(` reads as a function call.
      return 'function-args';
    }
  }
  // Expression group or subquery: inherit until a keyword (e.g. SELECT)
  // inside the parentheses says otherwise.
  return outer.clause;
};

/**
 * Analyzes the SQL text that precedes the cursor and reports the clause the
 * cursor sits in, plus string/comment/nesting state.
 *
 * Pass everything from the start of the buffer up to the cursor; statement
 * separators (`;`) reset the state, so previous statements cannot leak into
 * the current one.
 */
export const analyzeSqlContext = (textBeforeCursor: string): SqlContextInfo => {
  // The root frame is always a statement scope.
  let stack: Frame[] = [createFrame('start', 0, true)];
  let stringDelim: '\'' | null = null;
  let inLineComment = false;
  let inBlockComment = false;
  let prev: WordToken | null = null;
  let isAfterDot = false;

  const s = textBeforeCursor;
  const n = s.length;
  let i = 0;
  let wordStart = -1;

  const top = () => stack[stack.length - 1];

  const flushWord = (end: number): void => {
    if (wordStart < 0) return;
    const raw = s.slice(wordStart, end);
    const upper = raw.toUpperCase();
    wordStart = -1;
    const isKeyword = KEYWORDS.has(upper);
    if (isKeyword) {
      applyWord(top(), upper, prev);
    } else {
      recordIdentifier(top(), raw, isAfterDot);
    }
    isAfterDot = false;
    prev = { upper, isKeyword };
  };

  while (i < n) {
    const ch = s[i];

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && s[i + 1] === '/') { inBlockComment = false; i += 2; continue; }
      i++;
      continue;
    }
    if (stringDelim) {
      if (ch === '\\') { i += 2; continue; } // backslash escape (MySQL)
      if (ch === stringDelim) {
        if (s[i + 1] === stringDelim) { i += 2; continue; } // doubled-quote escape
        stringDelim = null;
      }
      i++;
      continue;
    }

    // Quoted identifiers are opaque single tokens; they count as identifiers
    // for the `identifier(`-detection but never as keywords.
    if (ch === '"' || ch === '`' || ch === '[') {
      flushWord(i);
      const close = ch === '[' ? ']' : ch;
      const start = i + 1;
      i++;
      while (i < n && s[i] !== close) i++;
      const raw = s.slice(start, i);
      if (i < n) i++; // skip the closing delimiter when present
      recordIdentifier(top(), raw, isAfterDot);
      isAfterDot = false;
      prev = { upper: raw.toUpperCase(), isKeyword: false };
      continue;
    }

    if (ch === '\'') { flushWord(i); stringDelim = '\''; prev = null; isAfterDot = false; i++; continue; }
    if (ch === '-' && s[i + 1] === '-') { flushWord(i); inLineComment = true; isAfterDot = false; i += 2; continue; }
    if (ch === '/' && s[i + 1] === '*') { flushWord(i); inBlockComment = true; isAfterDot = false; i += 2; continue; }

    if (isWordChar(ch)) {
      if (wordStart < 0) wordStart = i;
      i++;
      continue;
    }

    flushWord(i);

    if (ch === '(') {
      const nextClause = openFrameClause(top(), prev);
      const isSubStatement = nextClause === 'start';
      stack.push(createFrame(nextClause, i + 1, isSubStatement, top()));
      prev = null;
      isAfterDot = false;
    } else if (ch === ')') {
      if (stack.length > 1) stack.pop();
      prev = null;
      isAfterDot = false;
    } else if (ch === ';') {
      stack = [createFrame('start', i + 1, true)];
      prev = null;
      isAfterDot = false;
    } else if (ch === '.') {
      isAfterDot = true;
    } else if (/\s/.test(ch)) {
      // Whitespace keeps the previous word visible so
      // two-word keywords (GROUP BY) and `name (` detection keep working.
    } else {
      // Operators, commas, etc. end any identifier context.
      prev = null;
      isAfterDot = false;
    }
    i++;
  }

  flushWord(n);

  // Innermost frame that holds its own statement; the root always qualifies.
  let statementStart = 0;
  for (let f = stack.length - 1; f >= 0; f--) {
    if (stack[f].isStatement) {
      statementStart = stack[f].contentStart;
      break;
    }
  }

  const currentFrame = top();
  let resolvedLastTableRef: string | null = null;
  if (currentFrame.clause === 'on' || currentFrame.clause === 'using') {
    resolvedLastTableRef =
      currentFrame.currentJoinTableRef ?? currentFrame.lastTableRef ?? currentFrame.fromTableRef ?? null;
  } else {
    resolvedLastTableRef = currentFrame.fromTableRef ?? currentFrame.lastTableRef ?? null;
  }

  return {
    clause: currentFrame.clause,
    inString: stringDelim !== null,
    inComment: inLineComment || inBlockComment,
    nestingLevel: stack.length - 1,
    statementStart,
    lastTableRef: resolvedLastTableRef,
  };
};

/**
 * Finds where the statement scope that is open at `from` ends: the position
 * of its unmatched closing parenthesis, a top-level `;`, or the end of the
 * text. Used together with `SqlContextInfo.statementStart` to slice the
 * innermost subquery around the cursor out of the full buffer.
 */
export const findStatementScopeEnd = (text: string, from: number): number => {
  let depth = 0;
  let stringDelim: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;
  let i = from;
  const n = text.length;

  while (i < n) {
    const ch = text[i];

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && text[i + 1] === '/') { inBlockComment = false; i += 2; continue; }
      i++;
      continue;
    }
    if (stringDelim) {
      if (ch === '\\' && stringDelim === '\'') { i += 2; continue; }
      if (ch === stringDelim) {
        if (text[i + 1] === stringDelim) { i += 2; continue; }
        stringDelim = null;
      }
      i++;
      continue;
    }

    if (ch === '\'' || ch === '"' || ch === '`') { stringDelim = ch; i++; continue; }
    if (ch === '-' && text[i + 1] === '-') { inLineComment = true; i += 2; continue; }
    if (ch === '/' && text[i + 1] === '*') { inBlockComment = true; i += 2; continue; }

    if (ch === '(') depth++;
    else if (ch === ')') {
      if (depth === 0) return i;
      depth--;
    } else if (ch === ';' && depth === 0) {
      return i;
    }
    i++;
  }
  return n;
};
