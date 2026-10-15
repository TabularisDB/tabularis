// Collects the spans of string literals and comments so callers can
// treat everything inside them as data rather than SQL (issue #458).
// Reuses the splitter's tokenizer so the quote/comment dialect rules
// stay defined in exactly one place; the driver loop mirrors
// collectSegments in splitter.ts (same state updates), minus the
// statement bookkeeping.

import { scanToken, type TokenizerState } from './tokenizer';
import type { DialectOptions, NonCodeSpan } from './index';

/**
 * A region of source text queued for scanning. Executable-comment
 * payloads are queued here instead of being recursed into: a
 * pathological chain of `/*!` markers arrives as one giant data token
 * whose payload starts with another `/*!`, so native recursion would
 * grow the call stack linearly with input length and overflow at
 * roughly 15KB of pasted text.
 */
interface PendingRegion {
  readonly text: string;
  /** Offset of `text` within the original source. */
  readonly offset: number;
  /** How many executable-comment payloads enclose this region. */
  readonly depth: number;
  readonly state: TokenizerState;
}

// A real dump nests executable comments one or two levels deep;
// anything deeper is adversarial garbage. Past this depth the payload
// is left unscanned, degrading to "nothing masked" for that tail —
// the same fail-safe direction as the unknown-dialect fallback.
const MAX_EXECUTABLE_COMMENT_DEPTH = 8;

export function collectNonCodeSpans(
  source: string,
  options: DialectOptions,
): NonCodeSpan[] {
  const spans: NonCodeSpan[] = [];
  const pending: PendingRegion[] = [
    {
      text: source,
      offset: 0,
      depth: 0,
      state: { delimiter: ';', lineLeading: true },
    },
  ];

  while (pending.length > 0) {
    const region = pending.pop();
    if (region === undefined) break;
    const { text, offset, depth, state } = region;
    let position = 0;

    // Queues the payload of an executable comment (everything between
    // the opening marker of `headerLength` chars and the closing
    // star-slash, if present) for its own scan.
    const queuePayload = (
      tokenStart: number,
      tokenLength: number,
      headerLength: number,
    ): void => {
      const innerStart = tokenStart + headerLength;
      const closed = text.startsWith('*/', tokenStart + tokenLength - 2);
      const innerEnd = tokenStart + tokenLength - (closed ? 2 : 0);
      pending.push({
        text: text.slice(innerStart, innerEnd),
        offset: offset + innerStart,
        depth: depth + 1,
        state: { delimiter: state.delimiter, lineLeading: false },
      });
    };

    while (position < text.length) {
      const token = scanToken(text, position, options, state);
      if (token === null) break;

      switch (token.kind) {
        case 'string':
        case 'lineComment':
          spans.push({
            start: offset + position,
            end: offset + position + token.length,
          });
          state.lineLeading = false;
          break;
        case 'blockComment':
          // MariaDB executes `/*M! ... */` conditional comments (MySQL
          // proper skips them as plain comments), so a `:param` inside
          // may be real. Rescan the payload like `/*!` instead of
          // masking it wholesale; for MySQL proper this merely keeps
          // the pre-masking detection behavior inside a comment the
          // server ignores.
          if (
            options.executableComments &&
            text.startsWith('/*M!', position) &&
            depth < MAX_EXECUTABLE_COMMENT_DEPTH
          ) {
            queuePayload(position, token.length, 4);
          } else {
            spans.push({
              start: offset + position,
              end: offset + position + token.length,
            });
          }
          state.lineLeading = false;
          break;
        case 'data':
          // A multi-character data token is a MySQL executable comment
          // (`/*! ... */`, see scanToken): the server runs its payload,
          // so a `:param` inside it is real. Queue the payload for its
          // own scan of strings and comments instead of skipping it
          // wholesale.
          if (
            token.length > 1 &&
            text.startsWith('/*!', position) &&
            depth < MAX_EXECUTABLE_COMMENT_DEPTH
          ) {
            queuePayload(position, token.length, 3);
          }
          state.lineLeading = false;
          break;
        case 'setDelimiter':
          if (token.value !== undefined) state.delimiter = token.value;
          state.lineLeading = false;
          break;
        case 'delimiter':
        case 'goDelimiter':
        case 'slashDelimiter':
          state.lineLeading = false;
          break;
        case 'eoln':
          state.lineLeading = true;
          break;
        case 'whitespace':
          break;
      }

      // Every token advances the cursor, whatever its kind — a kind
      // that skipped this line would loop forever.
      position += token.length;
    }
  }

  // Queued payload regions are scanned after the rest of their parent
  // region, so their spans arrive out of document order; consumers
  // (e.g. a left-to-right mask builder) rely on sorted spans.
  spans.sort((a, b) => a.start - b.start);
  return spans;
}
