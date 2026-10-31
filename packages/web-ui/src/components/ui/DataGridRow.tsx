import React from 'react';
import {isZebraStripedRow, DATA_GRID_ROW_HEIGHT, type MergedRow} from '@/utils/dataGrid';
import {DataGridCell, DataGridExpansionRow} from './DataGridCell';
import type {ForeignKey} from '@/types/editor';

/**
 * Stable, per-grid dependencies shared by every row. Bundled into a single
 * object that is memoized in DataGrid so React.memo's default shallow compare
 * on MemoRow only sees a new `ctx` reference when one of these actually changes.
 */
export interface RowCtx {
    columns: string[];
    autoIncrementColumns?: string[];
    defaultValueColumns?: string[];
    nullableColumns?: string[];
    pkColumns?: string[] | null;
    pendingChanges?: Record<string, {pkOriginalValue: unknown; changes: Record<string, unknown>}>;
    columnTypeMap: Map<string, string> | null;
    columnLengthMap: Map<string, number | undefined> | null;
    /**
     * Per-column result-coloring class (e.g. "rcell-number"), precomputed once in
     * DataGrid. `null` when colorize-by-type is disabled — in that case cells
     * render plain text with no extra wrapper, matching the original behavior.
     */
    resultColorClassMap: Map<string, string> | null;
    isJsonCellTarget: (colType: string | undefined, value: unknown) => boolean;
    fksByColumn: Map<string, ForeignKey>;
    t: (key: string, opts?: Record<string, unknown>) => string;
    mergedRows: MergedRow[];
    pkIndexMaps: number[];
    parentViewportWidth: number;
    readonly: boolean | undefined;
    /** Optional alternating row background (Settings > Appearance > Data Grid). */
    zebraStripes: boolean;
    /**
     * Sticky `left` offset of the first data column while it is frozen (#1152),
     * or null when it scrolls with the rest.
     */
    frozenFirstColumnLeft: number | null;
    updateSelection: (s: Set<number>) => void;
    /** Sensitive-column masking (#485): columns rendered masked until revealed. */
    maskedColIndices: Set<number>;
    /** Columns revealed wholesale via the header eye toggle. */
    revealedColIndices: Set<number>;
    /** Individually revealed cells, keyed `${rowIndex}:${colIndex}`. */
    revealedCells: Set<string>;
    toggleRevealCell: (rowIndex: number, colIndex: number) => void;
    /** Currently selected column indices (DBeaver-style column selection). */
    selectedColIndices: Set<number>;
    /** Clears the column selection (row/column selection are exclusive). */
    clearColSelection: () => void;
    /** Active cell range (Shift+click rectangle), normalized bounds. */
    cellRange: {
        minRow: number;
        maxRow: number;
        minCol: number;
        maxCol: number;
    } | null;
    /** Cell click: focuses the anchor, or Shift+click extends the range. */
    handleCellClick: (rowIndex: number, colIndex: number, e: React.MouseEvent) => void;
    setFocusedCell: React.Dispatch<
        React.SetStateAction<{rowIndex: number; colIndex: number} | null>
    >;
    setExpandedCell: React.Dispatch<
        React.SetStateAction<{
            rowIndex: number;
            colIndex: number;
            kind: 'json' | 'text';
        } | null>
    >;
    setEditingCell: React.Dispatch<
        React.SetStateAction<{
            rowIndex: number;
            colIndex: number;
            value: unknown;
            isRawSql?: boolean;
        } | null>
    >;
    openInSidebar: (rowIndex: number, focusField?: string) => void;
    handleRowClick: (index: number, e: React.MouseEvent) => void;
    handleCellDoubleClick: (rowIndex: number, colIndex: number, value: unknown) => void;
    handleContextMenu: (
        e: React.MouseEvent,
        row: unknown[],
        rowIndex: number,
        colIndex: number,
        colName: string,
    ) => void;
    handleEditCommit: () => void;
    commitEditWithValue: (value: unknown) => void;
    handleKeyDown: (e: React.KeyboardEvent) => void;
    onForeignKeyShowPanel?: (fk: ForeignKey, value: unknown) => void;
    onForeignKeyHidePanel?: () => void;
    onForeignKeyNavigate?: (fk: ForeignKey, value: unknown) => void;
    onPendingChange?: (pkVal: unknown, colName: string, value: unknown) => void;
    onPendingInsertionChange?: (tempId: string, colName: string, value: unknown) => void;
    openJsonViewerWindow: (
        value: unknown,
        originalValue: unknown,
        colName: string,
        rowData: unknown[],
        rowIndex: number,
        isInsertion: boolean,
        tempId: string | undefined,
        readOnly: boolean,
    ) => void;
    editInputRef: React.RefObject<HTMLInputElement | null>;
}

export interface MemoRowProps {
    ctx: RowCtx;
    rowIndex: number;
    rowOriginal: unknown[];
    isSelected: boolean;
    isInsertion: boolean;
    isPendingDelete: boolean;
    pkVal: string | null;
    editingColIndex: number | null;
    editingValue: unknown;
    focusedColIndex: number | null;
    expandedColIndex: number | null;
    expandedKind: 'json' | 'text' | null;
}

export const MemoRow = React.memo(function MemoRow(rowCtx: MemoRowProps) {
    const {
        ctx,
        rowIndex,
        rowOriginal,
        isSelected,
        isInsertion,
        isPendingDelete,
        pkVal,
        editingColIndex,
        editingValue,
        focusedColIndex,
        expandedColIndex,
        expandedKind,
    } = rowCtx;

    const {
        columns,
        readonly: readonlyProp,
        zebraStripes,
        frozenFirstColumnLeft,
        setFocusedCell,
        openInSidebar,
        handleRowClick,
        onForeignKeyHidePanel,
    } = ctx;

    return (
        <>
            <tr
                data-row-index={rowIndex}
                style={{height: DATA_GRID_ROW_HEIGHT}}
                className={`transition-colors group ${
                    isSelected
                        ? 'bg-accent-primary/10 border-l-4 border-accent-primary'
                        : isInsertion
                          ? 'bg-semantic-new/8 border-l-4 border-semantic-new'
                          : isPendingDelete
                            ? 'bg-semantic-deleted/10 opacity-60'
                            : isZebraStripedRow(rowIndex, zebraStripes)
                              ? 'bg-surface-secondary/40 hover:bg-surface-secondary/90'
                              : 'hover:bg-surface-secondary/50'
                }`}
            >
                <td
                    onClick={(e) => {
                        setFocusedCell(null);
                        onForeignKeyHidePanel?.();
                        handleRowClick(rowIndex, e);
                    }}
                    onDoubleClick={() => {
                        if (!readonlyProp) {
                            openInSidebar(rowIndex);
                        }
                    }}
                    className={`px-2 py-1.5 text-xs text-center border-b border-r border-default sticky left-0 z-10 cursor-pointer select-none w-[50px] min-w-[50px] ${
                        isInsertion
                            ? isSelected
                                ? 'bg-accent-primary/20 text-accent font-bold'
                                : 'bg-semantic-new/15 text-semantic-new font-bold'
                            : isPendingDelete
                              ? 'bg-semantic-deleted/25 text-semantic-deleted line-through'
                              : isSelected
                                ? 'bg-accent-primary/20 text-accent font-bold'
                                : isZebraStripedRow(rowIndex, zebraStripes)
                                  ? 'bg-[color-mix(in_srgb,var(--surface-secondary)_40%,var(--bg-base))] text-muted hover:bg-surface-tertiary'
                                  : 'bg-base text-muted hover:bg-surface-secondary'
                    }`}
                >
                    {isInsertion ? 'NEW' : rowIndex + 1}
                </td>
                {columns.map((colName, colIndex) => (
                    <DataGridCell
                        key={colName}
                        ctx={ctx}
                        rowIndex={rowIndex}
                        colIndex={colIndex}
                        rowOriginal={rowOriginal}
                        isSelected={isSelected}
                        isInsertion={isInsertion}
                        isPendingDelete={isPendingDelete}
                        pkVal={pkVal}
                        isEditing={editingColIndex === colIndex}
                        editingValue={editingValue}
                        isFocused={focusedColIndex === colIndex}
                        expandedKind={expandedColIndex === colIndex ? expandedKind : null}
                        frozenLeft={colIndex === 0 ? frozenFirstColumnLeft : null}
                    />
                ))}
            </tr>
            {expandedColIndex !== null && expandedKind !== null && (
                <DataGridExpansionRow
                    ctx={ctx}
                    rowIndex={rowIndex}
                    expandedCell={{colIndex: expandedColIndex, kind: expandedKind}}
                    colSpan={columns.length + 1}
                />
            )}
        </>
    );
});
