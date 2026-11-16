import {isBlobWireFormat} from './blob';
import {USE_DEFAULT_SENTINEL} from './dataGrid';

export type CaseMode = 'upper' | 'lower' | 'title';

/** One "Edit selection" action, applied to every cell of an {@link EditSelection}. */
export type BulkEdit =
    | {kind: 'fillDown'}
    | {kind: 'setValue'; value: unknown}
    | {kind: 'trim'}
    | {kind: 'changeCase'; mode: CaseMode};

/** The cells an edit applies to: every listed row crossed with every listed column, both ascending. */
export interface EditSelection {
    rows: number[];
    cols: number[];
}

export interface CellWrite {
    rowIndex: number;
    colIndex: number;
    value: unknown;
}

export interface GridSelectionState {
    cellRange: {
        minRow: number;
        maxRow: number;
        minCol: number;
        maxCol: number;
    } | null;
    selectedColIndices: ReadonlySet<number>;
    selectedRowIndices: ReadonlySet<number>;
    rowCount: number;
    columnCount: number;
    /** Columns a whole-row selection never edits (primary keys), as with a single-value paste. */
    excludedRowSelectionCols: ReadonlySet<number>;
}

const range = (from: number, to: number) => Array.from({length: to - from + 1}, (_, i) => from + i);

const ascending = (values: Iterable<number>) => [...values].sort((a, b) => a - b);

/**
 * The selection a right-click on `cell` edits: the cell range, the selected
 * columns or the selected rows when the clicked cell belongs to them,
 * otherwise the clicked cell alone.
 */
export function resolveEditSelection(
    cell: {rowIndex: number; colIndex: number},
    state: GridSelectionState,
): EditSelection {
    const {cellRange} = state;
    if (
        cellRange &&
        cell.rowIndex >= cellRange.minRow &&
        cell.rowIndex <= cellRange.maxRow &&
        cell.colIndex >= cellRange.minCol &&
        cell.colIndex <= cellRange.maxCol
    ) {
        return {
            rows: range(cellRange.minRow, cellRange.maxRow),
            cols: range(cellRange.minCol, cellRange.maxCol),
        };
    }
    if (state.selectedColIndices.has(cell.colIndex)) {
        return {
            rows: range(0, state.rowCount - 1),
            cols: ascending(state.selectedColIndices),
        };
    }
    if (state.selectedRowIndices.has(cell.rowIndex)) {
        return {
            rows: ascending(state.selectedRowIndices),
            cols: range(0, state.columnCount - 1).filter(
                (col) => !state.excludedRowSelectionCols.has(col),
            ),
        };
    }
    return {rows: [cell.rowIndex], cols: [cell.colIndex]};
}

const isPlainText = (value: unknown): value is string =>
    typeof value === 'string' && value !== USE_DEFAULT_SENTINEL && !isBlobWireFormat(value);

const toTitleCase = (text: string) =>
    text
        .toLocaleLowerCase()
        .replace(
            /(^|\s)(\p{L})/gu,
            (_, space: string, letter: string) => space + letter.toLocaleUpperCase(),
        );

const CASE_TRANSFORMS: Record<CaseMode, (text: string) => string> = {
    upper: (text) => text.toLocaleUpperCase(),
    lower: (text) => text.toLocaleLowerCase(),
    title: toTitleCase,
};

const transformText = (
    edit: Extract<BulkEdit, {kind: 'trim' | 'changeCase'}>,
): ((text: string) => string) =>
    edit.kind === 'trim' ? (text) => text.trim() : CASE_TRANSFORMS[edit.mode];

/**
 * The cell writes an edit makes on a selection, column by column and top to
 * bottom. Cells the edit would leave as they are produce no write, so a
 * re-applied edit stages nothing. Trim and case changes only touch plain
 * text: numbers, booleans, NULL, JSON values, BLOB wire values and the
 * DEFAULT marker are left alone.
 */
export function planBulkEdit(
    edit: BulkEdit,
    selection: EditSelection,
    valueAt: (rowIndex: number, colIndex: number) => unknown,
): CellWrite[] {
    const writes: CellWrite[] = [];
    for (const colIndex of selection.cols) {
        const fillValue =
            edit.kind === 'fillDown' && selection.rows.length > 0
                ? valueAt(selection.rows[0], colIndex)
                : undefined;
        for (const rowIndex of selection.rows) {
            const current = valueAt(rowIndex, colIndex);
            let next: unknown;
            switch (edit.kind) {
                case 'fillDown':
                    next = fillValue;
                    break;
                case 'setValue':
                    next = edit.value;
                    break;
                case 'trim':
                case 'changeCase':
                    next = isPlainText(current) ? transformText(edit)(current) : current;
                    break;
            }
            if (!Object.is(next, current)) {
                writes.push({rowIndex, colIndex, value: next});
            }
        }
    }
    return writes;
}
