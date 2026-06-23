import { splitInto } from './splitter';

export type Dialect =
  | 'postgres'
  | 'mysql'
  | 'mssql'
  | 'sqlite'
  | 'oracle'
  | 'generic';

/**
 * String-index span (JavaScript UTF-16 code unit offsets) of a
 * statement in the original source. ASCII leading and trailing
 * whitespace is excluded, and comment-only segments that were folded
 * into adjacent statements by the splitter are NOT covered (only the
 * meaningful segment's bounds are reported).
 *
 * What is still included in the range: any leading or trailing
 * comments that live inside the meaningful segment itself, e.g. the
 * `-- header` in `-- header\nSELECT 1;`. Consumers that need a
 * strictly comment-free range should re-strip via
 * `stripLeadingComments` (and a future trailing-comment helper) on
 * the slice they get from this range.
 *
 * Note: these are JS string indices, not byte offsets. Callers that
 * need byte positions (e.g. a Rust backend) must re-encode.
 */
export interface StatementRange {
  readonly start: number;
  readonly end: number;
}

export interface Statement {
  readonly text: string;
  readonly range: StatementRange;
  readonly isSelect: boolean;
  readonly returnsResultSet: boolean;
  readonly isExplainable: boolean;
}

export type TokenKind =
  | 'whitespace'
  | 'eoln'
  | 'lineComment'
  | 'blockComment'
  | 'string'
  | 'delimiter'
  | 'setDelimiter'
  | 'goDelimiter'
  | 'slashDelimiter'
  | 'data';

export interface Token {
  readonly kind: TokenKind;
  readonly length: number;
  readonly value?: string;
}

export interface QuoteRule {
  readonly open: string;
  readonly close: string;
  readonly escape?: string;
  readonly doubleClose: boolean;
}

export interface DialectOptions {
  readonly quotes: ReadonlyArray<QuoteRule>;
  readonly eString: boolean;
  readonly dollarQuoting: boolean;
  readonly customDelimiter: boolean;
  readonly goDelimiter: boolean;
  readonly slashDelimiter: boolean;
  readonly plsqlBlocks: boolean;
  readonly qQuoting: boolean;
  readonly lineComments: boolean;
  readonly blockComments: boolean;
  /**
   * Treat MySQL/MariaDB conditional comments (the ones opening with
   * `/*!`) as meaningful statements instead of noop comments. The
   * server evaluates them when the embedded version directive
   * permits; dump scripts rely on them being emitted as their own
   * statement so individual driver calls execute them.
   */
  readonly executableComments: boolean;
  /**
   * Allow block comments to nest, as PostgreSQL does. With this off,
   * the first closing block-comment marker ends the comment; with it
   * on, the scanner tracks depth and only ends at the matching
   * outermost marker.
   */
  readonly nestedBlockComments: boolean;
  /**
   * MySQL/MariaDB require `--` to be followed by whitespace (or
   * end-of-line) to be recognised as a line comment, otherwise it is
   * the binary subtraction operator (e.g. `SELECT 1--1` evaluates to
   * `2`). PostgreSQL, MSSQL, SQLite and Oracle accept `--` regardless
   * of what follows.
   */
  readonly lineCommentRequiresSpace: boolean;
}

const STANDARD_QUOTES: ReadonlyArray<QuoteRule> = [
  { open: "'", close: "'", doubleClose: true },
  { open: '"', close: '"', doubleClose: true },
];

const POSTGRES: DialectOptions = {
  quotes: STANDARD_QUOTES,
  eString: true,
  dollarQuoting: true,
  customDelimiter: false,
  goDelimiter: false,
  slashDelimiter: false,
  plsqlBlocks: false,
  qQuoting: false,
  lineComments: true,
  blockComments: true,
  executableComments: false,
  nestedBlockComments: true,
  lineCommentRequiresSpace: false,
};

const MYSQL: DialectOptions = {
  quotes: [
    { open: "'", close: "'", escape: '\\', doubleClose: true },
    { open: '"', close: '"', escape: '\\', doubleClose: true },
    { open: '`', close: '`', doubleClose: true },
  ],
  eString: false,
  dollarQuoting: false,
  customDelimiter: true,
  goDelimiter: false,
  slashDelimiter: false,
  plsqlBlocks: false,
  qQuoting: false,
  lineComments: true,
  blockComments: true,
  executableComments: true,
  nestedBlockComments: false,
  lineCommentRequiresSpace: true,
};

const MSSQL: DialectOptions = {
  quotes: [
    { open: "'", close: "'", doubleClose: true },
    // T-SQL: `]]` inside `[...]` is the literal `]` escape.
    { open: '[', close: ']', doubleClose: true },
  ],
  eString: false,
  dollarQuoting: false,
  customDelimiter: false,
  goDelimiter: true,
  slashDelimiter: false,
  plsqlBlocks: false,
  qQuoting: false,
  lineComments: true,
  blockComments: true,
  executableComments: false,
  nestedBlockComments: false,
  lineCommentRequiresSpace: false,
};

const SQLITE: DialectOptions = {
  quotes: [
    { open: "'", close: "'", doubleClose: true },
    { open: '"', close: '"', doubleClose: true },
    { open: '`', close: '`', doubleClose: true },
    { open: '[', close: ']', doubleClose: false },
  ],
  eString: false,
  dollarQuoting: false,
  customDelimiter: false,
  goDelimiter: false,
  slashDelimiter: false,
  plsqlBlocks: false,
  qQuoting: false,
  lineComments: true,
  blockComments: true,
  executableComments: false,
  nestedBlockComments: false,
  lineCommentRequiresSpace: false,
};

const ORACLE: DialectOptions = {
  quotes: STANDARD_QUOTES,
  eString: false,
  dollarQuoting: false,
  customDelimiter: false,
  goDelimiter: false,
  slashDelimiter: true,
  plsqlBlocks: true,
  qQuoting: true,
  lineComments: true,
  blockComments: true,
  executableComments: false,
  nestedBlockComments: false,
  lineCommentRequiresSpace: false,
};

const GENERIC: DialectOptions = {
  quotes: STANDARD_QUOTES,
  eString: false,
  dollarQuoting: false,
  customDelimiter: false,
  goDelimiter: false,
  slashDelimiter: false,
  plsqlBlocks: false,
  qQuoting: false,
  lineComments: true,
  blockComments: true,
  executableComments: false,
  nestedBlockComments: false,
  lineCommentRequiresSpace: false,
};

const DIALECT_TABLE: Readonly<Record<Dialect, DialectOptions>> = {
  postgres: POSTGRES,
  mysql: MYSQL,
  mssql: MSSQL,
  sqlite: SQLITE,
  oracle: ORACLE,
  generic: GENERIC,
};

/**
 * Look up the option preset for a dialect. Strictly typed — pass a
 * `Dialect`. If you have an unvalidated string (e.g. a plugin manifest
 * value passed through serde), normalize it at the call site or rely on
 * the public `splitStatements` / `splitQueries` entry points which do
 * that normalization for you.
 */
export function dialectOptions(dialect: Dialect): DialectOptions {
  return DIALECT_TABLE[dialect];
}

function normalizeDialect(dialect: Dialect | string | undefined): Dialect {
  if (dialect === undefined) return 'postgres';
  return dialect in DIALECT_TABLE ? (dialect as Dialect) : 'generic';
}

/**
 * Split a SQL source into per-statement metadata. `dialect` is accepted
 * as `Dialect | string` so plugin-manifest values can flow in without
 * additional validation at the call site; unknown values fall back to
 * the `generic` preset rather than throwing.
 */
export function splitStatements(
  sql: string,
  dialect?: Dialect | string,
): Statement[] {
  return splitInto(sql, dialectOptions(normalizeDialect(dialect)));
}

export function splitQueries(
  sql: string,
  dialect?: Dialect | string,
): string[] {
  return splitStatements(sql, dialect).map((s) => s.text);
}

export {
  isSelect,
  returnsResultSet,
  isExplainable,
  stripLeadingComments,
} from './classify';
