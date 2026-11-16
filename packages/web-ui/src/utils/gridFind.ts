import {formatCellValue, USE_DEFAULT_SENTINEL} from './dataGrid';

/**
 * "Find in results" for the data grid (#1298): searches the rows already
 * loaded in the grid, never the database.
 */

/** A cell of the grid's row model: the displayed row and the index in `columns`. */
export interface GridCellPosition {
    rowIndex: number;
    colIndex: number;
}

/** How a cell takes part in the search: the current match, another match, or neither. */
export type FindMatchState = 'current' | 'match';

/**
 * The text a cell offers to the search: what the grid shows for it. NULL and
 * the DEFAULT placeholder return null, so they never match (searching "null"
 * would otherwise light up every empty cell).
 */
export function getFindCellText(
    value: unknown,
    columnType?: string,
    characterMaximumLength?: number,
): string | null {
    if (value === null || value === undefined || value === USE_DEFAULT_SENTINEL) return null;
    return formatCellValue(value, '', columnType, characterMaximumLength);
}

export interface FindRowTextOptions {
    /** Pending edits of the row by column name; the grid shows them instead of the loaded value. */
    pending?: Record<string, unknown>;
    columnTypes?: ReadonlyMap<string, string> | null;
    columnLengths?: ReadonlyMap<string, number | undefined> | null;
    /** Cells the search must skip, such as masked cells (#485). */
    isExcluded?: (colIndex: number) => boolean;
}

/** The searchable text of every cell in a row, null for cells that never match. */
export function getFindRowTexts(
    rowData: readonly unknown[],
    columns: readonly string[],
    {pending, columnTypes, columnLengths, isExcluded}: FindRowTextOptions = {},
): (string | null)[] {
    return columns.map((colName, colIndex) => {
        if (isExcluded?.(colIndex)) return null;
        const pendingValue = pending?.[colName];
        return getFindCellText(
            pendingValue !== undefined ? pendingValue : rowData[colIndex],
            columnTypes?.get(colName),
            columnLengths?.get(colName),
        );
    });
}

/** Cell texts prepared once per result, so each keystroke only compares strings. */
export interface GridFindIndex {
    caseSensitive: boolean;
    rows: ReadonlyArray<ReadonlyArray<string | null>>;
}

export function buildGridFindIndex(
    rowCount: number,
    getRowTexts: (rowIndex: number) => ReadonlyArray<string | null>,
    caseSensitive: boolean,
): GridFindIndex {
    const rows: ReadonlyArray<string | null>[] = [];
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
        const texts = getRowTexts(rowIndex);
        rows.push(caseSensitive ? texts : texts.map((text) => text?.toLowerCase() ?? null));
    }
    return {caseSensitive, rows};
}

/**
 * Cells whose text contains `query`, in reading order (row by row, then column
 * by column). Whitespace in the query counts; an empty query matches nothing.
 */
export function searchGridFindIndex(index: GridFindIndex, query: string): GridCellPosition[] {
    if (query === '') return [];
    const needle = index.caseSensitive ? query : query.toLowerCase();
    const matches: GridCellPosition[] = [];
    index.rows.forEach((texts, rowIndex) => {
        texts.forEach((text, colIndex) => {
            if (text !== null && text.includes(needle)) matches.push({rowIndex, colIndex});
        });
    });
    return matches;
}

/** Orders cells in reading order. */
export function compareCellPositions(a: GridCellPosition, b: GridCellPosition): number {
    return a.rowIndex - b.rowIndex || a.colIndex - b.colIndex;
}

/**
 * Index of the first match at or after `from` in reading order, wrapping around
 * to the first match; -1 when there are no matches. Starting from a position
 * instead of keeping an index lets the current match survive typing and result
 * refreshes: it stays on the same cell while that cell still matches.
 */
export function findMatchIndexFrom(
    matches: readonly GridCellPosition[],
    from: GridCellPosition | null,
): number {
    if (matches.length === 0) return -1;
    if (!from) return 0;
    let low = 0;
    let high = matches.length;
    while (low < high) {
        const mid = (low + high) >>> 1;
        if (compareCellPositions(matches[mid], from) < 0) low = mid + 1;
        else high = mid;
    }
    return low === matches.length ? 0 : low;
}

/** The next (1) or previous (-1) match index, wrapping around at both ends. */
export function stepMatchIndex(index: number, count: number, direction: 1 | -1): number {
    if (count === 0) return -1;
    if (index < 0) return direction === 1 ? 0 : count - 1;
    return (index + direction + count) % count;
}

/** Matched column indices by row, so each rendered row looks up only its own cells. */
export function groupMatchesByRow(
    matches: readonly GridCellPosition[],
): Map<number, ReadonlySet<number>> {
    const byRow = new Map<number, Set<number>>();
    for (const {rowIndex, colIndex} of matches) {
        const cols = byRow.get(rowIndex);
        if (cols) cols.add(colIndex);
        else byRow.set(rowIndex, new Set([colIndex]));
    }
    return byRow;
}

/** The find state of one cell, for its `data-find-match` attribute. */
export function getFindMatchState(
    colIndex: number,
    matchedColIndices: ReadonlySet<number> | null,
    currentColIndex: number | null,
): FindMatchState | undefined {
    if (currentColIndex === colIndex) return 'current';
    return matchedColIndices?.has(colIndex) ? 'match' : undefined;
}

/**
 * Scroll offset change that brings the span [start, end] into the visible span
 * [viewStart, viewEnd]: 0 when it is already fully visible, otherwise the change
 * that centres it, or that aligns its start when it is larger than the view.
 */
export function getRevealScrollDelta(
    start: number,
    end: number,
    viewStart: number,
    viewEnd: number,
): number {
    if (start >= viewStart && end <= viewEnd) return 0;
    if (end - start >= viewEnd - viewStart) return start - viewStart;
    return Math.round((start + end) / 2 - (viewStart + viewEnd) / 2);
}

/**
 * Paints a cell from its `data-find-match` attribute. The attribute variants
 * outrank the cell's own selection and edit tints, and a frozen cell repaints
 * the tint through its `bg-inherit` layer. The current match is outlined, as a
 * ring would sit under that layer.
 */
export const FIND_MATCH_CELL_CLASS =
    'data-[find-match=match]:bg-accent-warning/20 data-[find-match=current]:bg-accent-warning/35 data-[find-match=current]:outline data-[find-match=current]:outline-2 data-[find-match=current]:-outline-offset-2 data-[find-match=current]:outline-accent-warning';
