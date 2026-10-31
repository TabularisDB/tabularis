import React from 'react';
import {
    DATA_GRID_ROW_HEIGHT,
    TRANSPOSED_FIELD_LABEL_CLASS,
    TRANSPOSED_FROZEN_FIELD_LABEL_CLASS,
    TRANSPOSED_FIELD_LABEL_WIDTH,
    TRANSPOSED_RECORD_WIDTH,
} from '@/utils/dataGrid';
import {DataGridCell} from './DataGridCell';
import type {RowCtx} from './DataGridRow';

/**
 * Per-record state for the record columns currently in the horizontal
 * virtual window. Computed once in DataGrid and shared by every field row.
 */
export interface TransposedRecord {
    rowIndex: number;
    rowOriginal: unknown[];
    isSelected: boolean;
    isInsertion: boolean;
    isPendingDelete: boolean;
    pkVal: string | null;
}

// The whole-record tint, matching the row tint of the normal layout.
function getTransposedRecordClass(record: TransposedRecord): string {
    if (record.isSelected) return 'bg-accent-primary/10';
    if (record.isInsertion) return 'bg-semantic-new/8';
    if (record.isPendingDelete) return 'bg-semantic-deleted/10 opacity-60';
    return '';
}

export interface MemoTransposedRowProps {
    ctx: RowCtx;
    /** The result column this visual row shows. */
    colIndex: number;
    /** Header content for the field label (name, sort state, type tooltip). */
    label: React.ReactNode;
    isFieldSelected: boolean;
    onLabelContextMenu: (e: React.MouseEvent, colIndex: number) => void;
    records: TransposedRecord[];
    paddingLeft: number;
    paddingRight: number;
    /** Row index of the editing/focused/expanded cell when it is in this field. */
    editingRowIndex: number | null;
    editingValue: unknown;
    focusedRowIndex: number | null;
    expandedRowIndex: number | null;
    expandedKind: 'json' | 'text' | null;
    /** Sticky `top` offset while this field row is frozen, otherwise null. */
    frozenTop: number | null;
}

/**
 * One field of the result rendered as a visual row (#561): a sticky field
 * label followed by that field's value in each visible record.
 */
export const MemoTransposedRow = React.memo(function MemoTransposedRow({
    ctx,
    colIndex,
    label,
    isFieldSelected,
    onLabelContextMenu,
    records,
    paddingLeft,
    paddingRight,
    editingRowIndex,
    editingValue,
    focusedRowIndex,
    expandedRowIndex,
    expandedKind,
    frozenTop,
}: MemoTransposedRowProps) {
    return (
        <tr data-field-index={colIndex} style={{height: DATA_GRID_ROW_HEIGHT}}>
            <th
                scope="row"
                data-col-index={colIndex}
                onContextMenu={(e) => onLabelContextMenu(e, colIndex)}
                style={{
                    width: TRANSPOSED_FIELD_LABEL_WIDTH,
                    top: frozenTop ?? undefined,
                }}
                className={`${
                    frozenTop !== null
                        ? TRANSPOSED_FROZEN_FIELD_LABEL_CLASS
                        : TRANSPOSED_FIELD_LABEL_CLASS
                } px-4 py-1.5 text-xs font-semibold tracking-wider border-b border-r border-default whitespace-nowrap truncate ${
                    isFieldSelected ? 'text-primary bg-accent-primary/20' : 'text-secondary'
                }`}
            >
                {label}
            </th>
            <td aria-hidden style={{width: paddingLeft, padding: 0, border: 'none'}} />
            {records.map((record) => (
                <DataGridCell
                    key={record.rowIndex}
                    ctx={ctx}
                    rowIndex={record.rowIndex}
                    colIndex={colIndex}
                    rowOriginal={record.rowOriginal}
                    isSelected={record.isSelected}
                    isInsertion={record.isInsertion}
                    isPendingDelete={record.isPendingDelete}
                    pkVal={record.pkVal}
                    isEditing={editingRowIndex === record.rowIndex}
                    editingValue={editingValue}
                    isFocused={focusedRowIndex === record.rowIndex}
                    expandedKind={expandedRowIndex === record.rowIndex ? expandedKind : null}
                    frozenLeft={null}
                    frozenTop={frozenTop}
                    isZebra={false}
                    widthClassName=""
                    className={getTransposedRecordClass(record)}
                    style={{width: TRANSPOSED_RECORD_WIDTH, maxWidth: TRANSPOSED_RECORD_WIDTH}}
                />
            ))}
            <td aria-hidden style={{width: paddingRight, padding: 0, border: 'none'}} />
        </tr>
    );
});
