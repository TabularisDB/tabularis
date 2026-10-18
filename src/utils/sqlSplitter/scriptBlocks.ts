// GoogleSQL (BigQuery) procedural-block tracker. The splitter feeds it
// every word and punctuation character outside strings and comments;
// while a block is open, a `;` is part of the script, not a statement
// boundary.
//
// Only words in a statement position open a block, because BEGIN,
// LOOP, WHILE and REPEAT are not reserved in GoogleSQL and may be
// column names, and IF/REPEAT are also functions (`IF(c, a, b)`).
// A statement position is the start of a statement, the position after
// a `;` inside a block, or after BEGIN, THEN, ELSE, DO, LOOP or REPEAT.
// `BEGIN` also opens a block right after a `CREATE … PROCEDURE` header.

import type { DialectOptions } from './index';

type BlockKind =
  | 'BEGIN'
  | 'IF'
  | 'LOOP'
  | 'WHILE'
  | 'REPEAT'
  | 'FOR'
  | 'CASE_STMT'
  | 'CASE_EXPR';

export interface ScriptBlockState {
  readonly stack: BlockKind[];
  /** The next word starts a statement. */
  statementStart: boolean;
  /** First word of the current statement, upper-cased. */
  leadingWord: string;
  /** A `CREATE … PROCEDURE` header was seen; its body BEGIN is next. */
  awaitingProcedureBody: boolean;
  parenDepth: number;
}

const WORD_RE = /[A-Za-z_][A-Za-z0-9_]*/y;
const WORD_CHAR_RE = /[A-Za-z0-9_]/;

/** Characters that make the following word a member or parameter name. */
const NAME_PREFIX_RE = /[A-Za-z0-9_.@$`]/;

/** `END <word>` closers, keyed by the block they close. */
const END_FOLLOWERS: Readonly<Partial<Record<BlockKind, string>>> = {
  IF: 'IF',
  LOOP: 'LOOP',
  WHILE: 'WHILE',
  REPEAT: 'REPEAT',
  FOR: 'FOR',
  CASE_STMT: 'CASE',
};

export function createScriptBlockState(): ScriptBlockState {
  return {
    stack: [],
    statementStart: true,
    leadingWord: '',
    awaitingProcedureBody: false,
    parenDepth: 0,
  };
}

/** True while a `;` belongs to an open block. */
export function isInsideBlock(state: ScriptBlockState): boolean {
  return state.stack.length > 0;
}

/** A `;` was consumed: inside a block it starts the next statement. */
export function onStatementDelimiter(state: ScriptBlockState): void {
  state.statementStart = true;
  state.leadingWord = '';
  state.awaitingProcedureBody = false;
  state.parenDepth = 0;
}

/** Reset after a top-level statement boundary. */
export function resetScriptBlockState(state: ScriptBlockState): void {
  state.stack.length = 0;
  onStatementDelimiter(state);
}

/** Feed a non-word code character (punctuation, operator, string). */
export function onScriptPunctuation(state: ScriptBlockState, ch: string): void {
  if (ch === '(') state.parenDepth++;
  else if (ch === ')') state.parenDepth = Math.max(0, state.parenDepth - 1);
  state.statementStart = false;
}

/**
 * When `position` starts a word, update `state` and return the number of
 * characters consumed (the word, plus the `IF`/`LOOP`/... of an `END IF`
 * closer or the `:` of a label). Returns 0 when no word starts here.
 */
export function scanScriptWord(
  source: string,
  position: number,
  options: DialectOptions,
  state: ScriptBlockState,
): number {
  if (position > 0 && WORD_CHAR_RE.test(source[position - 1])) return 0;
  WORD_RE.lastIndex = position;
  const match = WORD_RE.exec(source);
  if (!match) return 0;
  const length = match[0].length;

  // `t.end`, `@begin`, `$x`: a field, parameter or system variable name.
  if (position > 0 && NAME_PREFIX_RE.test(source[position - 1])) {
    state.statementStart = false;
    return length;
  }

  const word = match[0].toUpperCase();
  const atStart = state.statementStart;
  if (atStart && state.leadingWord === '') state.leadingWord = word;
  const top = state.stack[state.stack.length - 1];

  switch (word) {
    case 'BEGIN': {
      const opens =
        (atStart ||
          (state.awaitingProcedureBody && state.parenDepth === 0)) &&
        !beginsTransaction(source, position + length, options);
      if (opens) {
        state.stack.push('BEGIN');
        state.awaitingProcedureBody = false;
      }
      state.statementStart = opens;
      return length;
    }
    case 'END': {
      if (top !== undefined) {
        state.stack.pop();
        const follower = END_FOLLOWERS[top];
        if (follower !== undefined) {
          const next = peekWord(source, position + length, options);
          if (next !== null && next.word === follower) {
            state.statementStart = false;
            return next.end - position;
          }
        }
      }
      state.statementStart = false;
      return length;
    }
    case 'IF':
    case 'WHILE':
    case 'FOR':
      if (atStart) state.stack.push(word as BlockKind);
      state.statementStart = false;
      return length;
    case 'LOOP':
    case 'REPEAT':
      if (atStart) state.stack.push(word as BlockKind);
      state.statementStart = atStart;
      return length;
    case 'CASE':
      state.stack.push(atStart ? 'CASE_STMT' : 'CASE_EXPR');
      state.statementStart = false;
      return length;
    case 'THEN':
    case 'ELSE':
      state.statementStart = top !== undefined && top !== 'CASE_EXPR';
      return length;
    case 'DO':
      state.statementStart = top === 'WHILE' || top === 'FOR';
      return length;
    case 'PROCEDURE':
      if (state.leadingWord === 'CREATE') state.awaitingProcedureBody = true;
      state.statementStart = false;
      return length;
    default: {
      // `label: LOOP` / `label: BEGIN` keeps the statement position.
      if (atStart) {
        const colon = skipTrivia(source, position + length, options);
        if (source[colon] === ':') {
          state.leadingWord = '';
          return colon + 1 - position;
        }
      }
      state.statementStart = false;
      return length;
    }
  }
}

/** `BEGIN;`, `BEGIN TRANSACTION` and a trailing `BEGIN` start a transaction. */
function beginsTransaction(
  source: string,
  position: number,
  options: DialectOptions,
): boolean {
  const next = skipTrivia(source, position, options);
  if (next >= source.length || source[next] === ';') return true;
  const word = peekWord(source, position, options);
  return word !== null && word.word === 'TRANSACTION';
}

function peekWord(
  source: string,
  position: number,
  options: DialectOptions,
): { word: string; end: number } | null {
  const start = skipTrivia(source, position, options);
  WORD_RE.lastIndex = start;
  const match = WORD_RE.exec(source);
  if (!match) return null;
  return { word: match[0].toUpperCase(), end: start + match[0].length };
}

function skipTrivia(
  source: string,
  position: number,
  options: DialectOptions,
): number {
  let p = position;
  for (;;) {
    while (p < source.length && /\s/.test(source[p])) p++;
    const isLineComment =
      (options.lineComments && source.startsWith('--', p)) ||
      (options.hashComments && source[p] === '#');
    if (isLineComment) {
      while (p < source.length && source[p] !== '\n') p++;
      continue;
    }
    if (options.blockComments && source.startsWith('/*', p)) {
      const close = source.indexOf('*/', p + 2);
      p = close === -1 ? source.length : close + 2;
      continue;
    }
    return p;
  }
}
