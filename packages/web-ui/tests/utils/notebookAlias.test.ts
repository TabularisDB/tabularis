import {describe, it, expect} from 'vitest';
import {
    aliasReference,
    cellReferenceLabel,
    checkAliasChange,
    checkAliasFormat,
    findAliasProblems,
    findAliasUsages,
    findCellsByAlias,
    findOpenReference,
    MAX_CELL_ALIAS_LENGTH,
    referenceSuggestions,
} from '@/utils/notebookAlias';
import type {NotebookCell, NotebookParam} from '@/types/notebook';

function makeCell(overrides: Partial<NotebookCell> = {}): NotebookCell {
    return {
        id: overrides.id ?? 'cell-1',
        type: overrides.type ?? 'sql',
        content: overrides.content ?? '',
        ...overrides,
    };
}

describe('notebookAlias', () => {
    describe('checkAliasFormat', () => {
        it('accepts plain identifiers', () => {
            for (const alias of ['sales', '_tmp', 'Sales2024', 'a', 'cell', 'cell_x', 'cells_1']) {
                expect(checkAliasFormat(alias)).toBeNull();
            }
        });

        it('rejects anything that is not a plain identifier', () => {
            for (const alias of [
                '',
                ' ',
                '1sales',
                'my sales',
                'sales-2024',
                'a.b',
                'é',
                '{{x}}',
            ]) {
                expect(checkAliasFormat(alias)).toBe('invalid');
            }
        });

        it('reserves the positional cell_N names, in any case', () => {
            for (const alias of ['cell_1', 'cell_42', 'CELL_3', 'Cell_007']) {
                expect(checkAliasFormat(alias)).toBe('reserved');
            }
        });

        it('limits the length', () => {
            expect(checkAliasFormat('a'.repeat(MAX_CELL_ALIAS_LENGTH))).toBeNull();
            expect(checkAliasFormat('a'.repeat(MAX_CELL_ALIAS_LENGTH + 1))).toBe('tooLong');
        });
    });

    describe('findCellsByAlias', () => {
        it('matches the alias exactly', () => {
            const cells = [
                makeCell({id: 'a', alias: 'sales'}),
                makeCell({id: 'b', alias: 'Sales'}),
                makeCell({id: 'c'}),
            ];
            expect(findCellsByAlias(cells, 'sales')).toEqual([0]);
            expect(findCellsByAlias(cells, 'Sales')).toEqual([1]);
            expect(findCellsByAlias(cells, 'other')).toEqual([]);
        });
    });

    describe('findAliasUsages', () => {
        it('lists SQL cells and raw parameters that reference the alias', () => {
            const cells = [
                makeCell({id: 'a', alias: 'sales'}),
                makeCell({id: 'b', content: 'SELECT * FROM {{sales}}'}),
                makeCell({id: 'c', type: 'markdown', content: 'See {{sales}}'}),
                makeCell({id: 'd', content: 'SELECT * FROM {{sales_eu}}'}),
            ];
            const params: NotebookParam[] = [
                {name: 'src', value: '{{sales}}'},
                {name: 'typed', value: '{{sales}}', type: 'text'},
            ];
            expect(findAliasUsages(cells, params, 'sales')).toEqual({
                cellIndices: [1],
                params: ['src'],
            });
        });
    });

    describe('checkAliasChange', () => {
        const cells = [
            makeCell({id: 'a', alias: 'sales'}),
            makeCell({id: 'b', content: 'SELECT 1'}),
            makeCell({id: 'm', type: 'markdown', content: '# Notes'}),
        ];

        it('accepts a new unique alias, trimmed', () => {
            expect(checkAliasChange(cells, [], 'b', '  orders ')).toEqual({
                ok: true,
                alias: 'orders',
            });
        });

        it('rejects an alias another cell has, whatever its case', () => {
            expect(checkAliasChange(cells, [], 'b', 'SALES')).toEqual({
                ok: false,
                issue: 'duplicate',
                conflictIndex: 0,
            });
        });

        it('rejects malformed and reserved aliases', () => {
            expect(checkAliasChange(cells, [], 'b', 'my sales')).toMatchObject({issue: 'invalid'});
            expect(checkAliasChange(cells, [], 'b', 'cell_2')).toMatchObject({issue: 'reserved'});
            expect(checkAliasChange(cells, [], 'b', 'x'.repeat(64))).toMatchObject({
                issue: 'tooLong',
            });
        });

        it('rejects an alias on a Markdown cell', () => {
            expect(checkAliasChange(cells, [], 'm', 'notes')).toMatchObject({issue: 'notSql'});
        });

        it('keeps the same alias as a no-op', () => {
            expect(checkAliasChange(cells, [], 'a', 'sales')).toEqual({ok: true, alias: 'sales'});
        });

        it('renames or removes an alias nothing references', () => {
            expect(checkAliasChange(cells, [], 'a', 'revenue')).toEqual({
                ok: true,
                alias: 'revenue',
            });
            expect(checkAliasChange(cells, [], 'a', '')).toEqual({ok: true, alias: undefined});
        });

        it('blocks renaming or removing a referenced alias, with every place that uses it', () => {
            const used = [
                ...cells,
                makeCell({id: 'c', content: 'SELECT * FROM {{sales}}'}),
                makeCell({id: 'd', content: 'SELECT count(*) FROM {{sales}} JOIN {{sales}}'}),
            ];
            const params: NotebookParam[] = [{name: 'source', value: '{{sales}}'}];
            const expected = {
                ok: false,
                issue: 'inUse',
                usage: {cellIndices: [3, 4], params: ['source']},
            };
            expect(checkAliasChange(used, params, 'a', 'revenue')).toEqual(expected);
            expect(checkAliasChange(used, params, 'a', '')).toEqual(expected);
        });

        it('lets a new alias satisfy references that named no cell yet', () => {
            const waiting = [...cells, makeCell({id: 'c', content: 'SELECT * FROM {{orders}}'})];
            expect(checkAliasChange(waiting, [], 'b', 'orders')).toEqual({
                ok: true,
                alias: 'orders',
            });
        });

        it('rejects an unknown cell id', () => {
            expect(checkAliasChange(cells, [], 'nope', 'x')).toMatchObject({ok: false});
        });
    });

    describe('findAliasProblems', () => {
        it('accepts unique aliases on SQL cells and cells without one', () => {
            expect(
                findAliasProblems([
                    {type: 'sql', alias: 'sales'},
                    {type: 'sql'},
                    {type: 'markdown'},
                    {type: 'sql', alias: 'orders'},
                ]),
            ).toEqual([]);
        });

        it('reports duplicates, case-insensitively, with both cell numbers', () => {
            expect(
                findAliasProblems([
                    {type: 'sql', alias: 'sales'},
                    {type: 'sql'},
                    {type: 'sql', alias: 'SALES'},
                ]),
            ).toEqual(['Cells 1 and 3 both use the alias "SALES"']);
        });

        it('reports reserved, malformed, non-text and Markdown aliases', () => {
            expect(
                findAliasProblems([
                    {type: 'sql', alias: 'cell_1'},
                    {type: 'sql', alias: 'bad name'},
                    {type: 'sql', alias: 7},
                    {type: 'markdown', alias: 'notes'},
                ]),
            ).toEqual([
                'Cell 1: the alias "cell_1" is reserved for position-based references',
                'Cell 2: "bad name" is not a valid alias',
                'Cell 3 has an alias that is not text',
                'Cell 4 is not an SQL cell and cannot have the alias "notes"',
            ]);
        });
    });

    describe('findOpenReference', () => {
        it('finds the name being typed after {{', () => {
            expect(findOpenReference('SELECT * FROM {{sa', 18)).toEqual({
                prefix: 'sa',
                start: 16,
                end: 18,
            });
        });

        it('swallows the rest of the name and closing braces after the cursor', () => {
            const line = 'FROM {{}} x';
            expect(findOpenReference(line, 7)).toEqual({prefix: '', start: 7, end: 9});
            expect(findOpenReference('FROM {{sa}', 9)).toEqual({prefix: 'sa', start: 7, end: 10});
            expect(findOpenReference('FROM {{salXX}} y', 10)).toEqual({
                prefix: 'sal',
                start: 7,
                end: 14,
            });
        });

        it('ignores a cursor outside a reference', () => {
            expect(findOpenReference('SELECT {', 8)).toBeNull();
            expect(findOpenReference('FROM {{sales}} ', 15)).toBeNull();
            expect(findOpenReference('FROM {{sa les', 13)).toBeNull();
        });
    });

    describe('referenceSuggestions', () => {
        it('offers other SQL cells: aliases first, then positions', () => {
            const cells = [
                makeCell({id: 'a', alias: 'sales'}),
                makeCell({id: 'm', type: 'markdown'}),
                makeCell({id: 'b'}),
                makeCell({id: 'c', alias: 'me'}),
            ];
            expect(referenceSuggestions(cells, 'c')).toEqual([
                {label: 'sales', cellIndex: 0, kind: 'alias'},
                {label: 'cell_1', cellIndex: 0, kind: 'position'},
                {label: 'cell_3', cellIndex: 2, kind: 'position'},
            ]);
        });
    });

    describe('labels', () => {
        it('names a cell by its alias, else by its position', () => {
            expect(aliasReference('sales')).toBe('{{sales}}');
            expect(cellReferenceLabel(makeCell({alias: 'sales'}), 4)).toBe('{{sales}}');
            expect(cellReferenceLabel(makeCell(), 4)).toBe('{{cell_5}}');
            expect(cellReferenceLabel(undefined, 0)).toBe('{{cell_1}}');
        });
    });
});
