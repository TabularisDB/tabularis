// Pure single-token scanner. Stateless aside from the small `TokenizerState`
// (current delimiter + lineLeading flag) that the splitter owns and mutates.

import type { DialectOptions, QuoteRule, Token } from './index';

export interface TokenizerState {
  delimiter: string;
  lineLeading: boolean;
}

const IDENT_CHAR_RE = /[A-Za-z0-9_]/;

export function scanToken(
  source: string,
  position: number,
  options: DialectOptions,
  state: TokenizerState,
): Token | null {
  if (position >= source.length) return null;

  if (
    state.delimiter.length > 0 &&
    source.startsWith(state.delimiter, position)
  ) {
    return { kind: 'delimiter', length: state.delimiter.length };
  }

  const ch = source[position];

  if (ch === '\n') return { kind: 'eoln', length: 1 };
  if (ch === ' ' || ch === '\t' || ch === '\r') {
    return { kind: 'whitespace', length: 1 };
  }

  if (options.lineComments && ch === '-' && source[position + 1] === '-') {
    // MySQL/MariaDB require a whitespace (or EOF) after `--` for it to
    // be a comment; otherwise it is the binary subtraction operator
    // (e.g. `SELECT 1--1` → 2). Other dialects accept `--` regardless.
    if (options.lineCommentRequiresSpace) {
      const after = source[position + 2];
      if (
        after !== undefined &&
        after !== ' ' &&
        after !== '\t' &&
        after !== '\n' &&
        after !== '\r'
      ) {
        return { kind: 'data', length: 1 };
      }
    }
    let end = position + 2;
    while (end < source.length && source[end] !== '\n') end++;
    return { kind: 'lineComment', length: end - position };
  }

  if (options.blockComments && ch === '/' && source[position + 1] === '*') {
    const length = scanBlockCommentLength(
      source,
      position,
      options.nestedBlockComments,
    );
    // MySQL/MariaDB conditional comment `/*! ... */` is executable SQL,
    // not a noop comment. Emit as `data` so it is treated as meaningful
    // by the splitter and gets its own statement boundary.
    const isExecutable =
      options.executableComments && source[position + 2] === '!';
    return { kind: isExecutable ? 'data' : 'blockComment', length };
  }

  if (
    options.eString &&
    (ch === 'E' || ch === 'e') &&
    source[position + 1] === "'" &&
    !isIdentBoundary(source, position - 1)
  ) {
    return scanEString(source, position);
  }

  if (options.dollarQuoting && ch === '$') {
    const dollarToken = scanDollarQuoted(source, position);
    if (dollarToken) return dollarToken;
  }

  if (
    options.qQuoting &&
    (ch === 'Q' || ch === 'q' || ch === 'N' || ch === 'n')
  ) {
    const qQuoteToken = scanQQuoted(source, position);
    if (qQuoteToken) return qQuoteToken;
  }

  for (const rule of options.quotes) {
    if (source.startsWith(rule.open, position)) {
      return scanQuoted(source, position, rule);
    }
  }

  if (state.lineLeading) {
    if (
      options.customDelimiter &&
      matchesKeyword(source, position, 'DELIMITER')
    ) {
      const token = readCustomDelimiter(source, position);
      if (token) return token;
    }
    if (options.goDelimiter && matchesKeyword(source, position, 'GO')) {
      const token = readGoDelimiter(source, position);
      if (token) return token;
    }
    if (options.slashDelimiter && ch === '/') {
      const token = readSlashDelimiter(source, position);
      if (token) return token;
    }
  }

  return { kind: 'data', length: 1 };
}

function isIdentBoundary(source: string, prevIndex: number): boolean {
  if (prevIndex < 0) return false;
  return IDENT_CHAR_RE.test(source[prevIndex]);
}

function scanBlockCommentLength(
  source: string,
  position: number,
  nested: boolean,
): number {
  let depth = 1;
  let p = position + 2;
  while (p + 1 < source.length) {
    if (nested && source[p] === '/' && source[p + 1] === '*') {
      depth++;
      p += 2;
      continue;
    }
    if (source[p] === '*' && source[p + 1] === '/') {
      depth--;
      p += 2;
      if (depth === 0) return p - position;
      continue;
    }
    p++;
  }
  return source.length - position;
}

function scanQuoted(
  source: string,
  position: number,
  rule: QuoteRule,
): Token {
  const start = position;
  let p = position + rule.open.length;
  while (p < source.length) {
    if (
      rule.escape !== undefined &&
      source[p] === rule.escape &&
      p + 1 < source.length
    ) {
      p += 2;
      continue;
    }
    if (source.startsWith(rule.close, p)) {
      if (
        rule.doubleClose &&
        source.startsWith(rule.close, p + rule.close.length)
      ) {
        p += rule.close.length * 2;
        continue;
      }
      return { kind: 'string', length: p + rule.close.length - start };
    }
    p++;
  }
  return { kind: 'string', length: source.length - start };
}

function scanEString(source: string, position: number): Token {
  let p = position + 2;
  while (p < source.length) {
    if (source[p] === '\\' && p + 1 < source.length) {
      p += 2;
      continue;
    }
    if (source[p] === "'") {
      if (source[p + 1] === "'") {
        p += 2;
        continue;
      }
      return { kind: 'string', length: p + 1 - position };
    }
    p++;
  }
  return { kind: 'string', length: source.length - position };
}

const DOLLAR_TAG_RE = /\$([A-Za-z0-9_]*)\$/y;

function scanDollarQuoted(source: string, position: number): Token | null {
  DOLLAR_TAG_RE.lastIndex = position;
  const match = DOLLAR_TAG_RE.exec(source);
  if (!match) return null;
  const tag = match[0];
  let p = position + tag.length;
  while (p < source.length) {
    if (source.startsWith(tag, p)) {
      return { kind: 'string', length: p + tag.length - position };
    }
    p++;
  }
  return { kind: 'string', length: source.length - position };
}

function scanQQuoted(source: string, position: number): Token | null {
  const prevIndex = position - 1;
  if (isIdentBoundary(source, prevIndex)) return null;

  let prefixLength = 0;
  const ch = source[position];
  const next = source[position + 1];
  const third = source[position + 2];
  if ((ch === 'Q' || ch === 'q') && next === "'") {
    prefixLength = 2;
  } else if (
    (ch === 'N' || ch === 'n') &&
    (next === 'Q' || next === 'q') &&
    third === "'"
  ) {
    prefixLength = 3;
  } else {
    return null;
  }

  const delimiterPosition = position + prefixLength;
  if (delimiterPosition >= source.length) return null;
  const openCodePoint = source.codePointAt(delimiterPosition);
  if (openCodePoint === undefined) return null;

  const openDelimiter = String.fromCodePoint(openCodePoint);
  if (isQQuoteWhitespaceDelimiter(openDelimiter)) return null;
  const openLength = openCodePoint > 0xffff ? 2 : 1;
  const closeDelimiter = qQuoteCloseDelimiter(openDelimiter);
  let p = delimiterPosition + openLength;

  while (p < source.length) {
    if (
      source.startsWith(closeDelimiter, p) &&
      source[p + closeDelimiter.length] === "'"
    ) {
      return {
        kind: 'string',
        length: p + closeDelimiter.length + 1 - position,
      };
    }
    const codePoint = source.codePointAt(p);
    p += codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
  }

  return { kind: 'string', length: source.length - position };
}

function isQQuoteWhitespaceDelimiter(delimiter: string): boolean {
  return (
    delimiter === ' ' ||
    delimiter === '\t' ||
    delimiter === '\r' ||
    delimiter === '\n'
  );
}

function qQuoteCloseDelimiter(openDelimiter: string): string {
  switch (openDelimiter) {
    case '[':
      return ']';
    case '{':
      return '}';
    case '(':
      return ')';
    case '<':
      return '>';
    default:
      return openDelimiter;
  }
}

function matchesKeyword(
  source: string,
  position: number,
  word: string,
): boolean {
  if (position + word.length > source.length) return false;
  for (let i = 0; i < word.length; i++) {
    const c = source[position + i];
    if (c.toUpperCase() !== word[i]) return false;
  }
  const after = source[position + word.length];
  if (after !== undefined && IDENT_CHAR_RE.test(after)) return false;
  return true;
}

// DELIMITER directive: take only the first whitespace-terminated token
// so a trailing `-- comment` on the same line does not bleed into the
// new delimiter string.
const CUSTOM_DELIM_RE = /DELIMITER[ \t]+(\S+)/iy;

function readCustomDelimiter(source: string, position: number): Token | null {
  CUSTOM_DELIM_RE.lastIndex = position;
  const m = CUSTOM_DELIM_RE.exec(source);
  if (!m) return null;
  return { kind: 'setDelimiter', length: m[0].length, value: m[1] };
}

// `GO` with an optional repeat-count: `GO`, `GO 5`, `GO\t10`. Native
// sqlcmd / SSMS execute the preceding batch the given number of times.
// We treat all three as a single batch separator; the repeat count is
// discarded at this layer (re-running the batch is a runner concern
// outside the splitter).
const GO_RE = /GO(?:[ \t]+\d+)?[ \t\r]*(\n|$)/iy;

function readGoDelimiter(source: string, position: number): Token | null {
  GO_RE.lastIndex = position;
  const m = GO_RE.exec(source);
  if (!m) return null;
  const length = m[0].endsWith('\n') ? m[0].length - 1 : m[0].length;
  return { kind: 'goDelimiter', length };
}

const SLASH_RE = /\/[ \t\r]*(\n|$)/y;

function readSlashDelimiter(source: string, position: number): Token | null {
  SLASH_RE.lastIndex = position;
  const m = SLASH_RE.exec(source);
  if (!m) return null;
  const length = m[0].endsWith('\n') ? m[0].length - 1 : m[0].length;
  return { kind: 'slashDelimiter', length };
}
