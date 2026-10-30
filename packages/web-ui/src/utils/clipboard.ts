import {formatCellValue} from './dataGrid';
import {writeActiveClipboard} from '@/platform/activeCapabilities';
import type {DriverCapabilities, PluginManifest} from '@/types/plugins';
import {quoteIdentifier} from './identifiers';
import {quoteSqlString, sqlBooleanLiteral, stringEscapeStyle} from './sqlLiteral';
import {escapeHtml} from './escape';

/** Driver whose dialect the copied SQL literals follow. */
export type CopyDriver = string | PluginManifest | DriverCapabilities | null;

// RFC 4180 quoting, shared with the file export: a field with the delimiter, a quote or a line
// break (LF or CR) is wrapped in quotes, and its quotes are doubled.
export function csvField(text: string, delimiter: string): string {
    if (text.includes(delimiter) || text.includes('"') || /[\r\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

export function rowToCSV(
    row: unknown[],
    nullLabel: string = 'null',
    delimiter: string = ',',
): string {
    return row.map((cell) => csvField(formatCellValue(cell, nullLabel), delimiter)).join(delimiter);
}

export function rowsToCSV(
    rows: unknown[][],
    nullLabel: string = 'null',
    delimiter: string = ',',
): string {
    return rows.map((row) => rowToCSV(row, nullLabel, delimiter)).join('\n');
}

export function rowsToCSVWithHeaders(
    rows: unknown[][],
    columns: string[],
    nullLabel: string = 'null',
    delimiter: string = ',',
): string {
    const header = columns.map((column) => csvField(column, delimiter)).join(delimiter);
    const body = rowsToCSV(rows, nullLabel, delimiter);
    return body ? `${header}\n${body}` : header;
}

export function rowToJSON(row: unknown[], columns: string[]): string {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
        obj[col] = row[i] ?? null;
    });
    return JSON.stringify(obj);
}

export function rowsToJSON(rows: unknown[][], columns: string[]): string {
    return JSON.stringify(
        rows.map((row) => {
            const obj: Record<string, unknown> = {};
            columns.forEach((col, i) => {
                obj[col] = row[i] ?? null;
            });
            return obj;
        }),
    );
}

export function columnNamesAsLines(columns: string[]): string {
    return columns.join('\n');
}

export function columnNamesAsJson(columns: string[]): string {
    return JSON.stringify(columns);
}

function markdownCell(cell: unknown, nullLabel: string = 'null'): string {
    return formatCellValue(cell, nullLabel).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

export function rowsToMarkdown(
    rows: unknown[][],
    columns: string[],
    nullLabel: string = 'null',
    includeHeaders: boolean = true,
): string {
    const body = rows.map(
        (row) => `| ${row.map((cell) => markdownCell(cell, nullLabel)).join(' | ')} |`,
    );
    if (!includeHeaders) return body.join('\n');
    const header = `| ${columns.map((c) => markdownCell(c)).join(' | ')} |`;
    const separator = `| ${columns.map(() => '---').join(' | ')} |`;
    return [header, separator, ...body].join('\n');
}

function htmlCell(cell: unknown, nullLabel: string): string {
    return escapeHtml(formatCellValue(cell, nullLabel)).replace(/\r?\n/g, '<br>');
}

/** Format rows as an HTML table (with a header row) for pasting into spreadsheets and documents. */
export function rowsToHtmlTable(
    rows: unknown[][],
    columns: string[],
    nullLabel: string = 'null',
): string {
    const header = columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
    const body = rows
        .map(
            (row) =>
                `<tr>${row.map((cell) => `<td>${htmlCell(cell, nullLabel)}</td>`).join('')}</tr>`,
        )
        .join('');
    return `<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`;
}

export type CopyFormat = 'csv' | 'json' | 'sql-insert' | 'sql-update' | 'markdown';

/** Why rows can't be copied as UPDATE statements; `null` when they can. */
export type SqlUpdateBlocker = 'no-key' | 'key-not-in-result' | 'only-key-columns';

/**
 * An UPDATE needs a WHERE clause on the primary key, so the result must have a known
 * key, every key column must be in `columns`, and at least one other column must be
 * left to SET.
 */
export function sqlUpdateBlocker(
    columns: string[],
    pkColumns?: string[] | null,
): SqlUpdateBlocker | null {
    if (!pkColumns || pkColumns.length === 0) return 'no-key';
    if (!pkColumns.every((pk) => columns.includes(pk))) return 'key-not-in-result';
    if (columns.every((column) => pkColumns.includes(column))) return 'only-key-columns';
    return null;
}

/** Format result rows for clipboard copy in the user's chosen copy format. */
export function formatRowsForCopy(
    rows: unknown[][],
    columns: string[],
    copyFormat: CopyFormat,
    options: {
        withHeaders?: boolean;
        csvIncludeHeaders?: boolean;
        csvDelimiter?: string;
        tableName?: string | null;
        driver?: CopyDriver;
        /** How NULL is written in CSV and Markdown. JSON and SQL INSERT keep their native null. */
        nullLabel?: string;
        /** Primary key of the result, for SQL UPDATE's WHERE clause. */
        pkColumns?: string[] | null;
    } = {},
): string {
    const {
        withHeaders = false,
        csvIncludeHeaders = true,
        csvDelimiter = ',',
        tableName,
        driver,
        nullLabel = 'null',
        pkColumns,
    } = options;
    if (copyFormat === 'json') return rowsToJSON(rows, columns);
    if (copyFormat === 'sql-update' && pkColumns && sqlUpdateBlocker(columns, pkColumns) === null)
        return rowsToSqlUpdate(rows, columns, tableName ?? 'table', pkColumns, driver);
    // Without a usable key there is no safe WHERE clause, so SQL UPDATE falls back to
    // INSERT; callers check sqlUpdateBlocker to tell the user.
    if (copyFormat === 'sql-insert' || copyFormat === 'sql-update')
        return rowsToSqlInsert(rows, columns, tableName ?? 'table', driver);
    if (copyFormat === 'markdown')
        return rowsToMarkdown(rows, columns, nullLabel, withHeaders && csvIncludeHeaders);
    if (withHeaders && csvIncludeHeaders)
        return rowsToCSVWithHeaders(rows, columns, nullLabel, csvDelimiter);
    return rowsToCSV(rows, nullLabel, csvDelimiter);
}

export function getSelectedRows(data: unknown[][], selectedIndices: Set<number>): unknown[][] {
    const sortedIndices = Array.from(selectedIndices).sort((a, b) => a - b);
    return sortedIndices.map((idx) => data[idx]);
}

/** Project rows/columns down to the selected column indices, in column order. */
export function projectColumns(
    rows: unknown[][],
    columns: string[],
    colIndices: Set<number>,
): {rows: unknown[][]; columns: string[]} {
    const sorted = Array.from(colIndices).sort((a, b) => a - b);
    return {
        rows: rows.map((row) => sorted.map((idx) => row[idx])),
        columns: sorted.map((idx) => columns[idx]),
    };
}

interface ColumnCopyOptions {
    format: CopyFormat;
    delimiter?: string;
    includeHeader?: boolean;
    tableName?: string;
    driver?: CopyDriver;
    /** How NULL is written in CSV and Markdown. Default: "null". */
    nullLabel?: string;
}

export function columnValuesForCopy(
    rows: unknown[][],
    columns: string[],
    colIndex: number,
    options: ColumnCopyOptions,
): string {
    const column = columns[colIndex];
    if (column === undefined) return '';

    const projectedRows = rows.map((row) => [row[colIndex]]);
    const projectedColumns = [column];
    const nullLabel = options.nullLabel ?? 'null';

    if (options.format === 'json') {
        return rowsToJSON(projectedRows, projectedColumns);
    }
    // A single column never holds both a key for WHERE and a value for SET, so
    // SQL UPDATE copies a column's values as INSERT.
    if (options.format === 'sql-insert' || options.format === 'sql-update') {
        return rowsToSqlInsert(
            projectedRows,
            projectedColumns,
            options.tableName ?? 'table',
            options.driver,
        );
    }
    if (options.format === 'markdown') {
        return rowsToMarkdown(projectedRows, projectedColumns, nullLabel, options.includeHeader);
    }
    if (options.includeHeader) {
        return rowsToCSVWithHeaders(projectedRows, projectedColumns, nullLabel, options.delimiter);
    }
    return rowsToCSV(projectedRows, nullLabel, options.delimiter);
}

export function columnValuesToInClause(
    rows: unknown[][],
    colIndex: number,
    driver?: CopyDriver,
): string {
    return rows.map((row) => sqlValue(row[colIndex], driver)).join(', ');
}

function sqlValue(cell: unknown, driver?: CopyDriver): string {
    if (cell === null || cell === undefined) return 'NULL';
    // TRUE/FALSE unless the driver declares `sql_syntax.boolean_literals`.
    if (typeof cell === 'boolean') return sqlBooleanLiteral(cell, driver);
    if (typeof cell === 'number') return String(cell);
    const str = typeof cell === 'object' ? JSON.stringify(cell) : String(cell);
    // A backslash-escape syntax (GoogleSQL) has no doubled-quote escape;
    // every other driver, MySQL included, keeps the standard form.
    if (stringEscapeStyle(driver) === 'backslash') return quoteSqlString(str, driver);
    return `'${str.replace(/'/g, "''")}'`;
}

function rowToSqlInsert(
    row: unknown[],
    columns: string[],
    tableName: string,
    driver?: CopyDriver,
): string {
    // Quote with the driver's own character; keep backticks when no driver is given.
    const quoteName = (name: string) => (driver ? quoteIdentifier(name, driver) : `\`${name}\``);
    const cols = columns.map(quoteName).join(', ');
    const vals = row.map((cell) => sqlValue(cell, driver)).join(', ');
    return `INSERT INTO ${quoteName(tableName)} (${cols}) VALUES (${vals});`;
}

export function rowsToSqlInsert(
    rows: unknown[][],
    columns: string[],
    tableName: string,
    driver?: CopyDriver,
): string {
    return rows.map((row) => rowToSqlInsert(row, columns, tableName, driver)).join('\n');
}

function rowToSqlUpdate(
    row: unknown[],
    columns: string[],
    tableName: string,
    pkColumns: string[],
    driver?: CopyDriver,
): string {
    // Same identifier quoting as INSERT: the driver's character, or backticks without one.
    const quoteName = (name: string) => (driver ? quoteIdentifier(name, driver) : `\`${name}\``);
    const assignments = columns
        .map((column, i) => ({column, value: row[i]}))
        .filter(({column}) => !pkColumns.includes(column))
        .map(({column, value}) => `${quoteName(column)} = ${sqlValue(value, driver)}`);
    const conditions = pkColumns.map((pk) => {
        const value = row[columns.indexOf(pk)];
        // `= NULL` never matches, so a NULL key is compared with IS NULL.
        return value === null || value === undefined
            ? `${quoteName(pk)} IS NULL`
            : `${quoteName(pk)} = ${sqlValue(value, driver)}`;
    });
    return `UPDATE ${quoteName(tableName)} SET ${assignments.join(', ')} WHERE ${conditions.join(' AND ')};`;
}

/**
 * One UPDATE per row: primary key columns go to the WHERE clause (joined with AND for a
 * composite key) and every other column to SET, quoted for the driver like the INSERT
 * format. Check {@link sqlUpdateBlocker} first; without a usable key there is no safe WHERE.
 */
export function rowsToSqlUpdate(
    rows: unknown[][],
    columns: string[],
    tableName: string,
    pkColumns: string[],
    driver?: CopyDriver,
): string {
    return rows.map((row) => rowToSqlUpdate(row, columns, tableName, pkColumns, driver)).join('\n');
}

export async function copyTextToClipboard(
    text: string,
    onError?: (error: unknown) => void,
): Promise<void> {
    try {
        await writeActiveClipboard(text);
    } catch (e) {
        console.error('Copy failed:', e);
        if (onError) {
            onError(e);
        } else {
            throw e;
        }
    }
}
