// Removes ordinary SQL comments from a statement while leaving every
// string literal, quoted identifier, dollar-quoted body, optimizer hint
// and executable comment intact. Reuses the splitter's tokenizer so the
// quote/comment dialect rules stay defined in exactly one place.

import {
  dialectOptions,
  isDialect,
  type DialectInput,
  type DialectOptions,
} from './sqlSplitter';
import { scanToken, type TokenizerState } from './sqlSplitter/tokenizer';

/**
 * The lexing rules for `input`, or `undefined` when it declares no SQL
 * dialect: a resolved syntax with no `sql_syntax` and no `sql_dialect` or
 * only `generic` (unknown dialect names also load as `generic`), the name
 * `generic`, an unknown name, or nothing at all. Lexing with guessed quote
 * rules can mistake SQL for a string or comment and strip real code, so
 * those surfaces get no stripping.
 */
function declaredOptions(input: DialectInput): DialectOptions | undefined {
  if (typeof input === 'object') {
    return input.declared ||
      (input.dialect !== undefined && input.dialect !== 'generic')
      ? input.options
      : undefined;
  }
  return isDialect(input) && input !== 'generic'
    ? dialectOptions(input)
    : undefined;
}

/** Whether `stripSqlComments` strips anything for `input`. */
export function canStripSqlComments(input: DialectInput): boolean {
  return declaredOptions(input) !== undefined;
}

function isKeptBlockComment(
  source: string,
  position: number,
  options: DialectOptions,
): boolean {
  // Optimizer hints (`/*+ INDEX(t idx) */` on MySQL, Oracle and Postgres
  // with pg_hint_plan) change the plan, so they are kept in every dialect.
  if (source.startsWith('/*+', position)) return true;
  // `/*! ... */` arrives as a `data` token (see scanToken), so only the
  // MariaDB `/*M! ... */` form reaches here as a `blockComment`; both are
  // run by the server, so they are executable SQL, not strippable noise.
  return options.executableComments && source.startsWith('/*M!', position);
}

function isKeptLineComment(source: string, position: number): boolean {
  // Oracle's line form of an optimizer hint: `--+ FULL(t)`.
  return source.startsWith('--+', position);
}

/**
 * Return `sql` with its line and block comments removed. Optimizer hints
 * (`/*+` and `--+`) and executable comments (`/*!` and MariaDB's `/*M!`)
 * are kept. A removed comment between two non-whitespace characters is
 * replaced with a single space so neighbouring tokens do not merge, a
 * line that only held comments is dropped, and line endings are kept as
 * they were.
 *
 * `dialect` is a dialect name or a resolved syntax (`resolveSqlSyntax`).
 * When it declares no dialect (see `canStripSqlComments`) the input is
 * returned unchanged.
 */
export function stripSqlComments(sql: string, dialect?: DialectInput): string {
  const options = declaredOptions(dialect);
  if (options === undefined) return sql;

  const state: TokenizerState = { delimiter: ';', lineLeading: true };
  let position = 0;
  let out = '';
  // Where the current line starts in `out`, and whether a comment was
  // removed from it, to drop lines that only held comments.
  let lineStart = 0;
  let lineHadComment = false;
  const dropCommentOnlyLine = (): void => {
    if (lineHadComment && out.slice(lineStart).trim() === '') {
      out = out.slice(0, lineStart);
    }
  };

  while (position < sql.length) {
    const token = scanToken(sql, position, options, state);
    if (token === null) break;

    let end = position + token.length;
    const strip =
      (token.kind === 'lineComment' && !isKeptLineComment(sql, position)) ||
      (token.kind === 'blockComment' &&
        !isKeptBlockComment(sql, position, options));

    if (strip) {
      // A line comment runs up to `\n`, so on CRLF text it would also take
      // the `\r`; leave that to be copied with the line ending.
      if (token.kind === 'lineComment' && sql[end - 1] === '\r') end -= 1;
      lineHadComment = true;
      const prev = out.at(-1);
      const next = sql[end];
      if (
        prev !== undefined &&
        !/\s/.test(prev) &&
        next !== undefined &&
        !/\s/.test(next)
      ) {
        out += ' ';
      }
    } else if (token.kind === 'eoln') {
      dropCommentOnlyLine();
      if (out.length > lineStart || !lineHadComment) {
        out += sql.slice(position, end);
      }
      lineStart = out.length;
      lineHadComment = false;
    } else {
      out += sql.slice(position, end);
    }

    if (token.kind === 'eoln') {
      state.lineLeading = true;
    } else if (token.kind !== 'whitespace') {
      if (token.kind === 'setDelimiter' && token.value !== undefined) {
        state.delimiter = token.value;
      }
      state.lineLeading = false;
    }

    position = end;
  }

  dropCommentOnlyLine();
  return out;
}
