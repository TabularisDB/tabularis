import type {NotebookCell} from '@/types/notebook';
import type {QueryResult} from '@/types/editor';
import type {BooleanLiteralStyle, DriverCapabilities, PluginManifest} from '@/types/plugins';
import {getQuoteChar, quoteIdentifierWith} from './identifiers';
import {optionsFor, type DialectInput} from './sqlSplitter';
import {collectNonCodeSpans} from './sqlSplitter/nonCodeSpans';
import {resolveSqlSyntax} from './sqlSyntax';
import {
    booleanLiteralWithStyle,
    declaredBooleanLiterals,
    quoteSqlStringWithStyle,
    stringEscapeStyle,
} from './sqlLiteral';

const CELL_REF_PATTERN = /\{\{cell_(\d+)\}\}/g;

export interface CellReference {
    match: string;
    cellIndex: number;
}

export interface CellReferenceToken extends CellReference {
    start: number;
    end: number;
}

function nonCodeSpans(sql: string, dialect: DialectInput) {
    const options = optionsFor(dialect);
    // Notebook placeholders in comments are documentation, even in dialects
    // with special executable comments. Do not expand them as bindings.
    return collectNonCodeSpans(sql, {...options, executableComments: false});
}

/** Use the same legacy MySQL-family fallback as notebook string serialization. */
export function resolveNotebookSqlSyntax(
    capabilities: DriverCapabilities | null | undefined,
    driverId: string | null | undefined,
) {
    const syntax = resolveSqlSyntax(capabilities);
    return !syntax.declared &&
        (!syntax.dialect || syntax.dialect === 'generic') &&
        stringEscapeStyle(capabilities, driverId) === 'mysql'
        ? resolveSqlSyntax({sql_dialect: 'mysql'})
        : syntax;
}

export function extractCellReferences(sql: string, dialect?: DialectInput): CellReferenceToken[] {
    if (!sql.includes('{{cell_')) return [];
    const spans = nonCodeSpans(sql, dialect);
    if (
        typeof dialect === 'object' &&
        !dialect.declared &&
        (!dialect.dialect || dialect.dialect === 'generic')
    ) {
        // Without a concrete syntax, accept a dependency only where none of
        // the supported lexers see data. A missed binding fails at execution;
        // a guessed binding could schedule an unrelated write.
        for (const preset of ['mysql', 'postgres', 'sqlite', 'mssql', 'oracle'] as const) {
            for (const span of nonCodeSpans(sql, preset)) spans.push(span);
        }
        // No preset enables triple quotes. Also mask that interpretation for
        // unknown plugins; the MySQL quote rules cover both string delimiters
        // and backslash escapes. This pass can only veto a candidate binding.
        if (sql.includes("'''") || sql.includes('"""')) {
            const tripleQuoted = collectNonCodeSpans(sql, {
                ...optionsFor('generic'),
                quotes: optionsFor('mysql').quotes,
                hashComments: true,
                tripleQuotedStrings: true,
            });
            for (const span of tripleQuoted) spans.push(span);
        }
        spans.sort((a, b) => a.start - b.start);
    }
    const refs: CellReferenceToken[] = [];
    let span = 0;
    for (const token of sql.matchAll(CELL_REF_PATTERN)) {
        const [match, number] = token;
        const start = token.index;
        const end = start + match.length;
        while (spans[span] && spans[span].end <= start) span++;
        if (spans[span] && spans[span].start < end) continue;
        refs.push({match, cellIndex: Number(number) - 1, start, end});
    }
    return refs;
}

export function hasCellReferences(sql: string): boolean {
    return extractCellReferences(sql).length > 0;
}

/**
 * Quote a value as a SQL string literal. Backslashes are doubled only for
 * dialects where `\` is an escape character inside strings (MySQL/MariaDB);
 * doubling them unconditionally would corrupt values on standard-conforming
 * databases like PostgreSQL or SQLite. A declared `string_escape:
 * "backslash"` syntax (GoogleSQL) has no doubled-quote escape and gets
 * backslash escapes instead.
 */
function quoteStringLiteral(
    val: string,
    escapeBackslashes: boolean,
    backslashLiterals: boolean,
): string {
    if (backslashLiterals) return quoteSqlStringWithStyle(val, 'backslash');
    let escaped = val;
    if (escapeBackslashes) escaped = escaped.replace(/\\/g, '\\\\');
    return `'${escaped.replace(/'/g, "''")}'`;
}

/**
 * Serializing a result set is linear in its rows, and resolution runs on every
 * render of the notebook. Results are replaced wholesale rather than mutated,
 * so the rendered CTE stays valid for as long as the result object lives.
 */
const cteCache = new WeakMap<QueryResult, Map<string, string>>();

function resultToCte(
    result: QueryResult,
    alias: string,
    escapeBackslashes: boolean,
    backslashLiterals: boolean,
    identifierQuote: string,
    booleanLiterals: BooleanLiteralStyle | undefined,
): string {
    const variantKey = `${escapeBackslashes ? 1 : 0}${backslashLiterals ? 1 : 0}${booleanLiterals ?? ''}:${identifierQuote}:${alias}`;
    let variants = cteCache.get(result);
    const cached = variants?.get(variantKey);
    if (cached !== undefined) return cached;

    let cte: string;
    if (result.rows.length === 0) {
        const emptyCols = result.columns
            .map((col) => `NULL AS ${quoteIdentifierWith(col, identifierQuote)}`)
            .join(', ');
        cte = `${alias} AS (SELECT ${emptyCols} WHERE 1=0)`;
    } else {
        const selects = result.rows.map((row) => {
            const cols = result.columns
                .map((col, i) => {
                    const val = row[i];
                    const ident = quoteIdentifierWith(col, identifierQuote);
                    if (val === null || val === undefined) return `NULL AS ${ident}`;
                    if (typeof val === 'number' && Number.isFinite(val)) {
                        return `${val} AS ${ident}`;
                    }
                    if (typeof val === 'boolean' && booleanLiterals) {
                        return `${booleanLiteralWithStyle(val, booleanLiterals)} AS ${ident}`;
                    }
                    const literal = quoteStringLiteral(
                        String(val),
                        escapeBackslashes,
                        backslashLiterals,
                    );
                    return `${literal} AS ${ident}`;
                })
                .join(', ');
            return `SELECT ${cols}`;
        });
        cte = `${alias} AS (\n  ${selects.join('\n  UNION ALL\n  ')}\n)`;
    }

    if (!variants) {
        variants = new Map();
        cteCache.set(result, variants);
    }
    variants.set(variantKey, cte);
    return cte;
}

export interface ResolvedQuery {
    sql: string;
    unresolvedRefs: CellReference[];
}

/**
 * Find cell indices that need to be executed before the given SQL can run.
 * Returns indices of referenced cells that have no result (or have errors).
 * Disabled cells are left out: they must not run until re-enabled.
 * Returns them in sorted order (lowest index first) for sequential execution.
 */
export function findUnresolvedDependencies(sql: string, cells: NotebookCell[]): number[] {
    const refs = extractCellReferences(sql);
    const indices = new Set<number>();
    for (const ref of refs) {
        const targetCell = cells[ref.cellIndex];
        if (!targetCell || targetCell.type !== 'sql' || !targetCell.result || targetCell.error) {
            // A disabled cell is never executed on behalf of a consumer.
            if (targetCell && targetCell.type === 'sql' && !targetCell.isDisabled) {
                indices.add(ref.cellIndex);
            }
        }
    }
    return Array.from(indices).sort((a, b) => a - b);
}

export interface ResolveVariablesOptions {
    dialect?: DialectInput;
    /** Double backslashes in string literals (MySQL/MariaDB dialects). */
    escapeBackslashes?: boolean;
    /**
     * Backslash-escape quotes, backslashes, NUL and line breaks instead of doubling
     * quotes: a declared `sql_syntax.string_escape: "backslash"` (GoogleSQL).
     * Takes precedence over `escapeBackslashes`.
     */
    backslashLiterals?: boolean;
    /**
     * Quote for the CTE column aliases: the driver's `identifier_quote`
     * capability. Defaults to `"`.
     */
    identifierQuote?: string;
    /**
     * How boolean values are written: the driver's declared
     * `sql_syntax.boolean_literals`. Omitted, they stay quoted strings
     * (`'true'`), as before the field existed.
     */
    booleanLiterals?: BooleanLiteralStyle;
}

/**
 * Variable-resolution options for the active driver, read from its
 * capabilities (`identifier_quote`, and the resolved `sql_syntax` /
 * `sql_dialect` literal style) so plugin drivers get column aliases and
 * string literals their dialect accepts.
 *
 * `driverId` is the active driver id. When the capabilities declare neither
 * `sql_syntax` nor a concrete `sql_dialect`, the id-based rule used before
 * capabilities existed still applies, so a `mariadb` plugin without a
 * dialect keeps doubling backslashes; dropping that would let a value ending
 * in `\` escape its closing quote on a MySQL-family engine.
 */
export function variableOptionsForDriver(
    driver: string | PluginManifest | DriverCapabilities | null | undefined,
    driverId?: string | null,
): ResolveVariablesOptions {
    const style = stringEscapeStyle(driver, driverId);
    const booleanLiterals = declaredBooleanLiterals(driver);
    return {
        escapeBackslashes: style !== 'standard',
        identifierQuote: getQuoteChar(driver),
        ...(style === 'backslash' ? {backslashLiterals: true} : {}),
        ...(booleanLiterals ? {booleanLiterals} : {}),
    };
}

export function resolveQueryVariables(
    sql: string,
    cells: NotebookCell[],
    options?: ResolveVariablesOptions,
    references = extractCellReferences(sql, options?.dialect),
): ResolvedQuery {
    if (!references.length) return {sql, unresolvedRefs: []};

    const unresolvedRefs: CellReference[] = [];
    const ctes: string[] = [];
    const seen = new Set<number>();
    let resolvedSql = '';
    let cursor = 0;
    for (const {match, cellIndex, start, end} of references) {
        resolvedSql += sql.slice(cursor, start);
        cursor = end;
        const targetCell = cells[cellIndex];
        // A disabled cell's cached output is not current: never substitute it.
        if (
            targetCell?.type !== 'sql' ||
            targetCell.isDisabled ||
            !targetCell.result ||
            targetCell.error
        ) {
            unresolvedRefs.push({match, cellIndex});
            resolvedSql += match;
            continue;
        }

        const alias = `cell_${cellIndex + 1}`;
        if (!seen.has(cellIndex)) {
            seen.add(cellIndex);
            ctes.push(
                resultToCte(
                    targetCell.result,
                    alias,
                    options?.escapeBackslashes ?? false,
                    options?.backslashLiterals ?? false,
                    options?.identifierQuote || '"',
                    options?.booleanLiterals,
                ),
            );
        }
        resolvedSql += alias;
    }
    resolvedSql += sql.slice(cursor);

    if (ctes.length > 0) {
        // Locate the original WITH clause even after dialect-specific comments.
        const spans = nonCodeSpans(resolvedSql, options?.dialect);
        let span = 0;
        const skipTrivia = (from: number) => {
            for (;;) {
                const start = from + (/^\s*/.exec(resolvedSql.slice(from))?.[0].length ?? 0);
                while (spans[span] && spans[span].end <= start) span++;
                if (
                    spans[span]?.start !== start ||
                    !/^(?:--|\/\*|#)/.test(resolvedSql.slice(start))
                )
                    return start;
                from = spans[span++].end;
            }
        };
        const body = skipTrivia(0);
        const withKeyword = /^with\b/i.exec(resolvedSql.slice(body));
        if (withKeyword) {
            const afterWith = skipTrivia(body + withKeyword[0].length);
            const recursive = /^recursive\b/i.exec(resolvedSql.slice(afterWith));
            const insertAt = recursive ? skipTrivia(afterWith + recursive[0].length) : afterWith;
            const prefix = resolvedSql.slice(0, insertAt);
            resolvedSql = `${prefix}${/\s$/.test(prefix) ? '' : ' '}${ctes.join(',\n')},\n${resolvedSql.slice(insertAt)}`;
        } else {
            resolvedSql = `WITH ${ctes.join(',\n')}\n${resolvedSql}`;
        }
    }

    return {sql: resolvedSql, unresolvedRefs};
}
