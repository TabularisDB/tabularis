/**
 * DataGrid utility functions for cell formatting, sorting, and selection
 * Extracted for testability
 */

import { formatGeometricValue, isGeometricType } from "./geometry";
import { formatBlobValue, isBlobColumn, isBlobWireFormat } from "./blob";
import { isJsonColumn } from "./json";

/** Sentinel value indicating that the database DEFAULT value should be used */
export const USE_DEFAULT_SENTINEL = "__USE_DEFAULT__";

/** Fixed height of a grid row, shared by the row markup and the virtualizer. */
export const DATA_GRID_ROW_HEIGHT = 35;

/** Build an object mapping PK column names to their values from a data row. */
export function buildPkMap(
  pkColumns: string[],
  row: unknown[],
  pkIndices: number[],
): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  for (let i = 0; i < pkColumns.length; i++) {
    map[pkColumns[i]] = row[pkIndices[i]];
  }
  return map;
}

/**
 * Produce a stable string key for a pk map to use as a pendingChanges key.
 * Keys are sorted alphabetically before serializing so the result is
 * deterministic regardless of insertion order.
 */
export function serializePkKey(pkMap: Record<string, unknown>): string {
  const entries = Object.entries(pkMap).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return JSON.stringify(Object.fromEntries(entries));
}

function cellValuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "object" || typeof b === "object") {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return String(a) === String(b);
}

export type SortDirection = "asc" | "desc" | null;

/** Represents a merged row combining existing data and pending insertions */
export interface MergedRow {
  type: "existing" | "insertion";
  rowData: unknown[];
  displayIndex: number;
  tempId?: string;
}

/**
 * Formats a cell value for display in the DataGrid
 * @param value - The raw cell value
 * @param nullLabel - The label to show for null values (i18n)
 * @param columnType - Optional column data type for type-specific formatting
 * @returns Formatted string representation
 */
export function formatCellValue(
  value: unknown,
  nullLabel: string = "NULL",
  columnType?: string,
  characterMaximumLength?: number,
): string {
  // Handle geometric types first (before null check to preserve geometric NULL handling)
  if (columnType && isGeometricType(columnType)) {
    return formatGeometricValue(value);
  }

  // Handle BLOB types - show metadata instead of raw data.
  // Also handle the case where the column is typed as text-length VARBINARY but
  // the backend still returned a wire-format BLOB (e.g. non-UTF-8 binary content).
  if (
    columnType &&
    (isBlobColumn(columnType, characterMaximumLength) ||
      isBlobWireFormat(value))
  ) {
    if (value === null || value === undefined) {
      return nullLabel;
    }
    return formatBlobValue(value, columnType ?? "VARBINARY");
  }

  if (value === null || value === undefined) {
    return nullLabel;
  }

  if (columnType && isJsonColumn(columnType)) {
    return JSON.stringify(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

export type ResultValueType = "number" | "string" | "date" | "boolean";

/**
 * Classifies a non-null cell value into a semantic type used for result
 * colorization. Prefers the column's declared type, then falls back to the
 * runtime JS type. NULL is handled separately by the cell renderer.
 */
export function getResultValueType(
  value: unknown,
  columnType?: string,
): ResultValueType {
  if (typeof value === "boolean") return "boolean";

  if (columnType) {
    const t = columnType.toLowerCase();
    if (/bool|^bit/.test(t)) return "boolean";
    if (/date|time|timestamp|year/.test(t)) return "date";
    if (/\b(?:tiny|small|medium|big)?int(?:eger)?\d*\b|serial|float|double|decimal|numeric|real|money|number|fixed/.test(t))
      return "number";
  }

  if (typeof value === "number" || typeof value === "bigint") return "number";
  return "string";
}

/**
 * Determines the sort state for a column based on the current sort clause
 * @param columnName - The column to check
 * @param sortClause - The current ORDER BY clause (e.g., "name ASC, id DESC")
 * @returns The sort direction for this column: "asc", "desc", or null
 */
export function getColumnSortState(
  columnName: string,
  sortClause: string | undefined,
): SortDirection {
  if (!sortClause) return null;

  // Strip identifier quotes so postgres clauses like "Status" DESC match column names
  const clauseForMatch = sortClause
    .replace(/"([^"]*)"/g, "$1")
    .replace(/`([^`]*)`/g, "$1");
  const normalizedClause = clauseForMatch.toLowerCase();
  const normalizedCol = columnName.toLowerCase();

  const patterns = [
    new RegExp(`\\b${escapeRegExp(normalizedCol)}\\s+(asc|desc)\\b`),
    new RegExp(`\\b${escapeRegExp(normalizedCol)}\\b`),
  ];

  for (const pattern of patterns) {
    const match = normalizedClause.match(pattern);
    if (match) {
      if (match[1]) {
        return match[1] === "asc" ? "asc" : "desc";
      }
      return "asc";
    }
  }

  return null;
}


/**
 * Calculates a range of indices for shift-click selection
 * @param startIndex - The previously selected index (anchor)
 * @param endIndex - The newly clicked index
 * @returns Array of indices from start to end (inclusive)
 */
export function calculateSelectionRange(
  startIndex: number,
  endIndex: number,
): number[] {
  const start = Math.min(startIndex, endIndex);
  const end = Math.max(startIndex, endIndex);

  const range: number[] = [];
  for (let i = start; i <= end; i++) {
    range.push(i);
  }
  return range;
}

/** Normalized rectangular cell range (inclusive bounds). */
export interface CellRangeRect {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
}

export interface CellPosition {
  rowIndex: number;
  colIndex: number;
}

/** Arrow keys that extend a cell range when pressed with Shift. */
export type RangeExtendKey =
  | "ArrowUp"
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight";

/**
 * Returns the corner of a range opposite to the anchor — the cell that moves
 * when the range is extended with Shift+Arrow (Google Sheets semantics: the
 * anchor stays put, the active corner walks).
 */
export function getRangeCursor(
  anchor: CellPosition,
  range: CellRangeRect | null,
): CellPosition {
  if (!range) return anchor;
  return {
    rowIndex: anchor.rowIndex === range.minRow ? range.maxRow : range.minRow,
    colIndex: anchor.colIndex === range.minCol ? range.maxCol : range.minCol,
  };
}

/** Builds the normalized rectangle spanning two cells. */
export function buildCellRange(
  a: CellPosition,
  b: CellPosition,
): CellRangeRect {
  return {
    minRow: Math.min(a.rowIndex, b.rowIndex),
    maxRow: Math.max(a.rowIndex, b.rowIndex),
    minCol: Math.min(a.colIndex, b.colIndex),
    maxCol: Math.max(a.colIndex, b.colIndex),
  };
}

/**
 * Moves a cell position in the direction of an arrow key, clamped to the grid.
 * With `toEdge` the position jumps straight to the first/last row or column
 * (spreadsheet Ctrl+Arrow); otherwise it moves a single step.
 */
export function moveCellPosition(
  pos: CellPosition,
  key: RangeExtendKey,
  totalRows: number,
  totalCols: number,
  toEdge = false,
): CellPosition {
  let { rowIndex, colIndex } = pos;
  switch (key) {
    case "ArrowUp":
      rowIndex = toEdge ? 0 : Math.max(0, rowIndex - 1);
      break;
    case "ArrowDown":
      rowIndex = toEdge ? totalRows - 1 : Math.min(totalRows - 1, rowIndex + 1);
      break;
    case "ArrowLeft":
      colIndex = toEdge ? 0 : Math.max(0, colIndex - 1);
      break;
    case "ArrowRight":
      colIndex = toEdge ? totalCols - 1 : Math.min(totalCols - 1, colIndex + 1);
      break;
  }
  return { rowIndex, colIndex };
}

/**
 * Extends (or shrinks) a cell range from its moving corner while keeping the
 * anchor fixed — one step by default, straight to the grid edge with `toEdge`
 * (Shift+Arrow vs Ctrl+Shift+Arrow). Returns the new range and cursor, or
 * null when the cursor is already at the grid edge in that direction.
 */
export function extendCellRange(
  anchor: CellPosition,
  range: CellRangeRect | null,
  key: RangeExtendKey,
  totalRows: number,
  totalCols: number,
  toEdge = false,
): { range: CellRangeRect; cursor: CellPosition } | null {
  const cursor = getRangeCursor(anchor, range);
  const next = moveCellPosition(cursor, key, totalRows, totalCols, toEdge);
  if (next.rowIndex === cursor.rowIndex && next.colIndex === cursor.colIndex) {
    return null;
  }
  return { range: buildCellRange(anchor, next), cursor: next };
}

/**
 * Toggles a value in a Set (adds if not present, removes if present)
 * @param set - The Set to modify
 * @param value - The value to toggle
 * @returns New Set with the value toggled
 */
export function toggleSetValue<T>(set: Set<T>, value: T): Set<T> {
  const newSet = new Set(set);
  if (newSet.has(value)) {
    newSet.delete(value);
  } else {
    newSet.add(value);
  }
  return newSet;
}

/** Column metadata relevant for cell display resolution */
export interface ColumnDisplayInfo {
  colName: string;
  autoIncrementColumns?: string[];
  defaultValueColumns?: string[];
  nullableColumns?: string[];
}

/** Result of resolving what value and styling a cell should display */
export interface ResolvedCellDisplay {
  displayValue: unknown;
  hasPendingChange: boolean;
  isModified: boolean;
  isAutoIncrementPlaceholder: boolean;
  isDefaultValuePlaceholder: boolean;
}

/**
 * Resolves the display value for an insertion cell, computing placeholder states
 * for auto-increment and default-value columns.
 */
export function resolveInsertionCellDisplay(
  cellValue: unknown,
  columnInfo: ColumnDisplayInfo,
): ResolvedCellDisplay {
  let displayValue = cellValue;
  let isAutoIncrementPlaceholder = false;
  let isDefaultValuePlaceholder = false;
  const isModified = displayValue !== null && displayValue !== "";

  if (
    columnInfo.autoIncrementColumns?.includes(columnInfo.colName) &&
    (displayValue === null || displayValue === "")
  ) {
    displayValue = "<generated>";
    isAutoIncrementPlaceholder = true;
  } else if (
    columnInfo.defaultValueColumns?.includes(columnInfo.colName) &&
    !columnInfo.nullableColumns?.includes(columnInfo.colName) &&
    (displayValue === null || displayValue === "")
  ) {
    displayValue = "<default>";
    isDefaultValuePlaceholder = true;
  }

  return {
    displayValue,
    hasPendingChange: true,
    isModified,
    isAutoIncrementPlaceholder,
    isDefaultValuePlaceholder,
  };
}

/**
 * Resolves the display value for an existing row cell, checking pending changes
 * and computing placeholder states.
 */
export function resolveExistingCellDisplay(
  cellValue: unknown,
  pkVal: string | null,
  pkColumns: string[] | null | undefined,
  pendingChanges:
    | Record<
        string,
        { pkOriginalValue: unknown; changes: Record<string, unknown> }
      >
    | undefined,
  columnInfo: ColumnDisplayInfo,
): ResolvedCellDisplay {
  const hasPk = pkColumns && pkColumns.length > 0;
  const pendingVal =
    hasPk && pkVal && pendingChanges?.[pkVal]?.changes?.[columnInfo.colName];
  const hasPendingChange = hasPk && pkVal ? pendingVal !== undefined : false;
  let displayValue = hasPendingChange ? pendingVal : cellValue;
  const isModified =
    hasPendingChange && !cellValuesEqual(pendingVal, cellValue);
  let isAutoIncrementPlaceholder = false;
  let isDefaultValuePlaceholder = false;

  if (hasPendingChange) {
    if (displayValue === USE_DEFAULT_SENTINEL) {
      displayValue = "<default>";
      isDefaultValuePlaceholder = true;
    } else if (displayValue === null || displayValue === "") {
      if (columnInfo.autoIncrementColumns?.includes(columnInfo.colName)) {
        displayValue = "<generated>";
        isAutoIncrementPlaceholder = true;
      } else if (
        columnInfo.defaultValueColumns?.includes(columnInfo.colName) &&
        !columnInfo.nullableColumns?.includes(columnInfo.colName)
      ) {
        displayValue = "<default>";
        isDefaultValuePlaceholder = true;
      }
    }
  }

  return {
    displayValue,
    hasPendingChange,
    isModified,
    isAutoIncrementPlaceholder,
    isDefaultValuePlaceholder,
  };
}

/** Parameters for computing a cell's CSS class */
export interface CellClassParams {
  isPendingDelete: boolean;
  isSelected: boolean;
  isInsertion: boolean;
  isAutoIncrementPlaceholder: boolean;
  isDefaultValuePlaceholder: boolean;
  isModified: boolean;
  /** JSON cells render their own colored tokens — skip overlay text/italic. */
  isJsonCell?: boolean;
}

/**
 * Computes the dynamic CSS class for a data cell based on its state.
 * Returns only the state-dependent portion; base classes are applied separately.
 */
export function getCellStateClass(params: CellClassParams): string {
  const {
    isPendingDelete,
    isSelected,
    isInsertion,
    isAutoIncrementPlaceholder,
    isDefaultValuePlaceholder,
    isModified,
    isJsonCell = false,
  } = params;

  const isPlaceholder = isAutoIncrementPlaceholder || isDefaultValuePlaceholder;

  if (isPendingDelete) {
    return "text-red-400/60 line-through decoration-red-500/30";
  }

  if (isSelected && isInsertion) {
    if (isPlaceholder) return "text-muted italic select-none";
    if (isModified)
      return isJsonCell
        ? "bg-blue-500/40 border-l-2 border-l-blue-400"
        : "bg-blue-600/20 text-blue-200 italic font-medium";
    return isJsonCell ? "bg-blue-900/20" : "bg-blue-900/20 text-secondary italic";
  }

  if (isInsertion) {
    if (isPlaceholder) return "text-muted italic select-none";
    if (isModified)
      return isJsonCell
        ? "bg-green-500/40 border-l-2 border-l-green-400"
        : "bg-green-500/15 text-green-200 italic";
    return isJsonCell ? "bg-green-500/5" : "bg-green-500/5 text-secondary italic";
  }

  if (isModified) {
    return isJsonCell
      ? "bg-blue-500/40 border-l-2 border-l-blue-400"
      : "bg-blue-600/30 text-blue-100 italic font-medium";
  }

  return isJsonCell ? "" : "text-secondary";
}

/**
 * Escapes special regex characters in a string
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** One cell write produced by a paste operation */
export interface PasteTarget {
  rowIndex: number;
  colIndex: number;
  value: string;
}

/** Splits one delimited line into cells, honoring double-quote escaping. */
function splitDelimitedLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

/**
 * Parses clipboard text into a cell matrix. Tab-separated cells win
 * (spreadsheet convention); multi-line text without tabs is parsed as CSV so
 * the grid's own comma/semicolon/pipe copy formats round-trip. A single line
 * without tabs is always one value — free text like "hello, world" must land
 * in one cell. A single trailing newline (Excel/Sheets append one to every
 * copy) is ignored.
 *
 * `delimiterHint` is the grid's configured CSV delimiter; when it appears in
 * the text it takes precedence over frequency-based detection.
 */
export function parsePasteMatrix(
  text: string,
  delimiterHint?: string,
): string[][] {
  if (!text) return [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();

  if (lines.some((line) => line.includes("\t"))) {
    return lines.map((line) => line.split("\t"));
  }

  if (lines.length === 1) {
    return lines[0] === "" ? [] : [[lines[0]]];
  }

  const first = lines[0];
  const count = (d: string) => first.split(d).length - 1;
  let delimiter: string | null = null;
  if (delimiterHint && delimiterHint !== "\t" && count(delimiterHint) > 0) {
    delimiter = delimiterHint;
  } else {
    let best = 0;
    for (const candidate of [";", ",", "|"]) {
      if (count(candidate) > best) {
        best = count(candidate);
        delimiter = candidate;
      }
    }
  }
  if (!delimiter) {
    return lines.map((line) => [line]);
  }
  return lines.map((line) => splitDelimitedLine(line, delimiter!));
}

/**
 * Drops a leading header row that round-tripped from the grid's own copy
 * (the "export column names" option). Because targets are mapped
 * positionally, the first row must match the column names starting at the
 * paste anchor, in order — a positional match, not a membership test, so
 * external data whose values merely coincide with column names is kept.
 */
export function stripHeaderRow(
  matrix: string[][],
  columnNames: string[],
  anchorCol: number,
): string[][] {
  if (matrix.length < 2) return matrix;
  const first = matrix[0];
  if (
    first.length > 0 &&
    first.every((cell, i) => columnNames[anchorCol + i] === cell)
  ) {
    return matrix.slice(1);
  }
  return matrix;
}

/**
 * Maps a parsed paste matrix onto grid cells.
 *
 * A single value fills every cell of the selected range (spreadsheet-style
 * fill); a multi-cell matrix is anchored at the range's top-left (or the
 * anchor cell when no range is selected) and clipped at the grid's edges.
 */
export function computePasteTargets(
  matrix: string[][],
  anchor: { rowIndex: number; colIndex: number },
  totalRows: number,
  totalCols: number,
  range?: {
    minRow: number;
    maxRow: number;
    minCol: number;
    maxCol: number;
  } | null,
): PasteTarget[] {
  const targets: PasteTarget[] = [];
  if (matrix.length === 0) return targets;

  if (range && matrix.length === 1 && matrix[0].length === 1) {
    const value = matrix[0][0];
    for (let r = range.minRow; r <= Math.min(range.maxRow, totalRows - 1); r++) {
      for (
        let c = range.minCol;
        c <= Math.min(range.maxCol, totalCols - 1);
        c++
      ) {
        targets.push({ rowIndex: r, colIndex: c, value });
      }
    }
    return targets;
  }

  const baseRow = range ? range.minRow : anchor.rowIndex;
  const baseCol = range ? range.minCol : anchor.colIndex;
  matrix.forEach((cells, r) => {
    const rowIndex = baseRow + r;
    if (rowIndex >= totalRows) return;
    cells.forEach((value, c) => {
      const colIndex = baseCol + c;
      if (colIndex >= totalCols) return;
      targets.push({ rowIndex, colIndex, value });
    });
  });
  return targets;
}
