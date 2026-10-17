import type { QueryResult } from "../types/editor";
import { csvField, rowsToMarkdown } from "./clipboard";

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
