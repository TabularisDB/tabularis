/**
 * DataGrid utility functions for cell formatting, sorting, and selection
 * Extracted for testability
 */

import {formatGeometricValue, isGeometricType} from './geometry';
import {formatBlobValue, isBlobColumn, isBlobWireFormat} from './blob';
import {isJsonColumn} from './json';
import type {ResultCommands} from '@/types/commands';
import {escapeRegExp} from './escape';

/** Sentinel value indicating that the database DEFAULT value should be used */
export const USE_DEFAULT_SENTINEL = '__USE_DEFAULT__';

/** Fixed height of a grid row, shared by the row markup and the virtualizer. */
export const DATA_GRID_ROW_HEIGHT = 35;

/** Narrowest a data column can be resized to: its padding plus a few characters. */
export const DATA_GRID_MIN_COLUMN_WIDTH = 48;

/** Widest a data column can be resized to. */
export const DATA_GRID_MAX_COLUMN_WIDTH = 2000;

/** Whether a database column stores UUID values supported by the grid. */
export function isUuidColumnType(dataType: string): boolean {
    const normalizedType = dataType.trim().toLowerCase();
    return normalizedType === 'uuid' || normalizedType === 'uniqueidentifier';
}

/**
 * Whether the row at `rowIndex` gets the zebra-stripe background — only when
 * the setting is enabled, and then on every other row (odd indices) so the
 * first row stays unstriped.
 */
export function isZebraStripedRow(rowIndex: number, enabled: boolean): boolean {
    return enabled && rowIndex % 2 === 1;
}

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
    const entries = Object.entries(pkMap).sort(([a], [b]) => a.localeCompare(b));
    return JSON.stringify(Object.fromEntries(entries));
}

function cellValuesEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a === 'object' || typeof b === 'object') {
        try {
            return JSON.stringify(a) === JSON.stringify(b);
        } catch {
            return false;
        }
    }
    return String(a) === String(b);
}

export type SortDirection = 'asc' | 'desc' | null;

/** Represents a merged row combining existing data and pending insertions */
export interface MergedRow {
    type: 'existing' | 'insertion';
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
    nullLabel: string = 'NULL',
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
        (isBlobColumn(columnType, characterMaximumLength) || isBlobWireFormat(value))
    ) {
        if (value === null || value === undefined) {
            return nullLabel;
        }
        return formatBlobValue(value, columnType ?? 'VARBINARY');
    }

    if (value === null || value === undefined) {
        return nullLabel;
    }

    if (columnType && isJsonColumn(columnType)) {
        return JSON.stringify(value);
    }

    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }

    if (typeof value === 'object') {
        return JSON.stringify(value);
    }

    return String(value);
}

export type ResultValueType = 'number' | 'string' | 'date' | 'boolean';

/**
 * Classifies a non-null cell value into a semantic type used for result
 * colorization. Prefers the column's declared type, then falls back to the
 * runtime JS type. NULL is handled separately by the cell renderer.
 */
export function getResultValueType(value: unknown, columnType?: string): ResultValueType {
    if (typeof value === 'boolean') return 'boolean';

    if (columnType) {
        const t = columnType.toLowerCase();
        if (/bool|^bit/.test(t)) return 'boolean';
        if (/date|time|timestamp|year/.test(t)) return 'date';
        if (
            /\b(?:tiny|small|medium|big)?int(?:eger)?\d*\b|serial|float|double|decimal|numeric|real|money|number|fixed/.test(
                t,
            )
        )
            return 'number';
    }

    if (typeof value === 'number' || typeof value === 'bigint') return 'number';
    return 'string';
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
    const clauseForMatch = sortClause.replace(/"([^"]*)"/g, '$1').replace(/`([^`]*)`/g, '$1');
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
                return match[1] === 'asc' ? 'asc' : 'desc';
            }
            return 'asc';
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
export function calculateSelectionRange(startIndex: number, endIndex: number): number[] {
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

interface DataGridResultCommandsInput {
    cellRange: CellRangeRect | null;
    focusedCell: CellPosition | null;
    selectedRowIndices: ReadonlySet<number>;
    selectedColIndices: ReadonlySet<number>;
    columns: string[];
    dataLength: number;
    totalRows: number | null | undefined;
    hasRowsBeyondLoadedPage: boolean;
    onCopyAllRows?: () => void | Promise<void>;
    copyCellRange: () => void | Promise<void>;
    copyCellValue: (rowIndex: number, colIndex: number) => void | Promise<void>;
    copySelectedRows: () => void | Promise<void>;
    copySelectedColumns: () => void | Promise<void>;
    copyColumnValuesAsSqlIn: (columnIndex: number) => void | Promise<void>;
    copyAllLoadedRows: () => void | Promise<void>;
    /** Hidden columns (#1299): a cell range copies only its visible columns. */
    hiddenColIndices?: ReadonlySet<number>;
}

export function createDataGridResultCommands({
    cellRange,
    focusedCell,
    selectedRowIndices,
    selectedColIndices,
    columns,
    dataLength,
    totalRows,
    hasRowsBeyondLoadedPage,
    onCopyAllRows,
    copyCellRange,
    copyCellValue,
    copySelectedRows,
    copySelectedColumns,
    copyColumnValuesAsSqlIn,
    copyAllLoadedRows,
    hiddenColIndices,
}: DataGridResultCommandsInput): ResultCommands {
    const commands: ResultCommands = {};

    if (cellRange) {
        let rangeColumns = 0;
        for (let col = cellRange.minCol; col <= cellRange.maxCol; col++) {
            if (!hiddenColIndices?.has(col)) rangeColumns++;
        }
        commands.copySelectedCells = {
            count: (cellRange.maxRow - cellRange.minRow + 1) * rangeColumns,
            execute: copyCellRange,
        };
    } else if (focusedCell) {
        commands.copySelectedCells = {
            count: 1,
            execute: () => copyCellValue(focusedCell.rowIndex, focusedCell.colIndex),
        };
    }

    if (selectedRowIndices.size > 0) {
        commands.copySelectedRows = {
            count: selectedRowIndices.size,
            execute: copySelectedRows,
        };
    }

    if (selectedColIndices.size > 0) {
        commands.copySelectedColumns = {
            count: selectedColIndices.size,
            execute: copySelectedColumns,
        };
    }

    if (selectedColIndices.size === 1) {
        const columnIndex = selectedColIndices.values().next().value;
        if (columnIndex !== undefined) {
            commands.copyColumnValuesAsSqlIn = {
                columnName: columns[columnIndex] ?? '',
                execute: () => copyColumnValuesAsSqlIn(columnIndex),
            };
        }
    }

    if (dataLength > 0 && (!hasRowsBeyondLoadedPage || onCopyAllRows)) {
        commands.copyAllRows = {
            count: hasRowsBeyondLoadedPage ? (totalRows ?? undefined) : dataLength,
            execute: hasRowsBeyondLoadedPage && onCopyAllRows ? onCopyAllRows : copyAllLoadedRows,
        };
    }

    return commands;
}

/** Arrow keys that extend a cell range when pressed with Shift. */
export type RangeExtendKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

/**
 * Returns the corner of a range opposite to the anchor — the cell that moves
 * when the range is extended with Shift+Arrow (Google Sheets semantics: the
 * anchor stays put, the active corner walks).
 */
export function getRangeCursor(anchor: CellPosition, range: CellRangeRect | null): CellPosition {
    if (!range) return anchor;
    return {
        rowIndex: anchor.rowIndex === range.minRow ? range.maxRow : range.minRow,
        colIndex: anchor.colIndex === range.minCol ? range.maxCol : range.minCol,
    };
}

/** Builds the normalized rectangle spanning two cells. */
export function buildCellRange(a: CellPosition, b: CellPosition): CellRangeRect {
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
    let {rowIndex, colIndex} = pos;
    switch (key) {
        case 'ArrowUp':
            rowIndex = toEdge ? 0 : Math.max(0, rowIndex - 1);
            break;
        case 'ArrowDown':
            rowIndex = toEdge ? totalRows - 1 : Math.min(totalRows - 1, rowIndex + 1);
            break;
        case 'ArrowLeft':
            colIndex = toEdge ? 0 : Math.max(0, colIndex - 1);
            break;
        case 'ArrowRight':
            colIndex = toEdge ? totalCols - 1 : Math.min(totalCols - 1, colIndex + 1);
            break;
    }
    return {rowIndex, colIndex};
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
): {range: CellRangeRect; cursor: CellPosition} | null {
    const cursor = getRangeCursor(anchor, range);
    const next = moveCellPosition(cursor, key, totalRows, totalCols, toEdge);
    if (next.rowIndex === cursor.rowIndex && next.colIndex === cursor.colIndex) {
        return null;
    }
    return {range: buildCellRange(anchor, next), cursor: next};
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
    const isModified = displayValue !== null && displayValue !== '';

    if (
        columnInfo.autoIncrementColumns?.includes(columnInfo.colName) &&
        (displayValue === null || displayValue === '')
    ) {
        displayValue = '<generated>';
        isAutoIncrementPlaceholder = true;
    } else if (
        columnInfo.defaultValueColumns?.includes(columnInfo.colName) &&
        !columnInfo.nullableColumns?.includes(columnInfo.colName) &&
        (displayValue === null || displayValue === '')
    ) {
        displayValue = '<default>';
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
        Record<string, {pkOriginalValue: unknown; changes: Record<string, unknown>}> | undefined,
    columnInfo: ColumnDisplayInfo,
): ResolvedCellDisplay {
    const hasPk = pkColumns && pkColumns.length > 0;
    const pendingVal = hasPk && pkVal && pendingChanges?.[pkVal]?.changes?.[columnInfo.colName];
    const hasPendingChange = hasPk && pkVal ? pendingVal !== undefined : false;
    let displayValue = hasPendingChange ? pendingVal : cellValue;
    const isModified = hasPendingChange && !cellValuesEqual(pendingVal, cellValue);
    let isAutoIncrementPlaceholder = false;
    let isDefaultValuePlaceholder = false;

    if (hasPendingChange) {
        if (displayValue === USE_DEFAULT_SENTINEL) {
            displayValue = '<default>';
            isDefaultValuePlaceholder = true;
        } else if (displayValue === null || displayValue === '') {
            if (columnInfo.autoIncrementColumns?.includes(columnInfo.colName)) {
                displayValue = '<generated>';
                isAutoIncrementPlaceholder = true;
            } else if (
                columnInfo.defaultValueColumns?.includes(columnInfo.colName) &&
                !columnInfo.nullableColumns?.includes(columnInfo.colName)
            ) {
                displayValue = '<default>';
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

    // Edited values keep the primary text color: the tint already marks the
    // state, and a semantic color on its own tint is unreadable (#826).

    if (isPendingDelete) {
        return 'text-semantic-deleted/60 line-through decoration-semantic-deleted/30';
    }

    if (isSelected && isInsertion) {
        if (isPlaceholder) return 'text-muted italic select-none';
        if (isModified)
            return isJsonCell
                ? 'bg-semantic-modified/25 border-l-2 border-l-semantic-modified'
                : 'bg-semantic-modified/20 text-primary italic font-medium';
        return isJsonCell ? 'bg-accent-primary/10' : 'bg-accent-primary/10 text-secondary italic';
    }

    if (isInsertion) {
        if (isPlaceholder) return 'text-muted italic select-none';
        if (isModified)
            return isJsonCell
                ? 'bg-semantic-new/25 border-l-2 border-l-semantic-new'
                : 'bg-semantic-new/15 text-primary italic';
        return isJsonCell ? 'bg-semantic-new/5' : 'bg-semantic-new/5 text-secondary italic';
    }

    if (isModified) {
        return isJsonCell
            ? 'bg-semantic-modified/25 border-l-2 border-l-semantic-modified'
            : 'bg-semantic-modified/30 text-primary italic font-medium';
    }

    return isJsonCell ? '' : 'text-secondary';
}

/**
 * Whether writing `value` puts a cell back to its stored `original`, so the
 * pending change can be cleared instead of staging a no-op. Text matches by
 * its text, as a paste always has: "5" over 5, and "null" (how a copied NULL
 * reads) over NULL. A NULL or structured value written by "Edit selection"
 * only matches itself, so Set NULL over the text "null" and a JSON value
 * filled over another one are staged.
 */
export function isOriginalCellValue(value: unknown, original: unknown): boolean {
    const isStructured = (v: unknown) => typeof v === 'object' && v !== null;
    if (value === null || isStructured(value) || isStructured(original)) {
        return Object.is(value, original) || (value === null && original === undefined);
    }
    return String(value) === String(original);
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
    let current = '';
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
            current = '';
        } else {
            current += ch;
        }
    }
    cells.push(current);
    return cells;
}

/**
 * Whether a quoted field pasted into a JSON column is the grid's own CSV
 * quoting of a JSON value, so its quotes can be removed. The copy only
 * quotes a field that contains the delimiter, a quote or a line break (see
 * `csvField`), and a value from a JSON column is valid JSON. Anything else,
 * like the JSON string `"abc"` or `""`, keeps its quotes.
 */
function isCsvQuotedJson(unquoted: string, delimiter?: string): boolean {
    const neededQuotes =
        /["\t\r\n]/.test(unquoted) || (!!delimiter && unquoted.includes(delimiter));
    if (!neededQuotes) return false;
    try {
        JSON.parse(unquoted);
        return true;
    } catch {
        return false;
    }
}

/**
 * Splits one tab-separated line into cells. A cell that is one fully quoted
 * field, as the CSV copy writes it, is unquoted (its doubled quotes become
 * one); any other cell, including one that only starts with a quote, is kept
 * as written. A line with no tab is a single cell and is unquoted the same
 * way. `keepQuotes` can veto the unquoting of a cell, given its index in the
 * line and its unquoted text.
 */
function splitTabLine(
    line: string,
    keepQuotes?: (colIndex: number, unquoted: string) => boolean,
): string[] {
    const cells: string[] = [];
    let pos = 0;
    for (;;) {
        if (line[pos] === '"') {
            const quoted = /^"((?:[^"]|"")*)"(?=\t|$)/.exec(line.slice(pos));
            const unquoted = quoted?.[1].replace(/""/g, '"');
            if (quoted && unquoted !== undefined && !keepQuotes?.(cells.length, unquoted)) {
                cells.push(unquoted);
                pos += quoted[0].length + 1;
                if (pos > line.length) return cells;
                continue;
            }
        }
        const end = line.indexOf('\t', pos);
        if (end === -1) {
            cells.push(line.slice(pos));
            return cells;
        }
        cells.push(line.slice(pos, end));
        pos = end + 1;
    }
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
 *
 * When quotes are removed: tab-separated lines, a single line and a
 * one-column copy (lines without any delimiter) unquote a cell that is one
 * fully quoted field, so the grid's own CSV copy round-trips; `""` becomes
 * an empty string. A cell that only starts with a quote is kept as written.
 * `isJsonColumn` tells, by the cell's index in its line, which cells land in
 * a JSON column. There the quotes are only removed when the field is the
 * CSV copy's quoting of a JSON value (it needed quoting and is valid JSON),
 * so text copied from elsewhere, like the JSON string `"abc"`, keeps them.
 * Multi-line text split on a CSV delimiter is parsed as CSV in every column.
 */
export function parsePasteMatrix(
    text: string,
    delimiterHint?: string,
    isJsonColumn?: (colIndex: number) => boolean,
): string[][] {
    if (!text) return [];
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();

    const keepQuotes = isJsonColumn
        ? (colIndex: number, unquoted: string) =>
              isJsonColumn(colIndex) && !isCsvQuotedJson(unquoted, delimiterHint)
        : undefined;

    if (lines.some((line) => line.includes('\t'))) {
        return lines.map((line) => splitTabLine(line, keepQuotes));
    }

    if (lines.length === 1) {
        return lines[0] === '' ? [] : [splitTabLine(lines[0], keepQuotes)];
    }

    const first = lines[0];
    const count = (d: string) => first.split(d).length - 1;
    let delimiter: string | null = null;
    if (delimiterHint && delimiterHint !== '\t' && count(delimiterHint) > 0) {
        delimiter = delimiterHint;
    } else {
        let best = 0;
        for (const candidate of [';', ',', '|']) {
            if (count(candidate) > best) {
                best = count(candidate);
                delimiter = candidate;
            }
        }
    }
    if (!delimiter) {
        return lines.map((line) => splitTabLine(line, keepQuotes));
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
    if (first.length > 0 && first.every((cell, i) => columnNames[anchorCol + i] === cell)) {
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
    anchor: {rowIndex: number; colIndex: number},
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
            for (let c = range.minCol; c <= Math.min(range.maxCol, totalCols - 1); c++) {
                targets.push({rowIndex: r, colIndex: c, value});
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
            targets.push({rowIndex, colIndex, value});
        });
    });
    return targets;
}

/**
 * Column widths measured once for a result set and then held fixed, so that
 * scrolling a virtualized grid (which only renders the visible rows) does not
 * resize the columns as wider or narrower values come into view (#844).
 */
export interface LockedColumnWidths {
    key: string;
    widths: number[];
    /** Set once the user resized a column of this layout (#1151). */
    resized?: boolean;
}

/**
 * Identifies the column layout the widths were measured for. A new set of
 * columns, or the first rows arriving in a previously empty result, calls for
 * a fresh measurement; paging or refreshing the same columns does not.
 */
export function getColumnLayoutKey(columnIds: string[], hasRows: boolean): string {
    return `${hasRows ? 1 : 0}:${columnIds.join('\u0000')}`;
}

/**
 * The locked widths to apply for the current layout, or null when they were
 * measured for a different one (the grid then falls back to auto layout and
 * measures again).
 */
export function resolveLockedColumnWidths(
    locked: LockedColumnWidths | null,
    key: string,
    columnCount: number,
): number[] | null {
    if (!locked || locked.key !== key) return null;
    if (locked.widths.length !== columnCount) return null;
    return locked.widths;
}

/**
 * The locked widths with one column set to `width` (rounded to whole pixels)
 * and marked as resized. Every other column keeps its width.
 */
export function resizeLockedColumn(
    locked: LockedColumnWidths,
    index: number,
    width: number,
): LockedColumnWidths {
    if (index < 0 || index >= locked.widths.length) return locked;
    return {
        ...locked,
        widths: locked.widths.map((w, i) => (i === index ? Math.round(width) : w)),
        resized: true,
    };
}

/**
 * The explicit table width for a resized layout: the sum of its columns.
 * A fixed-layout table stretched to the container would hand any width a
 * column gives up to the other columns, so once the user resizes, the table
 * is exactly as wide as its columns. Before that it keeps filling the
 * container (undefined).
 */
export function getResizedTableWidth(
    locked: LockedColumnWidths | null,
    widths: readonly number[] | null,
): number | undefined {
    if (!locked?.resized || !widths) return undefined;
    return widths.reduce((sum, w) => sum + w, 0);
}

/** Row-number gutter width before the grid has measured its columns. */
export const DATA_GRID_GUTTER_FALLBACK_WIDTH = 50;

/**
 * Width of the collapsed border between the gutter and the first column. The
 * table paints it where the column started, inside the column's box, so a
 * sticky cell at the full gutter width leaves a 1px strip of scrolled content
 * showing at the gutter edge.
 */
const DATA_GRID_GUTTER_BORDER_WIDTH = 1;

export interface FrozenFirstColumnLayout {
    /**
     * Sticky `left` offset of the frozen column: right after the gutter, pulled
     * under its shared border so the border strip is covered too.
     */
    left: number;
    /**
     * Scroll padding that keeps `scrollIntoView` from parking the active cell
     * under the gutter and the frozen column.
     */
    scrollPaddingLeft: number;
}

/**
 * Offsets for the frozen first data column (#1152). `columnWidths` are the
 * locked widths (gutter first); before they are measured the gutter falls back
 * to its CSS width and the frozen column adds no scroll padding.
 */
export function getFrozenFirstColumnLayout(
    columnWidths: readonly number[] | null,
): FrozenFirstColumnLayout {
    const gutter = columnWidths?.[0] ?? DATA_GRID_GUTTER_FALLBACK_WIDTH;
    return {
        left: gutter - DATA_GRID_GUTTER_BORDER_WIDTH,
        scrollPaddingLeft: gutter + (columnWidths?.[1] ?? 0),
    };
}

export interface FrozenCellRowState {
    isSelected: boolean;
    isInsertion: boolean;
    isPendingDelete: boolean;
    isZebra: boolean;
}

// Both layers sit under the cell content. `::before` is the opaque row
// background, `::after` repaints the cell's own tint (selection, edits) on top.
// Collapsed table borders stay where the column started, so `::before` also
// draws the frozen column's right border.
const FROZEN_CELL_LAYERS =
    'before:absolute before:inset-0 before:-z-10 before:pointer-events-none before:transition-colors before:border-r before:border-default after:absolute after:inset-0 after:-z-10 after:pointer-events-none after:bg-inherit';

/**
 * Frozen header cell: the header background under its own tint, stacked below
 * the gutter header (z-20).
 */
export const FROZEN_HEADER_CELL_CLASS = `sticky z-[15] ${FROZEN_CELL_LAYERS} before:bg-base`;

/**
 * Backdrop for a frozen (sticky) body cell. The row tints are translucent, so
 * a sticky cell would show the cells scrolling under it; this paints the same
 * tint pre-mixed over the grid background instead. Mirrors the row classes in
 * DataGridRow, in the same precedence.
 */
export function getFrozenCellBackdropClass(row: FrozenCellRowState): string {
    let backdrop: string;
    if (row.isSelected) {
        backdrop = 'before:bg-[color-mix(in_srgb,var(--accent-primary)_10%,var(--bg-elevated))]';
    } else if (row.isInsertion) {
        backdrop = 'before:bg-[color-mix(in_srgb,var(--semantic-new)_8%,var(--bg-elevated))]';
    } else if (row.isPendingDelete) {
        backdrop = 'before:bg-[color-mix(in_srgb,var(--semantic-deleted)_10%,var(--bg-elevated))]';
    } else if (row.isZebra) {
        backdrop =
            'before:bg-[color-mix(in_srgb,var(--surface-secondary)_40%,var(--bg-elevated))] group-hover:before:bg-[color-mix(in_srgb,var(--surface-secondary)_90%,var(--bg-elevated))]';
    } else {
        backdrop =
            'before:bg-elevated group-hover:before:bg-[color-mix(in_srgb,var(--surface-secondary)_50%,var(--bg-elevated))]';
    }
    return `${FROZEN_CELL_LAYERS} ${backdrop}`;
}
