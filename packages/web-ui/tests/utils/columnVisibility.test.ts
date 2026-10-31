import {describe, it, expect} from 'vitest';
import {
    canHideColumn,
    filterVisibleColumns,
    fromVisibleCell,
    fromVisibleRange,
    getVisibleColumnIndices,
    hideColumn,
    projectVisibleColumns,
    showColumn,
    toVisibleCell,
    toVisibleRange,
} from '@/utils/columnVisibility';

describe('columnVisibility', () => {
    describe('getVisibleColumnIndices', () => {
        it('returns every column when nothing is hidden', () => {
            expect(getVisibleColumnIndices(3, new Set())).toEqual([0, 1, 2]);
        });

        it('skips hidden columns and keeps the original order', () => {
            expect(getVisibleColumnIndices(5, new Set([3, 1]))).toEqual([0, 2, 4]);
        });
    });

    describe('canHideColumn', () => {
        it('allows hiding a visible column while another one stays visible', () => {
            expect(canHideColumn(3, new Set([0]), 1)).toBe(true);
        });

        it('refuses to hide the last visible column', () => {
            expect(canHideColumn(3, new Set([0, 1]), 2)).toBe(false);
            expect(canHideColumn(1, new Set(), 0)).toBe(false);
        });

        it('refuses an already hidden or out of range column', () => {
            expect(canHideColumn(3, new Set([1]), 1)).toBe(false);
            expect(canHideColumn(3, new Set(), -1)).toBe(false);
            expect(canHideColumn(3, new Set(), 3)).toBe(false);
        });
    });

    describe('hideColumn / showColumn', () => {
        it('adds and removes a column without mutating the input', () => {
            const initial = new Set<number>();
            const hidden = hideColumn(initial, 1, 3);
            expect([...hidden]).toEqual([1]);
            expect(initial.size).toBe(0);

            const shown = showColumn(hidden, 1);
            expect(shown.size).toBe(0);
            expect(hidden.has(1)).toBe(true);
        });

        it('returns the same set when nothing changes', () => {
            const hidden = new Set([0, 1]);
            expect(hideColumn(hidden, 2, 3)).toBe(hidden);
            expect(showColumn(hidden, 2)).toBe(hidden);
        });
    });

    describe('filterVisibleColumns', () => {
        it('drops hidden columns and sorts the rest', () => {
            expect(filterVisibleColumns([4, 1, 2, 1], new Set([2]))).toEqual([1, 4]);
        });
    });

    describe('projectVisibleColumns', () => {
        const columns = ['id', 'created_by', 'name', 'updated_at'];
        const rows = [
            [1, 'alice', 'first', '2026-01-01'],
            [2, 'bob', 'second', '2026-01-02'],
        ];

        it('keeps only the visible columns, in order', () => {
            expect(projectVisibleColumns(rows, columns, new Set([1, 3]))).toEqual({
                rows: [
                    [1, 'first'],
                    [2, 'second'],
                ],
                columns: ['id', 'name'],
            });
        });

        it('returns the input untouched when nothing is hidden', () => {
            const projected = projectVisibleColumns(rows, columns, new Set());
            expect(projected.rows).toBe(rows);
            expect(projected.columns).toBe(columns);
        });
    });

    describe('visible cell mapping', () => {
        const visible = [0, 2, 4];

        it('maps a cell to its visible position and back', () => {
            const position = toVisibleCell({rowIndex: 3, colIndex: 4}, visible);
            expect(position).toEqual({rowIndex: 3, colIndex: 2});
            expect(fromVisibleCell(position!, visible)).toEqual({rowIndex: 3, colIndex: 4});
        });

        it('returns null for a cell in a hidden column', () => {
            expect(toVisibleCell({rowIndex: 0, colIndex: 1}, visible)).toBeNull();
        });
    });

    describe('visible range mapping', () => {
        const visible = [0, 2, 4];

        it('moves the range edges inward to the nearest visible columns', () => {
            const range = toVisibleRange({minRow: 1, maxRow: 2, minCol: 1, maxCol: 3}, visible);
            expect(range).toEqual({minRow: 1, maxRow: 2, minCol: 1, maxCol: 1});
            expect(fromVisibleRange(range!, visible)).toEqual({
                minRow: 1,
                maxRow: 2,
                minCol: 2,
                maxCol: 2,
            });
        });

        it('maps a range spanning hidden columns to the visible span', () => {
            expect(toVisibleRange({minRow: 0, maxRow: 0, minCol: 0, maxCol: 4}, visible)).toEqual({
                minRow: 0,
                maxRow: 0,
                minCol: 0,
                maxCol: 2,
            });
        });

        it('returns null when the range only covers hidden columns', () => {
            expect(
                toVisibleRange({minRow: 0, maxRow: 0, minCol: 1, maxCol: 1}, visible),
            ).toBeNull();
        });
    });
});
