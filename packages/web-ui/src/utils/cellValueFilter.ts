import type {DriverCapabilities, PluginManifest} from '@/types/plugins';
import {quoteIdentifier} from './identifiers';
import {formatSqlValueForColumnComparison, isNumericColumnType} from './foreignKeys';
import {buildLiteralLikeClause} from './filterBar';
import {getDateInputMode} from './dateInput';
import {isGeometricType} from './geometry';
import {isTextColumn} from './text';

export type CellValueFilterOperator =
    | '='
    | '<>'
    | '>'
    | '>='
    | '<'
    | '<='
    | 'contains'
    | 'not contains'
    | 'starts with'
    | 'ends with'
    | 'IS NULL'
    | 'IS NOT NULL';

/**
 * Build a WHERE-clause fragment that filters the current table by a cell value.
 * Output: `"col" = 42`, `"col" <> 'escaped''value'`, `"col" >= '2024-01-01'`,
 * `"col" LIKE '%50!%%' ESCAPE '!'`, `"col" NOT LIKE '%x%' ESCAPE '!'`,
 * `"col" IS NULL`, or `"col" IS NOT NULL`.
 *
 * `columnType` is the data type of the column the user clicked on; it decides
 * whether a numeric-looking string is emitted unquoted (numeric column) or
 * quoted (everything else), mirroring `buildForeignKeyFilterClause`.
 *
 * `contains`, `not contains`, `starts with` and `ends with` match the value
 * literally: `%`, `_` and the `!` escape character are escaped and an explicit
 * `ESCAPE '!'` is added, which behaves the same on MySQL, PostgreSQL and
 * SQLite. They go through the filter bar's `buildLiteralLikeClause`, so both
 * produce the same clause for the same value.
 */
export function buildCellValueFilterClause(
    column: string,
    operator: CellValueFilterOperator,
    value: unknown,
    driver: string | PluginManifest | DriverCapabilities | null | undefined,
    columnType?: string,
): string {
    const col = quoteIdentifier(column, driver);
    if (operator === 'IS NULL') return `${col} IS NULL`;
    if (operator === 'IS NOT NULL') return `${col} IS NOT NULL`;
    if (operator === 'contains' || operator === 'starts with' || operator === 'ends with') {
        return buildLiteralLikeClause(col, String(value), operator, driver);
    }
    if (operator === 'not contains') {
        return buildLiteralLikeClause(col, String(value), 'contains', driver, {negate: true});
    }
    return `${col} ${operator} ${formatSqlValueForColumnComparison(value, driver, columnType)}`;
}

/**
 * Combine a newly added filter clause with the tab's existing one. The
 * existing clause is parenthesised so a filter that already contains OR keeps
 * its meaning when AND-ed with the new condition.
 */
export function combineFilterClauses(existing: string | undefined | null, added: string): string {
    const trimmed = existing?.trim();
    if (!trimmed) return added;
    return `(${trimmed}) AND ${added}`;
}

/**
 * Operators offered for a cell: NULL cells only offer the IS NULL /
 * IS NOT NULL pair, everything else (including empty strings) offers = / <>.
 * Numeric and date/time columns add > / >= / < / <=; text columns add the
 * literal LIKE matches unless the value is an empty string (they would match
 * every row, or none for `not contains`).
 *
 * A masked cell also only offers IS NULL / IS NOT NULL, whatever its value:
 * `=` / `<>` would copy the real value into the WHERE input, and offering the
 * same pair for NULL and non-NULL cells keeps the menu from hinting which one
 * the masked cell holds.
 */
export function getCellValueFilterOperators(
    value: unknown,
    options: {masked?: boolean; columnType?: string} = {},
): CellValueFilterOperator[] {
    if (options.masked || value === null || value === undefined) {
        return ['IS NULL', 'IS NOT NULL'];
    }
    const columnType = options.columnType ?? '';
    if (isComparableColumnType(columnType)) {
        return ['=', '<>', '>', '>=', '<', '<='];
    }
    if (isTextColumn(columnType) && String(value) !== '') {
        return ['=', '<>', 'contains', 'not contains', 'starts with', 'ends with'];
    }
    return ['=', '<>'];
}

/**
 * Numeric and date/time columns have a meaningful order. Geometric types are
 * excluded: names such as POINT or LINESTRING contain "int", which the
 * numeric check would otherwise match.
 */
export function isComparableColumnType(columnType: string): boolean {
    if (!columnType || isGeometricType(columnType)) return false;
    // Drop precision such as `datetime(3)` / `timestamp(6) with time zone`:
    // getDateInputMode matches bare type names only.
    const baseType = columnType.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ');
    return isNumericColumnType(columnType) || getDateInputMode(baseType) !== null;
}
