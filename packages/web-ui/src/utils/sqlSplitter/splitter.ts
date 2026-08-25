// Statement splitter:
//   1. collectSegments — walk tokens, partition source by delimiter into
//      raw segments with a hasMeaningful flag.
//   2. foldBlocks — for Oracle-like dialects, merge PL/SQL source units
//      until the next slash-terminated segment.
//   3. foldComments — apply fold rule:
//      (a) leading comment-only segment(s) → prepended to NEXT meaningful;
//      (b) trailing comment-only segment(s) → appended to PREVIOUS;
//      (c) entirely comment-only input → drop, return [].

import {
  EXPLAINABLE_KEYWORDS,
  RESULT_SET_KEYWORDS,
  leadingKeyword,
} from './classify';
import type { DialectOptions, Statement } from './index';
import type { TokenizerState } from './tokenizer';
import { scanToken } from './tokenizer';

interface RawSegment {
  readonly start: number;
  readonly end: number;
  readonly hasMeaningful: boolean;
  readonly terminator: SegmentTerminator;
}

type SegmentTerminator =
  | 'delimiter'
  | 'goDelimiter'
  | 'slashDelimiter'
  | 'setDelimiter'
  | 'eof';

interface Span {
  readonly start: number;
  readonly end: number;
}

interface FoldedGroup {
  readonly spans: ReadonlyArray<Span>;
  readonly meaningful: Span;
}

const MAX_LEADING_TOKENS = 12;
const WORD_RE = /[A-Za-z_][A-Za-z0-9_$#]*/y;

export function splitInto(sql: string, options: DialectOptions): Statement[] {
  if (sql.length === 0) return [];
  const segments = collectSegments(sql, options);
  const foldedBlocks = options.plsqlBlocks ? foldBlocks(sql, segments) : segments;
  const folded = foldComments(foldedBlocks);
  return folded.map((group) => buildStatement(sql, group));
}

function collectSegments(sql: string, options: DialectOptions): RawSegment[] {
  const state: TokenizerState = { delimiter: ';', lineLeading: true };
  const segments: RawSegment[] = [];
  let segStart = 0;
  let hasMeaningful = false;
  let position = 0;

  const pushSegment = (end: number, terminator: SegmentTerminator): void => {
    if (end <= segStart) return;
    segments.push({ start: segStart, end, hasMeaningful, terminator });
  };

  while (position < sql.length) {
    const token = scanToken(sql, position, options, state);
    if (token === null) break;

    switch (token.kind) {
      case 'delimiter':
      case 'goDelimiter':
      case 'slashDelimiter':
        pushSegment(position, token.kind);
        position += token.length;
        segStart = position;
        hasMeaningful = false;
        state.lineLeading = false;
        break;
      case 'setDelimiter':
        pushSegment(position, token.kind);
        position += token.length;
        segStart = position;
        hasMeaningful = false;
        if (token.value !== undefined) state.delimiter = token.value;
        state.lineLeading = false;
        break;
      case 'string':
      case 'data':
        hasMeaningful = true;
        position += token.length;
        state.lineLeading = false;
        break;
      case 'lineComment':
      case 'blockComment':
        position += token.length;
        state.lineLeading = false;
        break;
      case 'eoln':
        position += token.length;
        state.lineLeading = true;
        break;
      case 'whitespace':
        position += token.length;
        break;
    }
  }

  pushSegment(sql.length, 'eof');
  return segments;
}

function foldBlocks(
  sql: string,
  segments: ReadonlyArray<RawSegment>,
): RawSegment[] {
  const output: RawSegment[] = [];
  let index = 0;

  while (index < segments.length) {
    const segment = segments[index];
    if (!segment.hasMeaningful || !isPlsqlBlockOpener(sql, segment)) {
      output.push(segment);
      index++;
      continue;
    }

    let endIndex = index;
    while (
      endIndex < segments.length &&
      segments[endIndex].terminator !== 'slashDelimiter'
    ) {
      endIndex++;
    }

    const foldedToEof = endIndex >= segments.length;
    if (foldedToEof) {
      endIndex = segments.length - 1;
    }

    const endSegment = segments[endIndex];
    output.push({
      start: segment.start,
      end: foldedToEof ? sql.length : endSegment.end,
      hasMeaningful: true,
      terminator: endSegment.terminator,
    });
    index = endIndex + 1;
  }

  return output;
}

function isPlsqlBlockOpener(sql: string, segment: RawSegment): boolean {
  const tokens = leadingSignificantTokens(sql, segment.start, segment.end);
  let index = 0;
  while (tokens[index] === '<<') {
    const labelEnd = tokens.indexOf('>>', index + 1);
    if (labelEnd === -1) break;
    index = labelEnd + 1;
  }

  const first = tokens[index];
  if (first === 'DECLARE' || first === 'BEGIN') return true;
  if (first === 'WITH') return isWithBlockOpener(tokens, index + 1);
  if (first !== 'CREATE') return false;
  return isCreateBlockOpener(tokens, index + 1);
}

function isWithBlockOpener(
  tokens: ReadonlyArray<string>,
  index: number,
): boolean {
  const kind = tokens[index];
  if (kind !== 'FUNCTION' && kind !== 'PROCEDURE') return false;
  const next = tokens[index + 1];
  return next !== 'AS' && next !== '(';
}

function isCreateBlockOpener(
  tokens: ReadonlyArray<string>,
  startIndex: number,
): boolean {
  let index = startIndex;
  if (tokens[index] === 'OR' && tokens[index + 1] === 'REPLACE') {
    index += 2;
  }
  if (
    tokens[index] === 'EDITIONABLE' ||
    tokens[index] === 'NONEDITIONABLE'
  ) {
    index++;
  }
  if (tokens[index] === 'AND' && isJavaCompileOption(tokens[index + 1])) {
    index += 2;
  }
  if (tokens[index] === 'NOFORCE') {
    index++;
  }

  const kind = tokens[index];
  const next = tokens[index + 1];
  switch (kind) {
    case 'FUNCTION':
    case 'PROCEDURE':
    case 'TRIGGER':
      return true;
    case 'LIBRARY':
      return false;
    case 'PACKAGE':
    case 'CLASS':
      return next !== undefined;
    case 'TYPE':
      return next === 'BODY';
    case 'JAVA':
      return next === 'SOURCE' || next === 'CLASS' || next === 'RESOURCE';
    default:
      return false;
  }
}

function isJavaCompileOption(token: string | undefined): boolean {
  return token === 'COMPILE' || token === 'RESOLVE';
}

function leadingSignificantTokens(
  source: string,
  start: number,
  end: number,
): string[] {
  const tokens: string[] = [];
  let position = start;

  while (position < end && tokens.length < MAX_LEADING_TOKENS) {
    const next = skipTrivia(source, position, end);
    if (next >= end) break;
    position = next;

    if (source.startsWith('<<', position)) {
      tokens.push('<<');
      position += 2;
      continue;
    }
    if (source.startsWith('>>', position)) {
      tokens.push('>>');
      position += 2;
      continue;
    }

    const ch = source[position];
    if (ch === '(') {
      tokens.push('(');
      position++;
      continue;
    }

    WORD_RE.lastIndex = position;
    const word = WORD_RE.exec(source);
    if (word) {
      tokens.push(word[0].toUpperCase());
      position += word[0].length;
      continue;
    }

    position++;
  }

  return tokens;
}

function skipTrivia(source: string, position: number, end: number): number {
  let p = position;
  for (;;) {
    while (p < end && isAsciiSpace(source.charCodeAt(p))) p++;
    if (source.startsWith('--', p)) {
      p += 2;
      while (p < end && source[p] !== '\n') p++;
      continue;
    }
    if (source.startsWith('/*', p)) {
      p += 2;
      while (p + 1 < end) {
        if (source[p] === '*' && source[p + 1] === '/') {
          p += 2;
          break;
        }
        p++;
      }
      continue;
    }
    return p;
  }
}

function foldComments(segments: ReadonlyArray<RawSegment>): FoldedGroup[] {
  const output: { spans: Span[]; meaningful: Span }[] = [];
  let pending: Span[] = [];

  for (const seg of segments) {
    const span: Span = { start: seg.start, end: seg.end };
    if (seg.hasMeaningful) {
      output.push({ spans: [...pending, span], meaningful: span });
      pending = [];
    } else {
      pending = [...pending, span];
    }
  }

  if (pending.length > 0 && output.length > 0) {
    const lastIndex = output.length - 1;
    const last = output[lastIndex];
    output[lastIndex] = {
      spans: [...last.spans, ...pending],
      meaningful: last.meaningful,
    };
  }

  return output;
}

function buildStatement(sql: string, group: FoldedGroup): Statement {
  const text = group.spans
    .map((s) => sql.slice(s.start, s.end))
    .join('')
    .trim();
  const keyword = leadingKeyword(text);
  const [start, end] = trimRange(sql, group.meaningful.start, group.meaningful.end);
  return {
    text,
    range: { start, end },
    isSelect: keyword === 'SELECT',
    returnsResultSet: RESULT_SET_KEYWORDS.has(keyword),
    isExplainable: EXPLAINABLE_KEYWORDS.has(keyword),
  };
}

function trimRange(sql: string, start: number, end: number): [number, number] {
  while (start < end && isAsciiSpace(sql.charCodeAt(start))) start++;
  while (end > start && isAsciiSpace(sql.charCodeAt(end - 1))) end--;
  return [start, end];
}

function isAsciiSpace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13;
}
