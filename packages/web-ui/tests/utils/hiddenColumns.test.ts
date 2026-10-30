import {describe, it, expect} from 'vitest';
import {
    NO_HIDDEN_COLUMNS,
    canHideColumns,
    clampRangeToVisible,
    extendVisibleCellRange,
    filterColumnsByName,
    getColumnSetKey,
    getVisibleColumnIndices,
    hideColumns,
    mergeMeasuredColumnWidths,
    moveVisibleCellPosition,
    nearestVisibleColumn,
    pickRenderedColumnWidths,
    projectVisibleColumns,
    resolveHiddenColumns,
    showColumns,
    stepVisibleColumn,
    toHiddenColumnsState,
    toViewColumn,
    visibleColumnsInRange,
    withoutHiddenColumns,
} from '@/utils/hiddenColumns';

const columns = ['id', 'customer_id', 'created_by', 'updated_at', 'total'];

describe('hiddenColumns', () => {
    describe('getColumnSetKey', () => {
        it('is the same for the same names in the same order', () => {
            expect(getColumnSetKey(['a', 'b'])).toBe(getColumnSetKey(['a', 'b']));
        });

        it('differs when the order, the names or the count change', () => {
            const key = getColumnSetKey(['a', 'b']);
            expect(getColumnSetKey(['b', 'a'])).not.toBe(key);
            expect(getColumnSetKey(['a', 'c'])).not.toBe(key);
            expect(getColumnSetKey(['a', 'b', ''])).not.toBe(key);
        });

        it('tells names containing separators apart', () => {
            expect(getColumnSetKey(['a,b'])).not.toBe(getColumnSetKey(['a', 'b']));
        });
    });

    describe('toHiddenColumnsState / resolveHiddenColumns', () => {
        it('round-trips the hidden set for the same columns', () => {
            const state = toHiddenColumnsState(columns, new Set([3, 2]));
            expect(state.indices).toEqual([2, 3]);
            expect([...resolveHiddenColumns(state, [...columns])]).toEqual([2, 3]);
        });

        it('hides nothing for a result with different columns', () => {
            const state = toHiddenColumnsState(columns, [2]);
            expect(resolveHiddenColumns(state, ['id', 'total'])).toBe(NO_HIDDEN_COLUMNS);
            expect(resolveHiddenColumns(state, [...columns].reverse())).toBe(NO_HIDDEN_COLUMNS);
        });

        it('hides nothing without a state', () => {
            expect(resolveHiddenColumns(undefined, columns)).toBe(NO_HIDDEN_COLUMNS);
            expect(resolveHiddenColumns(null, columns)).toBe(NO_HIDDEN_COLUMNS);
        });

        it('drops indices outside the column list', () => {
            const state = {columnSetKey: getColumnSetKey(columns), indices: [-1, 1, 1.5, 9]};
            expect([...resolveHiddenColumns(state, columns)]).toEqual([1]);
        });

        it('never hides every column', () => {
            const state = toHiddenColumnsState(['a', 'b'], [0, 1]);
            expect(resolveHiddenColumns(state, ['a', 'b'])).toBe(NO_HIDDEN_COLUMNS);
        });
    });

    describe('getVisibleColumnIndices', () => {
        it('keeps the result order and skips hidden columns', () => {
            expect(getVisibleColumnIndices(5, new Set([0, 3]))).toEqual([1, 2, 4]);
        });

        it('lists every column when nothing is hidden', () => {
            expect(getVisibleColumnIndices(3, NO_HIDDEN_COLUMNS)).toEqual([0, 1, 2]);
            expect(getVisibleColumnIndices(0, NO_HIDDEN_COLUMNS)).toEqual([]);
        });
    });

    describe('canHideColumns / hideColumns', () => {
        it('hides a column and keeps the others', () => {
            const next = hideColumns(5, NO_HIDDEN_COLUMNS, [2]);
            expect([...next]).toEqual([2]);
        });

        it('adds to the columns already hidden', () => {
            expect([...hideColumns(5, new Set([2]), [3])].sort()).toEqual([2, 3]);
        });

        it('refuses to hide the last visible column', () => {
            const hidden = new Set([0, 1, 2, 3]);
            expect(canHideColumns(5, hidden, [4])).toBe(false);
            expect(hideColumns(5, hidden, [4])).toBe(hidden);
        });

        it('refuses a selection that covers every visible column', () => {
            expect(canHideColumns(3, NO_HIDDEN_COLUMNS, [0, 1, 2])).toBe(false);
            expect(canHideColumns(3, new Set([0]), [1, 2])).toBe(false);
            expect(canHideColumns(3, NO_HIDDEN_COLUMNS, [0, 1])).toBe(true);
        });

        it('does nothing for columns already hidden or out of range', () => {
            const hidden = new Set([1]);
            expect(canHideColumns(3, hidden, [1])).toBe(false);
            expect(canHideColumns(3, hidden, [7])).toBe(false);
            expect(hideColumns(3, hidden, [1, 7])).toBe(hidden);
        });

        it('never changes the given set', () => {
            const hidden = new Set([1]);
            hideColumns(5, hidden, [2]);
            expect([...hidden]).toEqual([1]);
        });
    });

    describe('showColumns', () => {
        it('shows one column and keeps the others hidden', () => {
            expect([...showColumns(new Set([1, 3]), [3])]).toEqual([1]);
        });

        it('returns the same set when nothing changes', () => {
            const hidden = new Set([1]);
            expect(showColumns(hidden, [2])).toBe(hidden);
        });
    });

    describe('withoutHiddenColumns', () => {
        it('drops hidden columns from a selection', () => {
            expect([...withoutHiddenColumns(new Set([0, 2, 3]), new Set([2]))]).toEqual([0, 3]);
        });

        it('returns the same set when none of it is hidden', () => {
            const selected = new Set([0, 1]);
            expect(withoutHiddenColumns(selected, new Set([4]))).toBe(selected);
            expect(withoutHiddenColumns(selected, NO_HIDDEN_COLUMNS)).toBe(selected);
        });
    });

    describe('projectVisibleColumns', () => {
        const rows = [
            [1, 10, 'ann', '2026-01-01', 99.5],
            [2, 11, 'bob', null, 12],
        ];

        it('keeps the visible columns, in order', () => {
            const projected = projectVisibleColumns(rows, columns, new Set([2, 3]));
            expect(projected.columns).toEqual(['id', 'customer_id', 'total']);
            expect(projected.rows).toEqual([
                [1, 10, 99.5],
                [2, 11, 12],
            ]);
        });

        it('returns the rows and columns as they are when nothing is hidden', () => {
            const projected = projectVisibleColumns(rows, columns, NO_HIDDEN_COLUMNS);
            expect(projected.rows).toBe(rows);
            expect(projected.columns).toBe(columns);
        });

        it('keeps duplicate column names apart by index', () => {
            const projected = projectVisibleColumns([[1, 2]], ['id', 'id'], new Set([0]));
            expect(projected).toEqual({rows: [[2]], columns: ['id']});
        });
    });

    describe('toViewColumn / nearestVisibleColumn / stepVisibleColumn', () => {
        const visible = [0, 2, 4];

        it('maps a visible column to its position', () => {
            expect(toViewColumn(2, visible)).toBe(1);
        });

        it('maps a hidden column to the next visible one, else the last', () => {
            expect(toViewColumn(1, visible)).toBe(1);
            expect(toViewColumn(5, visible)).toBe(2);
            expect(nearestVisibleColumn(3, visible)).toBe(4);
            expect(nearestVisibleColumn(9, visible)).toBe(4);
        });

        it('steps over hidden columns and stops at the edges', () => {
            expect(stepVisibleColumn(0, visible, 1)).toBe(2);
            expect(stepVisibleColumn(2, visible, 1)).toBe(4);
            expect(stepVisibleColumn(4, visible, 1)).toBe(4);
            expect(stepVisibleColumn(2, visible, -1)).toBe(0);
            expect(stepVisibleColumn(0, visible, -1)).toBe(0);
        });
    });

    describe('moveVisibleCellPosition', () => {
        const visible = [0, 2, 4];

        it('moves across hidden columns', () => {
            expect(
                moveVisibleCellPosition({rowIndex: 1, colIndex: 0}, 'ArrowRight', 3, visible),
            ).toEqual({rowIndex: 1, colIndex: 2});
            expect(
                moveVisibleCellPosition({rowIndex: 1, colIndex: 4}, 'ArrowLeft', 3, visible),
            ).toEqual({rowIndex: 1, colIndex: 2});
        });

        it('jumps to the first and last visible column', () => {
            expect(
                moveVisibleCellPosition(
                    {rowIndex: 0, colIndex: 2},
                    'ArrowRight',
                    3,
                    [1, 2, 3],
                    true,
                ),
            ).toEqual({rowIndex: 0, colIndex: 3});
            expect(
                moveVisibleCellPosition(
                    {rowIndex: 0, colIndex: 2},
                    'ArrowLeft',
                    3,
                    [1, 2, 3],
                    true,
                ),
            ).toEqual({rowIndex: 0, colIndex: 1});
        });

        it('moves rows as before', () => {
            expect(
                moveVisibleCellPosition({rowIndex: 0, colIndex: 2}, 'ArrowDown', 3, visible),
            ).toEqual({rowIndex: 1, colIndex: 2});
        });
    });

    describe('extendVisibleCellRange', () => {
        const visible = [0, 2, 4];

        it('grows the range over hidden columns', () => {
            const anchor = {rowIndex: 0, colIndex: 0};
            const first = extendVisibleCellRange(anchor, null, 'ArrowRight', 3, visible);
            expect(first?.range).toEqual({minRow: 0, maxRow: 0, minCol: 0, maxCol: 2});
            expect(first?.cursor).toEqual({rowIndex: 0, colIndex: 2});

            const second = extendVisibleCellRange(anchor, first!.range, 'ArrowRight', 3, visible);
            expect(second?.range).toEqual({minRow: 0, maxRow: 0, minCol: 0, maxCol: 4});
        });

        it('returns null at the last visible column', () => {
            const anchor = {rowIndex: 0, colIndex: 4};
            expect(extendVisibleCellRange(anchor, null, 'ArrowRight', 3, visible)).toBeNull();
        });

        it('extends to the edge with toEdge', () => {
            const next = extendVisibleCellRange(
                {rowIndex: 1, colIndex: 2},
                null,
                'ArrowLeft',
                3,
                visible,
                true,
            );
            expect(next?.range).toEqual({minRow: 1, maxRow: 1, minCol: 0, maxCol: 2});
        });
    });

    describe('clampRangeToVisible / visibleColumnsInRange', () => {
        const range = {minRow: 0, maxRow: 2, minCol: 1, maxCol: 4};

        it('moves hidden edge columns inward', () => {
            expect(clampRangeToVisible(range, new Set([1, 4]))).toEqual({
                minRow: 0,
                maxRow: 2,
                minCol: 2,
                maxCol: 3,
            });
        });

        it('returns the same range when its edges are visible', () => {
            expect(clampRangeToVisible(range, new Set([2]))).toBe(range);
            expect(clampRangeToVisible(range, NO_HIDDEN_COLUMNS)).toBe(range);
        });

        it('drops a range whose columns are all hidden', () => {
            expect(clampRangeToVisible(range, new Set([1, 2, 3, 4]))).toBeNull();
            expect(clampRangeToVisible(null, new Set([1]))).toBeNull();
        });

        it('lists the visible columns of a range', () => {
            expect(visibleColumnsInRange(1, 4, new Set([2]))).toEqual([1, 3, 4]);
            expect(visibleColumnsInRange(1, 1, new Set([1]))).toEqual([]);
        });
    });

    describe('pickRenderedColumnWidths', () => {
        it('returns the full list when every column is rendered', () => {
            const widths = [50, 100, 120];
            expect(pickRenderedColumnWidths(widths, [0, 1, 2])).toBe(widths);
        });

        it('picks the gutter and the visible columns', () => {
            expect(pickRenderedColumnWidths([50, 100, 120, 80], [0, 1, 3])).toEqual([50, 100, 80]);
        });

        it('is null while a rendered column has no width', () => {
            expect(pickRenderedColumnWidths([50, Number.NaN, 120], [0, 1, 2])).toBeNull();
            expect(pickRenderedColumnWidths([50, 100], [0, 1, 2])).toBeNull();
            expect(pickRenderedColumnWidths(null, [0])).toBeNull();
        });

        it('ignores a hidden column without a width', () => {
            expect(pickRenderedColumnWidths([50, Number.NaN, 120], [0, 2])).toEqual([50, 120]);
        });
    });

    describe('mergeMeasuredColumnWidths', () => {
        it('measures a new layout, leaving hidden columns unmeasured', () => {
            const merged = mergeMeasuredColumnWidths(null, 'k', 4, [0, 1, 3], [50, 100, 80]);
            expect(merged.key).toBe('k');
            expect(merged.widths[0]).toBe(50);
            expect(merged.widths[1]).toBe(100);
            expect(merged.widths[2]).toBeNaN();
            expect(merged.widths[3]).toBe(80);
            expect(merged.resized).toBeUndefined();
        });

        it('fills in a shown column and keeps the widths already locked', () => {
            const previous = {key: 'k', widths: [50, 140, Number.NaN, 80], resized: true};
            const merged = mergeMeasuredColumnWidths(
                previous,
                'k',
                4,
                [0, 1, 2, 3],
                [50, 100, 90, 70],
            );
            expect(merged).toEqual({key: 'k', widths: [50, 140, 90, 80], resized: true});
        });

        it('starts over for another layout', () => {
            const previous = {key: 'old', widths: [50, 140, 90], resized: true};
            const merged = mergeMeasuredColumnWidths(previous, 'new', 3, [0, 1, 2], [40, 60, 70]);
            expect(merged).toEqual({key: 'new', widths: [40, 60, 70]});
        });
    });

    describe('filterColumnsByName', () => {
        it('lists every column for an empty query', () => {
            expect(filterColumnsByName(['a', 'b'], '  ')).toEqual([
                {name: 'a', index: 0},
                {name: 'b', index: 1},
            ]);
        });

        it('matches part of the name, ignoring case, in result order', () => {
            expect(filterColumnsByName(columns, '_BY')).toEqual([{name: 'created_by', index: 2}]);
            expect(filterColumnsByName(columns, 'at')).toEqual([
                {name: 'created_by', index: 2},
                {name: 'updated_at', index: 3},
            ]);
        });
    });
});
