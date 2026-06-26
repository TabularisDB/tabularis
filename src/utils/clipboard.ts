import { formatCellValue } from './dataGrid';

export function rowToCSV(row: unknown[], nullLabel: string = "null", delimiter: string = ","): string {
  return row
    .map((cell) => formatCellValue(cell, nullLabel))
    .join(delimiter);
}

export function rowsToCSV(rows: unknown[][], nullLabel: string = "null", delimiter: string = ","): string {
  return rows
    .map((row) => rowToCSV(row, nullLabel, delimiter))
    .join("\n");
}

export function rowsToCSVWithHeaders(rows: unknown[][], columns: string[], nullLabel: string = "null", delimiter: string = ","): string {
  const header = columns.join(delimiter);
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

export function getSelectedRows(
  data: unknown[][],
  selectedIndices: Set<number>
): unknown[][] {
  const sortedIndices = Array.from(selectedIndices).sort((a, b) => a - b);
  return sortedIndices.map((idx) => data[idx]);
}

function sqlValue(cell: unknown): string {
  if (cell === null || cell === undefined) return "NULL";
  if (typeof cell === "boolean") return cell ? "TRUE" : "FALSE";
  if (typeof cell === "number") return String(cell);
  const str = typeof cell === "object" ? JSON.stringify(cell) : String(cell);
  return `'${str.replace(/'/g, "''")}'`;
}

function rowToSqlInsert(
  row: unknown[],
  columns: string[],
  tableName: string,
): string {
  const cols = columns.map((c) => `\`${c}\``).join(", ");
  const vals = row.map(sqlValue).join(", ");
  return `INSERT INTO \`${tableName}\` (${cols}) VALUES (${vals});`;
}

export function rowsToSqlInsert(
  rows: unknown[][],
  columns: string[],
  tableName: string,
): string {
  return rows.map((row) => rowToSqlInsert(row, columns, tableName)).join("\n");
}

export async function copyTextToClipboard(
  text: string,
  onError?: (error: unknown) => void
): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    console.error("Copy failed:", e);
    if (onError) {
      onError(e);
    } else {
      throw e;
    }
  }
}
