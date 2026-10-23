import {describe, expect, it} from 'vitest';
import {planBulkEdit, resolveEditSelection, type EditSelection} from '@/utils/bulkCellEdit';
import {USE_DEFAULT_SENTINEL} from '@/utils/dataGrid';

const grid = (rows: unknown[][]) => (rowIndex: number, colIndex: number) =>
    rows[rowIndex][colIndex];

describe('bulkCellEdit', () => {
    describe('resolveEditSelection', () => {
        const base = {
            cellRange: null,
            selectedColIndices: new Set<number>(),
            selectedRowIndices: new Set<number>(),
            rowCount: 4,
            columnCount: 3,
            excludedRowSelectionCols: new Set<number>(),
        };

        it('uses the cell range when the clicked cell is inside it', () => {
            expect(
                resolveEditSelection(
                    {rowIndex: 2, colIndex: 1},
                    {...base, cellRange: {minRow: 1, maxRow: 3, minCol: 1, maxCol: 2}},
                ),
            ).toEqual({rows: [1, 2, 3], cols: [1, 2]});
        });

        it('ignores a cell range that does not contain the clicked cell', () => {
            expect(
                resolveEditSelection(
                    {rowIndex: 0, colIndex: 0},
                    {...base, cellRange: {minRow: 1, maxRow: 3, minCol: 1, maxCol: 2}},
                ),
            ).toEqual({rows: [0], cols: [0]});
        });

        it('uses every row of the selected columns, in column order', () => {
            expect(
                resolveEditSelection(
                    {rowIndex: 1, colIndex: 2},
                    {...base, selectedColIndices: new Set([2, 0])},
                ),
            ).toEqual({rows: [0, 1, 2, 3], cols: [0, 2]});
        });

        it('uses the selected rows without the excluded (key) columns', () => {
            expect(
                resolveEditSelection(
                    {rowIndex: 3, colIndex: 1},
                    {
                        ...base,
                        selectedRowIndices: new Set([3, 1]),
                        excludedRowSelectionCols: new Set([0]),
                    },
                ),
            ).toEqual({rows: [1, 3], cols: [1, 2]});
        });

        it('falls back to the clicked cell', () => {
            expect(
                resolveEditSelection(
                    {rowIndex: 1, colIndex: 1},
                    {...base, selectedRowIndices: new Set([0])},
                ),
            ).toEqual({rows: [1], cols: [1]});
        });
    });

    describe('planBulkEdit', () => {
        const all = (rows: number, cols: number): EditSelection => ({
            rows: Array.from({length: rows}, (_, i) => i),
            cols: Array.from({length: cols}, (_, i) => i),
        });

        it('fill down copies the first selected cell of each column below it', () => {
            const valueAt = grid([
                ['a', 1],
                [null, 2],
                ['a', null],
                ['c', 4],
            ]);
            expect(planBulkEdit({kind: 'fillDown'}, all(4, 2), valueAt)).toEqual([
                {rowIndex: 1, colIndex: 0, value: 'a'},
                {rowIndex: 3, colIndex: 0, value: 'a'},
                {rowIndex: 1, colIndex: 1, value: 1},
                {rowIndex: 2, colIndex: 1, value: 1},
                {rowIndex: 3, colIndex: 1, value: 1},
            ]);
        });

        it('fill down starts from the first row of the selection, not of the grid', () => {
            const valueAt = grid([['x'], ['y'], ['z']]);
            expect(planBulkEdit({kind: 'fillDown'}, {rows: [1, 2], cols: [0]}, valueAt)).toEqual([
                {rowIndex: 2, colIndex: 0, value: 'y'},
            ]);
        });

        it('fill down copies a NULL first cell as NULL', () => {
            const valueAt = grid([[null], ['b']]);
            expect(planBulkEdit({kind: 'fillDown'}, all(2, 1), valueAt)).toEqual([
                {rowIndex: 1, colIndex: 0, value: null},
            ]);
        });

        it('set value writes every cell that does not already hold it', () => {
            const valueAt = grid([
                ['n/a', 5],
                ['x', 'n/a'],
            ]);
            expect(planBulkEdit({kind: 'setValue', value: 'n/a'}, all(2, 2), valueAt)).toEqual([
                {rowIndex: 1, colIndex: 0, value: 'n/a'},
                {rowIndex: 0, colIndex: 1, value: 'n/a'},
            ]);
        });

        it('set NULL skips cells that are already NULL', () => {
            const valueAt = grid([[null], [0], ['']]);
            expect(planBulkEdit({kind: 'setValue', value: null}, all(3, 1), valueAt)).toEqual([
                {rowIndex: 1, colIndex: 0, value: null},
                {rowIndex: 2, colIndex: 0, value: null},
            ]);
        });

        it('trim removes surrounding whitespace from text only', () => {
            const valueAt = grid([
                ['  Rome ', 42],
                ['\tMilan\n', true],
                ['Turin', null],
                [' ', {a: ' b '}],
            ]);
            expect(planBulkEdit({kind: 'trim'}, all(4, 2), valueAt)).toEqual([
                {rowIndex: 0, colIndex: 0, value: 'Rome'},
                {rowIndex: 1, colIndex: 0, value: 'Milan'},
                {rowIndex: 3, colIndex: 0, value: ''},
            ]);
        });

        it('upper and lower case change text and leave numbers and NULL alone', () => {
            const valueAt = grid([
                ['Rome', 7, null],
                ['ROME', 8.5, 'ok'],
            ]);
            expect(planBulkEdit({kind: 'changeCase', mode: 'upper'}, all(2, 3), valueAt)).toEqual([
                {rowIndex: 0, colIndex: 0, value: 'ROME'},
                {rowIndex: 1, colIndex: 2, value: 'OK'},
            ]);
            expect(planBulkEdit({kind: 'changeCase', mode: 'lower'}, all(2, 3), valueAt)).toEqual([
                {rowIndex: 0, colIndex: 0, value: 'rome'},
                {rowIndex: 1, colIndex: 0, value: 'rome'},
            ]);
        });

        it('title case capitalizes the first letter of each word and lowers the rest', () => {
            const valueAt = grid([
                ['new YORK city'],
                ['élan   vital'],
                ['Already Title'],
                ["o'neil-smith"],
            ]);
            expect(planBulkEdit({kind: 'changeCase', mode: 'title'}, all(4, 1), valueAt)).toEqual([
                {rowIndex: 0, colIndex: 0, value: 'New York City'},
                {rowIndex: 1, colIndex: 0, value: 'Élan   Vital'},
                {rowIndex: 3, colIndex: 0, value: "O'neil-smith"},
            ]);
        });

        it('text transforms leave BLOB wire values and the DEFAULT marker alone', () => {
            const valueAt = grid([['BLOB:3:image/png:AAEC '], [USE_DEFAULT_SENTINEL]]);
            expect(planBulkEdit({kind: 'trim'}, all(2, 1), valueAt)).toEqual([]);
            expect(planBulkEdit({kind: 'changeCase', mode: 'lower'}, all(2, 1), valueAt)).toEqual(
                [],
            );
        });
    });
});
