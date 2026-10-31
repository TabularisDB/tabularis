import {projectColumns} from './clipboard';
import type {CellPosition, CellRangeRect} from './dataGrid';

/** Indices of the columns that are not hidden, in their original order. */
export function getVisibleColumnIndices(
    columnCount: number,
    hidden: ReadonlySet<number>,
): number[] {
    const visible: number[] = [];
    for (let index = 0; index < columnCount; index++) {
        if (!hidden.has(index)) visible.push(index);
    }
    return visible;
}

/** A column can be hidden unless it is already hidden or the last visible one. */
export function canHideColumn(
    columnCount: number,
    hidden: ReadonlySet<number>,
    colIndex: number,
): boolean {
    if (colIndex < 0 || colIndex >= columnCount || hidden.has(colIndex)) return false;
    return columnCount - hidden.size > 1;
}

/** Returns the hidden set with `colIndex` added, or the same set when it can't be hidden. */
export function hideColumn(
    hidden: ReadonlySet<number>,
    colIndex: number,
    columnCount: number,
): ReadonlySet<number> {
    if (!canHideColumn(columnCount, hidden, colIndex)) return hidden;
    const next = new Set(hidden);
    next.add(colIndex);
    return next;
}

/** Returns the hidden set without `colIndex`. */
export function showColumn(hidden: ReadonlySet<number>, colIndex: number): ReadonlySet<number> {
    if (!hidden.has(colIndex)) return hidden;
    const next = new Set(hidden);
    next.delete(colIndex);
    return next;
}

/** Keeps only the visible columns, sorted ascending. */
export function filterVisibleColumns(
    colIndices: Iterable<number>,
    hidden: ReadonlySet<number>,
): number[] {
    return [...new Set(colIndices)].filter((index) => !hidden.has(index)).sort((a, b) => a - b);
}

/** Drops the hidden columns from rows and column names, e.g. for copy and export. */
export function projectVisibleColumns(
    rows: unknown[][],
    columns: string[],
    hidden: ReadonlySet<number>,
): {rows: unknown[][]; columns: string[]} {
    if (hidden.size === 0) return {rows, columns};
    return projectColumns(rows, columns, new Set(getVisibleColumnIndices(columns.length, hidden)));
}

/**
 * Maps a cell to its position among the visible columns, so keyboard
 * navigation can step over hidden columns. `null` when the cell's column is
 * hidden.
 */
export function toVisibleCell(cell: CellPosition, visible: readonly number[]): CellPosition | null {
    const position = visible.indexOf(cell.colIndex);
    return position === -1 ? null : {rowIndex: cell.rowIndex, colIndex: position};
}

/** Inverse of {@link toVisibleCell}. */
export function fromVisibleCell(cell: CellPosition, visible: readonly number[]): CellPosition {
    return {rowIndex: cell.rowIndex, colIndex: visible[cell.colIndex]};
}

/**
 * Maps a range to visible positions: its edges move inward to the nearest
 * visible column. `null` when no visible column falls inside the range.
 */
export function toVisibleRange(
    range: CellRangeRect,
    visible: readonly number[],
): CellRangeRect | null {
    const first = visible.findIndex((index) => index >= range.minCol);
    let last = -1;
    for (let position = visible.length - 1; position >= 0; position--) {
        if (visible[position] <= range.maxCol) {
            last = position;
            break;
        }
    }
    if (first === -1 || last === -1 || first > last) return null;
    return {minRow: range.minRow, maxRow: range.maxRow, minCol: first, maxCol: last};
}

/** Inverse of {@link toVisibleRange}. */
export function fromVisibleRange(range: CellRangeRect, visible: readonly number[]): CellRangeRect {
    return {
        minRow: range.minRow,
        maxRow: range.maxRow,
        minCol: visible[range.minCol],
        maxCol: visible[range.maxCol],
    };
}
