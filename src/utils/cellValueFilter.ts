import type {DriverCapabilities, PluginManifest} from '@/types/plugins';
import {quoteIdentifier} from './identifiers';
import {formatSqlValueForColumnComparison, isNumericColumnType} from './foreignKeys';
import {buildLiteralLikeClause} from './filterBar';
import {getDateInputMode} from './dateInput';
import {isGeometricType} from './geometry';
import {isTextColumn} from './text';

export type CellValueFilterOperator =
    '=' | '<>' | '>' | '>=' | '<' | '<=' | 'contains' | 'IS NULL' | 'IS NOT NULL' | 'IN';

/** Cap on the number of clipboard values turned into an IN list. */
export const MAX_CLIPBOARD_FILTER_VALUES = 1000;

/**
 * A numeric literal accepted in a numeric column: an optional sign, digits,
 * and an optional fractional part. Mirrors the numeric check in
 * {@link formatSqlValueForFilter}; text that fails this (e.g. a spreadsheet
 * header copied with the column) can't be compared against a numeric column.
 */
const NUMERIC_CLIPBOARD_VALUE = /^-?\d+(\.\d+)?$/;

/** Whether a clipboard line is a valid literal for a numeric column. */
export function isNumericClipboardValue(value: string): boolean {
    return NUMERIC_CLIPBOARD_VALUE.test(value.trim());
}

/**
 * Split clipboard text into a deduplicated list of trimmed values for an IN
 * filter. Lines are split on line breaks; blank lines (including a trailing
 * newline) are ignored and duplicates collapse to their first occurrence.
 *
 * More than {@link MAX_CLIPBOARD_FILTER_VALUES} distinct values are dropped and
 * reported via `truncated`, so the caller can toast about the cut-off.
 *
 * When `columnType` is a numeric column, non-numeric lines (e.g. a spreadsheet
 * header copied together with the column) are dropped instead of emitted as
 * quoted strings — MySQL would silently cast them to 0 and PostgreSQL would
 * reject the query. The count is reported via `nonNumericDropped` so the
 * caller can toast about the skipped lines.
 */
export function parseClipboardInList(
    text: string,
    options: {columnType?: string} = {},
): {
    values: string[];
    truncated: boolean;
    nonNumericDropped: number;
} {
    const numeric = isNumericColumnType(options.columnType);
    const seen = new Set<string>();
    const values: string[] = [];
    let nonNumericDropped = 0;
    for (const line of text.split(/\r\n|\r|\n/)) {
        const value = line.trim();
        if (value === '' || seen.has(value)) continue;
        seen.add(value);
        if (numeric && !isNumericClipboardValue(value)) {
            nonNumericDropped += 1;
            continue;
        }
        if (values.length < MAX_CLIPBOARD_FILTER_VALUES) values.push(value);
    }
    return {
        values,
        truncated: seen.size - nonNumericDropped > MAX_CLIPBOARD_FILTER_VALUES,
        nonNumericDropped,
    };
}

/**
 * Build a WHERE-clause fragment that filters the current table by a cell value.
 * Output: `"col" = 42`, `"col" <> 'escaped''value'`, `"col" >= '2024-01-01'`,
 * `"col" LIKE '%50!%%' ESCAPE '!'`, `"col" IS NULL`, `"col" IS NOT NULL`, or
 * `"col" IN (1, 2, 3)` (the value must be an array).
 *
 * `columnType` is the data type of the column the user clicked on; it decides
 * whether a numeric-looking string is emitted unquoted (numeric column) or
 * quoted (everything else), mirroring `buildForeignKeyFilterClause`.
 *
 * `contains` matches the value literally: `%`, `_` and the `!` escape
 * character are escaped and an explicit `ESCAPE '!'` is added, which behaves
 * the same on MySQL, PostgreSQL and SQLite.
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
    if (operator === 'contains') {
        return buildLiteralLikeClause(col, String(value), 'contains', driver);
    }
    if (operator === 'IN') {
        const list = Array.isArray(value) ? value : [value];
        const literals = list.map((item) =>
            formatSqlValueForColumnComparison(item, driver, columnType),
        );
        return `${col} IN (${literals.join(', ')})`;
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
 * Numeric and date/time columns add > / >= / < / <=; text columns add
 * `contains` unless the value is an empty string (it would match every row).
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
        return ['=', '<>', 'contains'];
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
