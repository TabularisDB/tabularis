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

function markdownCell(cell: unknown, nullLabel: string = "null"): string {
  return formatCellValue(cell, nullLabel)
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>");
}

export function rowsToMarkdown(rows: unknown[][], columns: string[], nullLabel: string = "null", includeHeaders: boolean = true): string {
  const body = rows.map(
    (row) => `| ${row.map((cell) => markdownCell(cell, nullLabel)).join(" | ")} |`,
  );
  if (!includeHeaders) return body.join("\n");
  const header = `| ${columns.map((c) => markdownCell(c)).join(" | ")} |`;
  const separator = `| ${columns.map(() => "---").join(" | ")} |`;
  return [header, separator, ...body].join("\n");
}

export function getSelectedRows(
  data: unknown[][],
  selectedIndices: Set<number>
): unknown[][] {
  const sortedIndices = Array.from(selectedIndices).sort((a, b) => a - b);
  return sortedIndices.map((idx) => data[idx]);
}

type CopyFormat = "csv" | "json" | "sql-insert" | "markdown";

interface ColumnCopyOptions {
  format: CopyFormat;
  delimiter?: string;
  includeHeader?: boolean;
  tableName?: string;
}

export function columnValuesForCopy(
  rows: unknown[][],
  columns: string[],
  colIndex: number,
  options: ColumnCopyOptions,
): string {
  const column = columns[colIndex];
  if (column === undefined) return "";

  const projectedRows = rows.map((row) => [row[colIndex]]);
  const projectedColumns = [column];

  if (options.format === "json") {
    return rowsToJSON(projectedRows, projectedColumns);
  }
  if (options.format === "sql-insert") {
    return rowsToSqlInsert(
      projectedRows,
      projectedColumns,
      options.tableName ?? "table",
    );
  }
  if (options.format === "markdown") {
    return rowsToMarkdown(
      projectedRows,
      projectedColumns,
      "null",
      options.includeHeader,
    );
  }
  if (options.includeHeader) {
    return rowsToCSVWithHeaders(
      projectedRows,
      projectedColumns,
      "null",
      options.delimiter,
    );
  }
  return rowsToCSV(projectedRows, "null", options.delimiter);
}

export function columnValuesToInClause(
  rows: unknown[][],
  colIndex: number,
): string {
  return rows.map((row) => sqlValue(row[colIndex])).join(", ");
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
