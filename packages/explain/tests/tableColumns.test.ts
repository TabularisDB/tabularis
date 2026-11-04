import {describe, expect, it} from 'vitest';
import {
    EXPLAIN_TABLE_COLUMNS,
    isDefaultExplainTableColumnOrder,
    moveExplainTableColumn,
    normalizeExplainTableColumnOrder,
    shiftExplainTableColumn,
    type ExplainTableColumnId,
} from '../src/tableColumns';

const DEFAULT = [...EXPLAIN_TABLE_COLUMNS];

describe('tableColumns', () => {
    describe('normalizeExplainTableColumnOrder', () => {
        it.each([undefined, null, 'cost', 42, {cost: 1}, []])(
            'should give the default order for %j',
            (saved) => {
                expect(normalizeExplainTableColumnOrder(saved)).toEqual(DEFAULT);
            },
        );

        it('should keep a complete saved order as it is', () => {
            const saved = [...DEFAULT].reverse();
            expect(normalizeExplainTableColumnOrder(saved)).toEqual(saved);
        });

        it('should drop unknown ids, non-strings and duplicates', () => {
            const saved = ['filter', 'nope', 7, null, 'filter', ...DEFAULT];
            expect(normalizeExplainTableColumnOrder(saved)).toEqual([
                'filter',
                ...DEFAULT.filter((id) => id !== 'filter'),
            ]);
        });

        it('should put a column the saved order lacks after the column it follows by default', () => {
            // An order saved before the Loops column existed.
            const saved = DEFAULT.filter((id) => id !== 'loops').reverse();
            const order = normalizeExplainTableColumnOrder(saved);

            expect(order).toHaveLength(DEFAULT.length);
            expect(order.indexOf('loops')).toBe(order.indexOf('actualRows') + 1);
        });

        it('should put a missing first column first', () => {
            const order = normalizeExplainTableColumnOrder(['filter', 'cost']);
            expect(order[0]).toBe('operation');
            expect(new Set(order).size).toBe(DEFAULT.length);
        });
    });

    describe('moveExplainTableColumn', () => {
        it('should drop a column moved left in front of the target', () => {
            expect(moveExplainTableColumn(DEFAULT, 'loops', 'cost')).toEqual([
                'operation',
                'relation',
                'loops',
                'cost',
                'estRows',
                'actualRows',
                'selfTime',
                'estimateGap',
                'filter',
            ]);
        });

        it('should drop a column moved right behind the target', () => {
            expect(moveExplainTableColumn(DEFAULT, 'operation', 'filter')).toEqual([
                ...DEFAULT.slice(1),
                'operation',
            ]);
            expect(moveExplainTableColumn(DEFAULT, 'cost', 'estRows')).toEqual([
                'operation',
                'relation',
                'estRows',
                'cost',
                'actualRows',
                'loops',
                'selfTime',
                'estimateGap',
                'filter',
            ]);
        });

        it('should return the same array when nothing moves', () => {
            expect(moveExplainTableColumn(DEFAULT, 'cost', 'cost')).toBe(DEFAULT);
            expect(
                moveExplainTableColumn(['cost'] as ExplainTableColumnId[], 'loops', 'cost'),
            ).toEqual(['cost']);
        });

        it('should not change the array it was given', () => {
            const order = [...DEFAULT];
            moveExplainTableColumn(order, 'filter', 'operation');
            expect(order).toEqual(DEFAULT);
        });
    });

    describe('shiftExplainTableColumn', () => {
        it('should swap a column with its neighbour', () => {
            expect(shiftExplainTableColumn(DEFAULT, 'cost', -1).slice(0, 3)).toEqual([
                'operation',
                'cost',
                'relation',
            ]);
            expect(shiftExplainTableColumn(DEFAULT, 'cost', 1).slice(2, 4)).toEqual([
                'estRows',
                'cost',
            ]);
        });

        it('should return the same array at either end', () => {
            expect(shiftExplainTableColumn(DEFAULT, 'operation', -1)).toBe(DEFAULT);
            expect(shiftExplainTableColumn(DEFAULT, 'filter', 1)).toBe(DEFAULT);
        });

        it('should step over columns that are not shown', () => {
            const visible: ExplainTableColumnId[] = DEFAULT.filter(
                (id) => id !== 'actualRows' && id !== 'loops',
            );
            const order = shiftExplainTableColumn(DEFAULT, 'estRows', 1, visible);

            expect(order.indexOf('estRows')).toBe(order.indexOf('selfTime') + 1);
            expect(order.filter((id) => visible.includes(id))).toEqual([
                'operation',
                'relation',
                'cost',
                'selfTime',
                'estRows',
                'estimateGap',
                'filter',
            ]);
        });

        it('should leave a hidden column where it is', () => {
            const visible = DEFAULT.filter((id) => id !== 'loops');
            expect(shiftExplainTableColumn(DEFAULT, 'loops', 1, visible)).toBe(DEFAULT);
        });
    });

    describe('isDefaultExplainTableColumnOrder', () => {
        it('should tell the default order from any other', () => {
            expect(isDefaultExplainTableColumnOrder(DEFAULT)).toBe(true);
            expect(
                isDefaultExplainTableColumnOrder(
                    moveExplainTableColumn(DEFAULT, 'cost', 'relation'),
                ),
            ).toBe(false);
            expect(isDefaultExplainTableColumnOrder(DEFAULT.slice(1))).toBe(false);
        });
    });
});
