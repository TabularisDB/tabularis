import type {QueryResult} from '@/types/editor';
import {csvField, rowsToHtmlTable, rowsToMarkdown} from './clipboard';

export type ResultExportFormat = 'csv' | 'json' | 'ndjson' | 'markdown' | 'html';

/**
 * Which rows an export writes: every row of the query, streamed by the
 * backend (`export_query_to_file`), or only the rows loaded in the grid.
 */
export type ExportScope = 'all' | 'loaded';

/**
 * Whether the grid holds fewer rows than the query returns (see
 * `getLoadedRowsExportLimit`). Only then do the two export scopes differ,
 * so the scope selector is shown.
 */
export function hasUnloadedRows(result: QueryResult): boolean {
    return getLoadedRowsExportLimit(result) !== null;
}

/**
 * Picks the scope an export actually runs with. The requested scope only
 * applies when the grid is missing rows. When the grid already holds every
 * row, the export writes what is on screen: re-running the query would gain
 * nothing and is not harmless (an `INSERT ... RETURNING` would execute again,
 * and `now()` or `random()` would stop matching what the user sees). The
 * backend streams only when rows are actually missing and the user asked for
 * all of them. `canStream` is false for result sets that cannot be re-run on
 * their own (e.g. the extra sets of a MySQL `CALL`), which always use the grid.
 */
export function resolveExportScope(
    result: QueryResult,
    requested: ExportScope,
    canStream: boolean,
): ExportScope {
    if (!canStream) return 'loaded';
    return hasUnloadedRows(result) ? requested : 'loaded';
}

/**
 * Describes a loaded-rows export that may not contain the whole query result.
 * `totalRows` is null when the backend did not report a count, in which case
 * the result is treated as partial if more pages exist or the loaded page is
 * not the first one.
 *
 * When drivers execute queries that are not standard SELECTs (e.g. `WITH ... SELECT`,
 * `VALUES`, `SHOW`, `PRAGMA`), they do not populate `pagination`, but cap the
 * row set with `truncated: true`. A truncated result is also partial.
 */
export function getLoadedRowsExportLimit(result: QueryResult): {
    loadedRows: number;
    totalRows: number | null;
} | null {
    const loadedRows = result.rows.length;
    const pagination = result.pagination;

    if (result.truncated) {
        return {loadedRows, totalRows: null};
    }

    if (!pagination) return null;

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
