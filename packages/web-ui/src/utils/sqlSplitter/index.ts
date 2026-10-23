import {splitInto} from './splitter';
import {collectNonCodeSpans} from './nonCodeSpans';

export type Dialect = 'postgres' | 'mysql' | 'mssql' | 'sqlite' | 'oracle' | 'generic';

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

/**
 * String-index span (same coordinate system as `StatementRange`) of a
 * single string literal or comment in the source.
 */
export interface NonCodeSpan {
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
    /**
     * What the run delimits. Only string quotes take `stringPrefixes` and
     * `tripleQuotedStrings`; both kinds are non-code for splitting.
     */
    readonly kind: 'string' | 'identifier';
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
     * MySQL/MariaDB `#` line comments (run to end of line, from any
     * position outside a string, no whitespace requirement). Kept off
     * for dialects where `#` is a valid identifier character (e.g.
     * Oracle's `emp#`).
     */
    readonly hashComments: boolean;
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
    /**
     * Triple-quoted `'''…'''` and `"""…"""` strings that may span lines
     * (GoogleSQL), for the `'` and `"` quotes of kind `string`. Escapes follow
     * that quote's rule; the run ends at the first unescaped triple quote.
     */
    readonly tripleQuotedStrings: boolean;
    /**
     * Lower-case letter prefixes (`r`, `b`, `rb`, …) accepted, in any case,
     * in front of a `string` quote (or a triple quote). A prefix only joins
     * the literal; escapes still follow the quote's rule, so a raw `r'\''`
     * is still one literal (GoogleSQL raw literals keep the backslash as text
     * but it still can't end the literal).
     */
    readonly stringPrefixes: ReadonlyArray<string>;
    /**
     * Procedural-language blocks (`BEGIN … END`, `IF … END IF`, `LOOP`,
     * `WHILE`, `REPEAT`, `FOR … DO`, `CASE … END CASE`, procedure bodies) as
     * GoogleSQL scripting has them. A `;` inside an open block does not end the
     * statement, so a whole block runs as one script.
     */
    readonly scriptBlocks: boolean;
}

/**
 * A resolved SQL syntax (see `resolveSqlSyntax` in `src/utils/sqlSyntax.ts`)
 * as the splitter entry points accept it in place of a dialect name.
 */
export interface SqlSyntaxSource {
    /** The preset in force, or undefined when the driver declares none. */
    readonly dialect: Dialect | undefined;
    /** The driver declared `sql_syntax`. */
    readonly declared: boolean;
    readonly options: DialectOptions;
}

/**
 * What the splitter entry points accept: a dialect name (unknown names fall
 * back to `generic`, `undefined` to `postgres`) or a resolved syntax.
 */
export type DialectInput = Dialect | string | SqlSyntaxSource | undefined;

const STANDARD_QUOTES: ReadonlyArray<QuoteRule> = [
    {open: "'", close: "'", doubleClose: true, kind: 'string'},
    {open: '"', close: '"', doubleClose: true, kind: 'identifier'},
];

const NO_PREFIXES: ReadonlyArray<string> = [];

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
    hashComments: false,
    executableComments: false,
    nestedBlockComments: true,
    lineCommentRequiresSpace: false,
    tripleQuotedStrings: false,
    stringPrefixes: NO_PREFIXES,
    scriptBlocks: false,
};

const MYSQL: DialectOptions = {
    quotes: [
        {open: "'", close: "'", escape: '\\', doubleClose: true, kind: 'string'},
        {open: '"', close: '"', escape: '\\', doubleClose: true, kind: 'string'},
        {open: '`', close: '`', doubleClose: true, kind: 'identifier'},
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
    hashComments: true,
    executableComments: true,
    nestedBlockComments: false,
    lineCommentRequiresSpace: true,
    tripleQuotedStrings: false,
    stringPrefixes: NO_PREFIXES,
    scriptBlocks: false,
};

const MSSQL: DialectOptions = {
    quotes: [
        {open: "'", close: "'", doubleClose: true, kind: 'string'},
        // T-SQL: `]]` inside `[...]` is the literal `]` escape.
        {open: '[', close: ']', doubleClose: true, kind: 'identifier'},
        // Double quotes delimit identifiers under the default
        // QUOTED_IDENTIFIER ON (and strings when it is OFF) — non-code
        // either way.
        {open: '"', close: '"', doubleClose: true, kind: 'identifier'},
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
    hashComments: false,
    executableComments: false,
    // T-SQL block comments nest (documented behavior).
    nestedBlockComments: true,
    lineCommentRequiresSpace: false,
    tripleQuotedStrings: false,
    stringPrefixes: NO_PREFIXES,
    scriptBlocks: false,
};

const SQLITE: DialectOptions = {
    quotes: [
        {open: "'", close: "'", doubleClose: true, kind: 'string'},
        {open: '"', close: '"', doubleClose: true, kind: 'identifier'},
        {open: '`', close: '`', doubleClose: true, kind: 'identifier'},
        {open: '[', close: ']', doubleClose: false, kind: 'identifier'},
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
    hashComments: false,
    executableComments: false,
    nestedBlockComments: false,
    lineCommentRequiresSpace: false,
    tripleQuotedStrings: false,
    stringPrefixes: NO_PREFIXES,
    scriptBlocks: false,
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
    hashComments: false,
    executableComments: false,
    nestedBlockComments: false,
    lineCommentRequiresSpace: false,
    tripleQuotedStrings: false,
    stringPrefixes: NO_PREFIXES,
    scriptBlocks: false,
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
    hashComments: false,
    executableComments: false,
    nestedBlockComments: false,
    lineCommentRequiresSpace: false,
    tripleQuotedStrings: false,
    stringPrefixes: NO_PREFIXES,
    scriptBlocks: false,
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

/** Whether `name` is one of the built-in presets. */
export function isDialect(name: unknown): name is Dialect {
    // Own-property check: `in` would also accept prototype members such
    // as '__proto__' or 'toString' and return a non-DialectOptions value.
    return typeof name === 'string' && Object.hasOwn(DIALECT_TABLE, name);
}

/**
 * The preset a dialect name selects: `postgres` when undefined (the
 * historical default), `generic` when unknown.
 */
export function normalizeDialect(dialect: Dialect | string | undefined): Dialect {
    if (dialect === undefined) return 'postgres';
    return isDialect(dialect) ? dialect : 'generic';
}

/** The splitter options for a dialect name or a resolved syntax. */
export function optionsFor(input: DialectInput): DialectOptions {
    if (typeof input === 'object') return input.options;
    return dialectOptions(normalizeDialect(input));
}

/**
 * Split a SQL source into per-statement metadata. `dialect` is accepted
 * as `Dialect | string` so plugin-manifest values can flow in without
 * additional validation at the call site; unknown values fall back to
 * the `generic` preset rather than throwing. A resolved syntax
 * (`resolveSqlSyntax`) carries a plugin's declared `sql_syntax`.
 */
export function splitStatements(sql: string, dialect?: DialectInput): Statement[] {
    return splitInto(sql, optionsFor(dialect));
}

export function splitQueries(sql: string, dialect?: DialectInput): string[] {
    return splitStatements(sql, dialect).map((s) => s.text);
}

/** Like `splitStatements`, but T-SQL splits on `GO` only so `DECLARE @var` scope survives. */
export function splitBatches(sql: string, dialect?: DialectInput): Statement[] {
    const options = optionsFor(dialect);
    return splitInto(sql, options, options.goDelimiter);
}

/**
 * Spans of every string literal and comment in `sql` — the regions
 * where a `:name` is data, not a potential bind parameter.
 *
 * When `dialect` is undefined or unknown this returns `[]` (nothing is
 * treated as non-code) instead of guessing a dialect: lexing with the
 * wrong quote rules can hide real SQL — e.g. the generic rules read
 * MySQL's `'a\'b'` as an unterminated string and would swallow every
 * parameter after it — so degrading to "no spans" keeps callers exactly
 * as accurate as they were before they knew about dialects. Pass an
 * explicit `'generic'` to scan with the ANSI-ish fallback rules.
 */
export function scanNonCodeSpans(sql: string, dialect?: DialectInput): NonCodeSpan[] {
    if (typeof dialect === 'object') {
        // A resolved syntax with neither a declared syntax nor a known
        // dialect is the "no dialect" case above.
        if (!dialect.declared && dialect.dialect === undefined) return [];
        return collectNonCodeSpans(sql, dialect.options);
    }
    if (!isDialect(dialect)) return [];
    return collectNonCodeSpans(sql, DIALECT_TABLE[dialect]);
}

export {isSelect, returnsResultSet, isExplainable, stripLeadingComments} from './classify';

export {findStatementAtOffset} from './statementAt';
