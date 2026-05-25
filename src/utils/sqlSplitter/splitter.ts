// Statement splitter. Two-pass:
//   1. collectSegments — walk tokens, partition source by delimiter into
//      raw segments with a hasMeaningful flag.
//   2. foldComments — apply fold rule:
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
}

interface Span {
  readonly start: number;
  readonly end: number;
}

interface FoldedGroup {
  readonly spans: ReadonlyArray<Span>;
  readonly meaningful: Span;
}

export function splitInto(sql: string, options: DialectOptions): Statement[] {
  if (sql.length === 0) return [];
  const segments = collectSegments(sql, options);
  const folded = foldComments(segments);
  return folded.map((group) => buildStatement(sql, group));
}

function collectSegments(sql: string, options: DialectOptions): RawSegment[] {
  const state: TokenizerState = { delimiter: ';', lineLeading: true };
  const segments: RawSegment[] = [];
  let segStart = 0;
  let hasMeaningful = false;
  let position = 0;

  const pushSegment = (end: number): void => {
    if (end <= segStart) return;
    segments.push({ start: segStart, end, hasMeaningful });
  };

  while (position < sql.length) {
    const token = scanToken(sql, position, options, state);
    if (token === null) break;

    switch (token.kind) {
      case 'delimiter':
      case 'goDelimiter':
        pushSegment(position);
        position += token.length;
        segStart = position;
        hasMeaningful = false;
        state.lineLeading = false;
        break;
      case 'setDelimiter':
        pushSegment(position);
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

  pushSegment(sql.length);
  return segments;
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
