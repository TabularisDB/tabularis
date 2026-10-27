import type {QueryResult} from '@/types/editor';
import {
    csvField,
    rowsToHtmlTable,
    rowsToMarkdown,
    rowsToSqlInsert,
    type CopyDriver,
} from './clipboard';

export type ResultExportFormat = 'csv' | 'json' | 'ndjson' | 'markdown' | 'sql-insert' | 'html';

/**
 * Describes a loaded-rows export that may not contain the whole query result.
 * `totalRows` is null when the backend did not report a count, in which case
 * the result is treated as partial if more pages exist or the loaded page is
 * not the first one.
 */
export function getLoadedRowsExportLimit(result: QueryResult): {
    loadedRows: number;
    totalRows: number | null;
} | null {
    const pagination = result.pagination;
    if (!pagination) return null;

    const loadedRows = result.rows.length;
    const totalRows = pagination.total_rows;

    if (typeof totalRows === 'number' && Number.isFinite(totalRows)) {
        return loadedRows < totalRows ? {loadedRows, totalRows} : null;
    }

    return pagination.has_more || pagination.page > 1 ? {loadedRows, totalRows: null} : null;
}

/**
 * How a NULL cell is written into CSV.
 *
 * Matches `value_to_csv_string` in `src-tauri/src/export/format.rs`, which the
 * streaming exporter uses. The two paths previously disagreed (empty field
 * here, `NULL` there), so the same query produced different files depending on
 * which export button was used. An empty string is still an empty field: only
 * NULL gets the sentinel.
 */
const NULL_CSV_VALUE = 'NULL';

function rowToResultObject(columns: string[], row: unknown[]): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    columns.forEach((column, index) => {
        obj[column] = row[index] ?? null;
    });
    return obj;
}

function csvValue(value: unknown, delimiter: string): string {
    const text =
        value === null || value === undefined
            ? NULL_CSV_VALUE
            : typeof value === 'object'
              ? JSON.stringify(value)
              : String(value);

    return csvField(text, delimiter);
}

function rowsToCsvExport(rows: unknown[][], columns: string[], delimiter: string): string {
    const header = columns.map((column) => csvValue(column, delimiter)).join(delimiter);
    const body = rows.map((row) => row.map((value) => csvValue(value, delimiter)).join(delimiter));
    return toLineFile([header, ...body]);
}

/**
 * Joins line-based records into file content where every record, the last
 * one included, ends with a newline. This is what the streaming exporter's
 * `csv::Writer` writes, and what NDJSON requires.
 */
function toLineFile(lines: string[]): string {
    return lines.map((line) => `${line}\n`).join('');
}

const HTML_DOCUMENT_STYLE = [
    'body { font-family: system-ui, sans-serif; margin: 1.5rem; }',
    'table { border-collapse: collapse; }',
    'th, td { border: 1px solid; padding: 0.4rem 0.6rem; text-align: left; vertical-align: top; }',
    'th { font-weight: 600; }',
].join('\n');

/**
 * Standalone UTF-8 document around the same escaped HTML table used for
 * clipboard copy. Callers pass the rows already loaded in the grid.
 */
function rowsToHtmlDocument(rows: unknown[][], columns: string[]): string {
    const table = rowsToHtmlTable(rows, columns);
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Query results</title>
<style>
${HTML_DOCUMENT_STYLE}
</style>
</head>
<body>
${table}
</body>
</html>
`;
}

/**
 * Serialises already-loaded rows: the whole result, or just the rows a
 * context-menu action acts on (#1154). Every format lives here so a selected
 * row is byte-identical to the same row exported with the full result.
 */
export function formatRowsForExport(
    rows: unknown[][],
    columns: string[],
    format: ResultExportFormat,
    csvDelimiter = ',',
    tableName?: string | null,
    driver?: CopyDriver,
): string {
    if (format === 'json') {
        const objects = rows.map((row) => rowToResultObject(columns, row));
        return JSON.stringify(objects, null, 2);
    }

    if (format === 'ndjson') {
        return toLineFile(rows.map((row) => JSON.stringify(rowToResultObject(columns, row))));
    }

    if (format === 'markdown') {
        return rowsToMarkdown(rows, columns);
    }

    if (format === 'sql-insert') {
        return rowsToSqlInsert(rows, columns, tableName ?? 'table', driver);
    }

    if (format === 'html') {
        return rowsToHtmlDocument(rows, columns);
    }

    return rowsToCsvExport(rows, columns, csvDelimiter);
}

/** The same serialisation applied to every row of a query result. */
export function formatResultForExport(
    result: QueryResult,
    format: ResultExportFormat,
    csvDelimiter = ',',
): string {
    return formatRowsForExport(result.rows, result.columns, format, csvDelimiter);
}
