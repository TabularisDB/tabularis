import type { QueryResult } from "../types/editor";
import { rowsToMarkdown } from "./clipboard";

export type ResultExportFormat = "csv" | "json" | "markdown";

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

  if (text.includes(delimiter) || text.includes('"') || /\r?\n/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
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

  return resultToCsv(result, csvDelimiter);
}
