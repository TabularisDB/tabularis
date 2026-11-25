import type {NotebookCell} from '@/types/notebook';
import type {QueryResult} from '@/types/editor';
import type {DriverCapabilities, PluginManifest} from '@/types/plugins';
import {getQuoteChar, quoteIdentifierWith} from './identifiers';
import {isDialect, stripLeadingComments} from './sqlSplitter';
import {findCellsByAlias} from './notebookAlias';
import type {BooleanLiteralStyle} from '@/types/plugins';
import {
    booleanLiteralWithStyle,
    declaredBooleanLiterals,
    quoteSqlStringWithStyle,
    stringEscapeStyle,
} from './sqlLiteral';

/**
 * `{{cell_N}}` names the N-th cell by position (the original syntax); any other
 * `{{name}}` names the SQL cell whose result alias is `name`, wherever it is.
 */
const CELL_REF_PATTERN = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;
const POSITIONAL_REF = /^cell_(\d+)$/;

export interface CellReference {
    match: string;
    /**
     * 0-based index of the referenced cell. A named reference that no cell, or
     * more than one cell, answers to has -1.
     */
    cellIndex: number;
    /** Set for a named reference: the alias it uses. */
    alias?: string;
}

/** Why a reference could not be replaced by a result. */
export type UnresolvedReason =
    'missing' | 'duplicate' | 'notSql' | 'disabled' | 'noResult' | 'unsupported';

export interface UnresolvedReference extends CellReference {
    reason: UnresolvedReason;
}

function toReference(match: string, name: string, cells?: NotebookCell[]): CellReference {
    const positional = POSITIONAL_REF.exec(name);
    if (positional) return {match, cellIndex: Number(positional[1]) - 1};
    const targets = cells ? findCellsByAlias(cells, name) : [];
    return {match, cellIndex: targets.length === 1 ? targets[0] : -1, alias: name};
}

/**
 * The references in `sql`, in order. Named references are looked up in
 * `cells`; without them their `cellIndex` is -1.
 */
export function extractCellReferences(sql: string, cells?: NotebookCell[]): CellReference[] {
    const refs: CellReference[] = [];
    let match: RegExpExecArray | null;
    const regex = new RegExp(CELL_REF_PATTERN.source, 'g');
    while ((match = regex.exec(sql)) !== null) {
        refs.push(toReference(match[0], match[1], cells));
    }
    return refs;
}

export function hasCellReferences(sql: string): boolean {
    return new RegExp(CELL_REF_PATTERN.source).test(sql);
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
    unresolvedRefs: UnresolvedReference[];
}

/**
 * Find cell indices that need to be executed before the given SQL can run.
 * Returns indices of referenced cells that have no result (or have errors).
 * Disabled cells are left out: they must not run until re-enabled.
 * Returns them in sorted order (lowest index first) for sequential execution.
 */
export function findUnresolvedDependencies(sql: string, cells: NotebookCell[]): number[] {
    const refs = extractCellReferences(sql, cells);
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
    /**
     * The driver does not declare that it speaks SQL (see
     * {@link supportsNamedResultReferences}): a named reference is reported
     * instead of being turned into a CTE.
     */
    namedReferencesUnsupported?: boolean;
}

/**
 * Whether a named result reference can be expanded for this driver. The CTE is
 * SQL the host writes, so a plugin has to declare a dialect (`sql_dialect` or
 * `sql_syntax.extends`) first, as for other host-written SQL; a bare driver id
 * is a built-in SQL driver. `{{cell_N}}` keeps working everywhere, as before.
 */
export function supportsNamedResultReferences(
    driver: string | PluginManifest | DriverCapabilities | null | undefined,
): boolean {
    if (typeof driver !== 'object' || driver === null) return true;
    const caps = 'capabilities' in driver ? driver.capabilities : driver;
    return isDialect(caps?.sql_syntax?.extends) || isDialect(caps?.sql_dialect);
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
): ResolvedQuery {
    if (!hasCellReferences(sql)) return {sql, unresolvedRefs: []};

    const unresolvedRefs: UnresolvedReference[] = [];
    const ctes: string[] = [];
    const seen = new Set<string>();
    const identifierQuote = options?.identifierQuote || '"';
    let resolvedSql = sql.replace(
        new RegExp(CELL_REF_PATTERN.source, 'g'),
        (match: string, name: string) => {
            const ref = toReference(match, name, cells);
            const unresolved = (reason: UnresolvedReason) => {
                unresolvedRefs.push({...ref, reason});
                return match;
            };
            if (ref.alias !== undefined) {
                if (options?.namedReferencesUnsupported) return unresolved('unsupported');
                if (ref.cellIndex < 0) {
                    const shared = findCellsByAlias(cells, ref.alias).length > 1;
                    return unresolved(shared ? 'duplicate' : 'missing');
                }
            }
            const targetCell = cells[ref.cellIndex];
            if (!targetCell) return unresolved('missing');
            if (targetCell.type !== 'sql') return unresolved('notSql');
            // A disabled cell's cached output is not current: never substitute it.
            if (targetCell.isDisabled) return unresolved('disabled');
            if (!targetCell.result || targetCell.error) return unresolved('noResult');

            // Named results are quoted, so an alias that is also a keyword still works.
            const cteName =
                ref.alias !== undefined
                    ? quoteIdentifierWith(ref.alias, identifierQuote)
                    : `cell_${ref.cellIndex + 1}`;
            if (!seen.has(cteName)) {
                seen.add(cteName);
                ctes.push(
                    resultToCte(
                        targetCell.result,
                        cteName,
                        options?.escapeBackslashes ?? false,
                        options?.backslashLiterals ?? false,
                        identifierQuote,
                        options?.booleanLiterals,
                    ),
                );
            }
            return cteName;
        },
    );

    if (ctes.length > 0) {
        // A query with its own WITH clause gets the cell CTEs added to the front of
        // that clause: a second WITH before it would be a syntax error.
        const body = stripLeadingComments(resolvedSql);
        const ownWith = /^with(?:\s+recursive)?\s+/i.exec(body);
        if (ownWith) {
            const insertAt = resolvedSql.length - body.length + ownWith[0].length;
            resolvedSql = `${resolvedSql.slice(0, insertAt)}${ctes.join(',\n')},\n${resolvedSql.slice(insertAt)}`;
        } else {
            resolvedSql = `WITH ${ctes.join(',\n')}\n${resolvedSql}`;
        }
    }

    return {sql: resolvedSql, unresolvedRefs};
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * One message for the references a cell could not resolve, each with why:
 * no such cell or alias, an alias two cells share, a Markdown target, a
 * disabled cell, no result yet, or a driver that cannot take the CTE.
 */
export function describeUnresolvedReferences(refs: UnresolvedReference[], t: Translate): string {
    const seen = new Set<string>();
    const details: string[] = [];
    for (const ref of refs) {
        const key = `${ref.match}:${ref.reason}`;
        if (seen.has(key)) continue;
        seen.add(key);
        details.push(t(`editor.notebook.referenceErrors.${ref.reason}`, {ref: ref.match}));
    }
    return t('editor.notebook.referenceErrors.unresolved', {details: details.join(' ')});
}
