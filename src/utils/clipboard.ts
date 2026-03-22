import { formatCellValue } from './dataGrid';

export function rowToTSV(row: unknown[], nullLabel: string = "null"): string {
  return row
    .map((cell) => formatCellValue(cell, nullLabel))
    .join("\t");
}

export function rowsToTSV(rows: unknown[][], nullLabel: string = "null"): string {
  return rows
    .map((row) => rowToTSV(row, nullLabel))
    .join("\n");
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
