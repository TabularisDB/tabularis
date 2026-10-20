import type { QueryResult } from "../types/editor";
import { csvField, rowsToHtmlTable, rowsToMarkdown } from "./clipboard";

export type ResultExportFormat = "csv" | "json" | "ndjson" | "markdown" | "html";

export function getLoadedRowsExportLimit(
  result: QueryResult,
): { loadedRows: number; totalRows: number } | null {
  const totalRows = result.pagination?.total_rows;

  if (typeof totalRows !== "number" || !Number.isFinite(totalRows)) {
    return null;
  }

  const loadedRows = result.rows.length;
  return loadedRows < totalRows ? { loadedRows, totalRows } : null;
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
const NULL_CSV_VALUE = "NULL";

function rowToResultObject(
  columns: string[],
  row: unknown[],
): Record<string, unknown> {
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
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);

  return csvField(text, delimiter);
}

function resultToCsv(result: QueryResult, delimiter: string): string {
  const header = result.columns
    .map((column) => csvValue(column, delimiter))
    .join(delimiter);
  const rows = result.rows.map((row) =>
    row.map((value) => csvValue(value, delimiter)).join(delimiter),
  );
  return toLineFile([header, ...rows]);
}

/**
 * Joins line-based records into file content where every record, the last
 * one included, ends with a newline. This is what the streaming exporter's
 * `csv::Writer` writes, and what NDJSON requires.
 */
function toLineFile(lines: string[]): string {
  return lines.map((line) => `${line}\n`).join("");
}

const HTML_DOCUMENT_STYLE = [
  "body { font-family: system-ui, sans-serif; margin: 1.5rem; }",
  "table { border-collapse: collapse; }",
  "th, td { border: 1px solid; padding: 0.4rem 0.6rem; text-align: left; vertical-align: top; }",
  "th { font-weight: 600; }",
].join("\n");

/**
 * Standalone UTF-8 document around the same escaped HTML table used for
 * clipboard copy. Callers pass the rows already loaded in the grid.
 */
function resultToHtmlDocument(result: QueryResult): string {
  const table = rowsToHtmlTable(result.rows, result.columns);
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

export function formatResultForExport(
  result: QueryResult,
  format: ResultExportFormat,
  csvDelimiter = ",",
): string {
  if (format === "json") {
    const rows = result.rows.map((row) =>
      rowToResultObject(result.columns, row),
    );
    return JSON.stringify(rows, null, 2);
  }

  if (format === "ndjson") {
    return toLineFile(
      result.rows.map((row) =>
        JSON.stringify(rowToResultObject(result.columns, row)),
      ),
    );
  }

  if (format === "markdown") {
    return rowsToMarkdown(result.rows, result.columns);
  }

  if (format === "html") {
    return resultToHtmlDocument(result);
  }

  return resultToCsv(result, csvDelimiter);
}
