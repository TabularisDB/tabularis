/**
 * Hiding columns of the current result in the data grid (#1299).
 *
 * Hidden columns are a view over the result: they stay in the row data, so
 * editing, primary key lookups and pending changes keep using every column.
 * Columns are identified by their index in the result's column list, which
 * also tells apart two columns with the same name (`SELECT a.id, b.id`).
 */
import {projectColumns} from './clipboard';
import {
    extendCellRange,
    moveCellPosition,
    type CellPosition,
    type CellRangeRect,
    type LockedColumnWidths,
    type RangeExtendKey,
} from './dataGrid';

/** The hidden set when nothing is hidden; shared so it keeps its identity. */
export const NO_HIDDEN_COLUMNS: ReadonlySet<number> = new Set<number>();

/** Hidden columns of one result, tied to the column list they were hidden in. */
export interface HiddenColumnsState {
    /** The column list (names, in order) the indices refer to. */
    columnSetKey: string;
    /** Indices into that column list, ascending. */
    indices: readonly number[];
}

/** Identifies a column list: the same names in the same order. */
export function getColumnSetKey(columns: readonly string[]): string {
    return JSON.stringify(columns);
}

/** Stores a hidden set for `columns`. */
export function toHiddenColumnsState(
    columns: readonly string[],
    hidden: Iterable<number>,
): HiddenColumnsState {
    return {
        columnSetKey: getColumnSetKey(columns),
        indices: [...hidden].sort((a, b) => a - b),
    };
}

/**
 * The hidden columns that apply to `columns`. A state recorded for another
 * column list hides nothing, so re-running or paging the same query keeps
 * the columns hidden while a result with different columns shows them all.
 * Indices out of range are dropped, and a state that would hide every column
 * hides none.
 */
export function resolveHiddenColumns(
    state: HiddenColumnsState | null | undefined,
    columns: readonly string[],
): ReadonlySet<number> {
    if (!state || state.indices.length === 0) return NO_HIDDEN_COLUMNS;
    if (state.columnSetKey !== getColumnSetKey(columns)) return NO_HIDDEN_COLUMNS;
    const hidden = new Set(
        state.indices.filter((i) => Number.isInteger(i) && i >= 0 && i < columns.length),
    );
    if (hidden.size === 0 || hidden.size >= columns.length) return NO_HIDDEN_COLUMNS;
    return hidden;
}

/** Indices of the visible columns, in result order. */
export function getVisibleColumnIndices(
    columnCount: number,
    hidden: ReadonlySet<number>,
): number[] {
    const visible: number[] = [];
    for (let i = 0; i < columnCount; i++) {
        if (!hidden.has(i)) visible.push(i);
    }
    return visible;
}

/** Whether hiding `indices` hides at least one more column and keeps one visible. */
export function canHideColumns(
    columnCount: number,
    hidden: ReadonlySet<number>,
    indices: Iterable<number>,
): boolean {
    const next = new Set(hidden);
    for (const i of indices) {
        if (i >= 0 && i < columnCount) next.add(i);
    }
    return next.size > hidden.size && next.size < columnCount;
}

/**
 * The hidden set with `indices` added. Returned unchanged when that would
 * hide nothing new or leave no column visible: the last visible column can't
 * be hidden.
 */
export function hideColumns(
    columnCount: number,
    hidden: ReadonlySet<number>,
    indices: Iterable<number>,
): ReadonlySet<number> {
    const list = [...indices];
    if (!canHideColumns(columnCount, hidden, list)) return hidden;
    const next = new Set(hidden);
    for (const i of list) {
        if (i >= 0 && i < columnCount) next.add(i);
    }
    return next;
}

/** The hidden set without `indices`. */
export function showColumns(
    hidden: ReadonlySet<number>,
    indices: Iterable<number>,
): ReadonlySet<number> {
    const next = new Set(hidden);
    for (const i of indices) next.delete(i);
    return next.size === hidden.size ? hidden : next;
}

/** `indices` without the hidden columns; the same set when none of them is hidden. */
export function withoutHiddenColumns(
    indices: Set<number>,
    hidden: ReadonlySet<number>,
): Set<number> {
    if (hidden.size === 0 || indices.size === 0) return indices;
    let changed = false;
    const next = new Set<number>();
    for (const i of indices) {
        if (hidden.has(i)) changed = true;
        else next.add(i);
    }
    return changed ? next : indices;
}

/**
 * Rows and column names without the hidden columns, for copying and
 * exporting a selection. Returns the inputs as they are when nothing is
 * hidden.
 */
export function projectVisibleColumns(
    rows: unknown[][],
    columns: string[],
    hidden: ReadonlySet<number>,
): {rows: unknown[][]; columns: string[]} {
    if (hidden.size === 0) return {rows, columns};
    return projectColumns(rows, columns, new Set(getVisibleColumnIndices(columns.length, hidden)));
}

/**
 * Position of `colIndex` among the visible columns. A hidden column maps to
 * the next visible column on its right, or the last one when none follows.
 */
export function toViewColumn(colIndex: number, visible: readonly number[]): number {
    if (visible.length === 0) return 0;
    const exact = visible.indexOf(colIndex);
    if (exact >= 0) return exact;
    const next = visible.findIndex((i) => i > colIndex);
    return next >= 0 ? next : visible.length - 1;
}

/** The visible column nearest to `colIndex`: itself, the next one on the right, else the last. */
export function nearestVisibleColumn(colIndex: number, visible: readonly number[]): number {
    return visible[toViewColumn(colIndex, visible)] ?? colIndex;
}

/** The visible column `step` positions away from `colIndex`, clamped to the first and last. */
export function stepVisibleColumn(
    colIndex: number,
    visible: readonly number[],
    step: number,
): number {
    if (visible.length === 0) return colIndex;
    const position = toViewColumn(colIndex, visible) + step;
    return visible[Math.min(visible.length - 1, Math.max(0, position))];
}

const toViewCell = (cell: CellPosition, visible: readonly number[]): CellPosition => ({
    rowIndex: cell.rowIndex,
    colIndex: toViewColumn(cell.colIndex, visible),
});

const fromViewCell = (cell: CellPosition, visible: readonly number[]): CellPosition => ({
    rowIndex: cell.rowIndex,
    colIndex: visible[cell.colIndex] ?? cell.colIndex,
});

/** `moveCellPosition` over the visible columns only: hidden columns are skipped. */
export function moveVisibleCellPosition(
    pos: CellPosition,
    key: RangeExtendKey,
    totalRows: number,
    visible: readonly number[],
    toEdge = false,
): CellPosition {
    if (visible.length === 0) return pos;
    const next = moveCellPosition(toViewCell(pos, visible), key, totalRows, visible.length, toEdge);
    return fromViewCell(next, visible);
}

/** `extendCellRange` over the visible columns only: hidden columns are skipped. */
export function extendVisibleCellRange(
    anchor: CellPosition,
    range: CellRangeRect | null,
    key: RangeExtendKey,
    totalRows: number,
    visible: readonly number[],
    toEdge = false,
): {range: CellRangeRect; cursor: CellPosition} | null {
    if (visible.length === 0) return null;
    const viewRange = range
        ? {
              ...range,
              minCol: toViewColumn(range.minCol, visible),
              maxCol: toViewColumn(range.maxCol, visible),
          }
        : null;
    const next = extendCellRange(
        toViewCell(anchor, visible),
        viewRange,
        key,
        totalRows,
        visible.length,
        toEdge,
    );
    if (!next) return null;
    return {
        range: {
            ...next.range,
            minCol: visible[next.range.minCol],
            maxCol: visible[next.range.maxCol],
        },
        cursor: fromViewCell(next.cursor, visible),
    };
}

/**
 * A cell range with its edge columns moved inward onto visible columns, or
 * null when no visible column is left in it. The same range when its edges
 * are visible.
 */
export function clampRangeToVisible<T extends CellRangeRect>(
    range: T | null,
    hidden: ReadonlySet<number>,
): T | null {
    if (!range || hidden.size === 0) return range;
    let {minCol, maxCol} = range;
    while (minCol <= maxCol && hidden.has(minCol)) minCol++;
    while (maxCol >= minCol && hidden.has(maxCol)) maxCol--;
    if (minCol > maxCol) return null;
    if (minCol === range.minCol && maxCol === range.maxCol) return range;
    return {...range, minCol, maxCol};
}

/** The visible columns from `minCol` to `maxCol`, inclusive. */
export function visibleColumnsInRange(
    minCol: number,
    maxCol: number,
    hidden: ReadonlySet<number>,
): number[] {
    const cols: number[] = [];
    for (let c = minCol; c <= maxCol; c++) {
        if (!hidden.has(c)) cols.push(c);
    }
    return cols;
}

/**
 * The locked widths of the rendered columns, picked by `widthIndices` (the
 * gutter at 0, then each visible column's index + 1). Null while any of them
 * hasn't been measured yet, so the grid measures again. The full list itself
 * when every column is rendered.
 */
export function pickRenderedColumnWidths(
    widths: readonly number[] | null,
    widthIndices: readonly number[],
): readonly number[] | null {
    if (!widths) return null;
    const picked = widthIndices.map((i) => widths[i]);
    if (picked.some((w) => w === undefined || !Number.isFinite(w))) return null;
    return picked.length === widths.length ? widths : picked;
}

/**
 * Stores widths measured for the rendered columns (`widthIndices`, see
 * pickRenderedColumnWidths). A column hidden while the grid measured has no
 * width yet (NaN) and is measured when it is shown. Widths already locked for
 * this layout, including resized ones, are kept: a column shown again only
 * fills in its own width.
 */
export function mergeMeasuredColumnWidths(
    previous: LockedColumnWidths | null,
    key: string,
    columnCount: number,
    widthIndices: readonly number[],
    measured: readonly number[],
): LockedColumnWidths {
    const keep = previous?.key === key && previous.widths.length === columnCount;
    const widths = keep ? [...previous.widths] : Array<number>(columnCount).fill(Number.NaN);
    widthIndices.forEach((index, position) => {
        if (keep && Number.isFinite(widths[index])) return;
        const width = measured[position];
        if (width !== undefined && index >= 0 && index < columnCount) widths[index] = width;
    });
    return keep && previous.resized ? {key, widths, resized: true} : {key, widths};
}

/**
 * Columns whose name contains `query` (case-insensitive), in result order,
 * for the column list's search field.
 */
export function filterColumnsByName(
    columns: readonly string[],
    query: string,
): {name: string; index: number}[] {
    const needle = query.trim().toLocaleLowerCase();
    const all = columns.map((name, index) => ({name, index}));
    if (needle === '') return all;
    return all.filter(({name}) => name.toLocaleLowerCase().includes(needle));
}
