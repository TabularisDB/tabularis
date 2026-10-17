import type { QueryResult } from "../types/editor";
import { csvField, rowsToMarkdown } from "./clipboard";

export type ResultExportFormat = "csv" | "json" | "ndjson" | "markdown";

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
    return result.rows
      .map((row) => JSON.stringify(rowToResultObject(result.columns, row)))
      .join("\n");
  }

  if (format === "markdown") {
    return rowsToMarkdown(result.rows, result.columns);
  }

  return resultToCsv(result, csvDelimiter);
}
