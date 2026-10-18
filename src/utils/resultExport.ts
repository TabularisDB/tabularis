import type { QueryResult } from "../types/editor";
import { csvField, rowsToHtmlTable, rowsToMarkdown } from "./clipboard";

export type ResultExportFormat = "csv" | "json" | "markdown" | "html";

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

function csvValue(value: unknown, delimiter: string): string {
  const text =
    value === null || value === undefined
      ? ""
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
  return [header, ...rows].join("\n");
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
    const rows = result.rows.map((row) => {
      const obj: Record<string, unknown> = {};
      result.columns.forEach((column, index) => {
        obj[column] = row[index] ?? null;
      });
      return obj;
    });
    return JSON.stringify(rows, null, 2);
  }

  if (format === "markdown") {
    return rowsToMarkdown(result.rows, result.columns);
  }

  if (format === "html") {
    return resultToHtmlDocument(result);
  }

  return resultToCsv(result, csvDelimiter);
}
