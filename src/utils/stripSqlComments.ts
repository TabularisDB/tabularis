// Removes ordinary SQL comments from a statement while leaving every
// string literal, quoted identifier, dollar-quoted body, optimizer hint
// and executable comment intact. Reuses the splitter's tokenizer so the
// quote/comment dialect rules stay defined in exactly one place.

import {
  dialectOptions,
  type Dialect,
  type DialectOptions,
} from './sqlSplitter';
import { scanToken, type TokenizerState } from './sqlSplitter/tokenizer';

const DIALECTS: ReadonlySet<string> = new Set<Dialect>([
  'postgres',
  'mysql',
  'mssql',
  'sqlite',
  'oracle',
  'generic',
]);

function isExecutableBlockComment(
  source: string,
  position: number,
  options: DialectOptions,
): boolean {
  // `/*! ... */` arrives as a `data` token (see scanToken), so only the
  // MariaDB `/*M! ... */` form reaches here as a `blockComment`; both are
  // run by the server, so they are executable SQL, not strippable noise.
  return options.executableComments && source.startsWith('/*M!', position);
}

/**
 * Return `sql` with its line and block comments removed. Executable
 * comments (`/*!` and MariaDB's `/*M!`) are kept because the server runs
 * them. A removed comment between two non-whitespace characters is
 * replaced with a single space so neighbouring tokens do not merge.
 *
 * When `dialect` is undefined or unknown the input is returned unchanged
 * instead of guessing a dialect: lexing with the wrong quote rules can
 * mistake SQL for a string or comment and strip real code. Pass an
 * explicit `'generic'` for the ANSI-ish fallback rules.
 */
export function stripSqlComments(
  sql: string,
  dialect?: Dialect | string,
): string {
  if (dialect === undefined || !DIALECTS.has(dialect)) return sql;

  const options = dialectOptions(dialect as Dialect);
  const state: TokenizerState = { delimiter: ';', lineLeading: true };
  let position = 0;
  let out = '';

  while (position < sql.length) {
    const token = scanToken(sql, position, options, state);
    if (token === null) break;

    const end = position + token.length;
    const strip =
      token.kind === 'lineComment' ||
      (token.kind === 'blockComment' &&
        !isExecutableBlockComment(sql, position, options));

    if (strip) {
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

  return out;
}
