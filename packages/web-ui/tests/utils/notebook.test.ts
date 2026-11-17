import {describe, it, expect} from 'vitest';
import {
    generateCellId,
    createEmptyCell,
    createDefaultNotebookState,
    updateCellInCells,
    addCellToCells,
    duplicateCell,
    duplicateCellToEnd,
    removeCellFromCells,
    clearCellOutputs,
    hasCellOutputs,
    moveCellInCells,
    extractSqlFromCells,
} from '@/utils/notebook';
import type {NotebookCell} from '@/types/notebook';
import type {QueryResult} from '@/types/editor';

function makeCell(overrides: Partial<NotebookCell> = {}): NotebookCell {
    return {
        id: overrides.id ?? 'cell-1',
        type: overrides.type ?? 'sql',
        content: overrides.content ?? '',
        result: null,
        error: undefined,
        executionTime: null,
        isLoading: false,
        ...overrides,
    };
}

describe('notebook utils', () => {
    describe('generateCellId', () => {
        it('should return a non-empty string', () => {
            const id = generateCellId();
            expect(id).toBeTruthy();
            expect(typeof id).toBe('string');
        });

        it('should start with cell_ prefix', () => {
            expect(generateCellId()).toMatch(/^cell_/);
        });

        it('should generate unique ids across calls', () => {
            const ids = new Set(Array.from({length: 100}, () => generateCellId()));
            expect(ids.size).toBe(100);
        });
    });

    describe('createEmptyCell', () => {
        it('should create an empty SQL cell with correct defaults', () => {
            const cell = createEmptyCell('sql');
            expect(cell.type).toBe('sql');
            expect(cell.content).toBe('');
            expect(cell.result).toBeNull();
            expect(cell.error).toBeUndefined();
            expect(cell.executionTime).toBeNull();
            expect(cell.isLoading).toBe(false);
            expect(cell.isPreview).toBeUndefined();
            expect(cell.id).toMatch(/^cell_/);
        });

        it('should create an empty markdown cell with isPreview = false', () => {
            const cell = createEmptyCell('markdown');
            expect(cell.type).toBe('markdown');
            expect(cell.content).toBe('');
            expect(cell.isPreview).toBe(false);
            expect(cell.id).toMatch(/^cell_/);
        });
    });

    describe('createDefaultNotebookState', () => {
        it('should return state with one empty SQL cell', () => {
            const state = createDefaultNotebookState();
            expect(state.cells).toHaveLength(1);
            expect(state.cells[0].type).toBe('sql');
            expect(state.cells[0].content).toBe('');
        });
    });

    describe('updateCellInCells', () => {
        it('should update the target cell', () => {
            const cells = [makeCell({id: 'a'}), makeCell({id: 'b'})];
            const updated = updateCellInCells(cells, 'a', {content: 'SELECT 1'});
            expect(updated[0].content).toBe('SELECT 1');
            expect(updated[1].content).toBe('');
        });

        it('should leave other cells unchanged', () => {
            const cells = [
                makeCell({id: 'a', content: 'original'}),
                makeCell({id: 'b', content: 'other'}),
            ];
            const updated = updateCellInCells(cells, 'a', {content: 'changed'});
            expect(updated[1].content).toBe('other');
        });

        it('should return unchanged array if cellId not found', () => {
            const cells = [makeCell({id: 'a'})];
            const updated = updateCellInCells(cells, 'missing', {content: 'x'});
            expect(updated).toEqual(cells);
        });
    });

    describe('addCellToCells', () => {
        it('should add cell at the end by default', () => {
            const cells = [makeCell({id: 'a'})];
            const result = addCellToCells(cells, 'sql');
            expect(result).toHaveLength(2);
            expect(result[1].type).toBe('sql');
        });

        it('should add cell after specified index', () => {
            const cells = [makeCell({id: 'a'}), makeCell({id: 'b'})];
            const result = addCellToCells(cells, 'markdown', 0);
            expect(result).toHaveLength(3);
            expect(result[0].id).toBe('a');
            expect(result[1].type).toBe('markdown');
            expect(result[2].id).toBe('b');
        });

        it('should work with empty array', () => {
            const result = addCellToCells([], 'sql');
            expect(result).toHaveLength(1);
            expect(result[0].type).toBe('sql');
        });
    });

    describe('removeCellFromCells', () => {
        it('should remove the target cell', () => {
            const cells = [makeCell({id: 'a'}), makeCell({id: 'b'})];
            const result = removeCellFromCells(cells, 'a');
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('b');
        });

        it('should return unchanged array if cellId not found', () => {
            const cells = [makeCell({id: 'a'})];
            const result = removeCellFromCells(cells, 'missing');
            expect(result).toHaveLength(1);
        });

        it('should return empty array when removing last cell', () => {
            const cells = [makeCell({id: 'a'})];
            const result = removeCellFromCells(cells, 'a');
            expect(result).toHaveLength(0);
        });
    });

    describe('hasCellOutputs / clearCellOutputs', () => {
        const queryResult: QueryResult = {columns: ['id'], rows: [[1]], affected_rows: 0};
        const historyEntry = {
            query: 'SELECT 1',
            result: queryResult,
            executionTime: 3,
            timestamp: 1,
        };
        const chartConfig = {type: 'bar' as const, labelColumn: 'id', valueColumns: ['id']};

        it('should report no outputs for an empty notebook and for cells that never ran', () => {
            expect(hasCellOutputs([])).toBe(false);
            expect(
                hasCellOutputs([makeCell({id: 'a'}), makeCell({id: 'b', type: 'markdown'})]),
            ).toBe(false);
        });

        it.each([
            {name: 'a result', partial: {result: queryResult}},
            {name: 'an error', partial: {error: 'syntax error'}},
            {name: 'an execution time', partial: {executionTime: 0}},
        ])('should report an output for a SQL cell with $name', ({partial}) => {
            expect(hasCellOutputs([makeCell({id: 'a'}), makeCell({id: 'b', ...partial})])).toBe(
                true,
            );
        });

        it('should return an empty array for an empty notebook', () => {
            expect(clearCellOutputs([])).toEqual([]);
        });

        it('should clear the result, error and execution time of every SQL cell', () => {
            const cleared = clearCellOutputs([
                makeCell({id: 'ok', result: queryResult, executionTime: 12}),
                makeCell({id: 'failed', error: 'boom', executionTime: 4}),
            ]);
            for (const cell of cleared) {
                expect(cell.result).toBeNull();
                expect(cell.error).toBeUndefined();
                expect(cell.executionTime).toBeNull();
            }
            expect(hasCellOutputs(cleared)).toBe(false);
        });

        it('should keep ids, order, content, settings, chart config and execution history', () => {
            const cells: NotebookCell[] = [
                makeCell({
                    id: 'a',
                    content: 'SELECT 1',
                    name: 'First',
                    schema: 'analytics',
                    isParallel: true,
                    isCollapsed: true,
                    isChartVisible: true,
                    chartConfig,
                    result: queryResult,
                    executionTime: 7,
                    history: [historyEntry],
                }),
                makeCell({id: 'notes', type: 'markdown', content: '# Notes', isPreview: true}),
                makeCell({id: 'b', content: 'SELECT 2', error: 'boom', history: [historyEntry]}),
            ];
            const cleared = clearCellOutputs(cells);

            expect(cleared.map((c) => c.id)).toEqual(['a', 'notes', 'b']);
            expect(cleared[0]).toEqual({
                ...cells[0],
                result: null,
                error: undefined,
                executionTime: null,
            });
            expect(cleared[0].history).toBe(cells[0].history);
            expect(cleared[2].history).toBe(cells[2].history);
            expect(cleared[0].chartConfig).toBe(chartConfig);
        });

        it('should return markdown cells and cells without output unchanged', () => {
            const markdown = makeCell({id: 'notes', type: 'markdown', content: '# Notes'});
            const idle = makeCell({id: 'idle', content: 'SELECT 1'});
            const cleared = clearCellOutputs([markdown, idle]);
            expect(cleared[0]).toBe(markdown);
            expect(cleared[1]).toBe(idle);
        });

        it('should not mutate the input cells', () => {
            const cell = makeCell({id: 'a', result: queryResult, error: 'boom', executionTime: 5});
            clearCellOutputs([cell]);
            expect(cell).toMatchObject({result: queryResult, error: 'boom', executionTime: 5});
        });

        it('should leave the loading flag alone', () => {
            const [cleared] = clearCellOutputs([
                makeCell({id: 'a', isLoading: true, executionTime: 5}),
            ]);
            expect(cleared.isLoading).toBe(true);
        });
    });

    describe('duplicateCell / duplicateCellToEnd', () => {
        const result: QueryResult = {columns: ['id'], rows: [[1]], affected_rows: 0};
        const historyEntry = {
            query: 'SELECT 1',
            result,
            executionTime: 3,
            timestamp: 1,
        };

        function ranSqlCell(overrides: Partial<NotebookCell> = {}): NotebookCell {
            return makeCell({
                id: 'source',
                type: 'sql',
                content: 'SELECT * FROM {{cell_1}} WHERE id > 1',
                name: 'Top orders',
                schema: 'sales',
                result,
                error: 'old error',
                executionTime: 42,
                isLoading: true,
                history: [historyEntry],
                chartConfig: {type: 'bar', labelColumn: 'id', valueColumns: ['total', 'count']},
                resultHeight: 320,
                isParallel: true,
                isCollapsed: true,
                isQueryCollapsed: true,
                isResultCollapsed: true,
                isChartVisible: true,
                isQueryPlanVisible: true,
                ...overrides,
            });
        }

        it('copies the source and configuration of an SQL cell with a fresh id', () => {
            const source = ranSqlCell();
            const copy = duplicateCell(source);
            expect(copy.id).not.toBe(source.id);
            expect(copy.id).toMatch(/^cell_/);
            expect(copy).toEqual({
                ...source,
                id: copy.id,
                result: null,
                error: undefined,
                executionTime: null,
                isLoading: false,
                history: undefined,
                isCollapsed: false,
                isQueryPlanVisible: false,
            });
        });

        it.each([true, false, undefined])(
            'starts the copy with the query plan closed (source %s)',
            (isQueryPlanVisible) => {
                const source = ranSqlCell({isQueryPlanVisible});
                expect(duplicateCell(source).isQueryPlanVisible).toBe(false);
                expect(source.isQueryPlanVisible).toBe(isQueryPlanVisible);
            },
        );

        it('keeps cell references verbatim', () => {
            const copy = duplicateCell(
                ranSqlCell({content: 'SELECT a FROM {{cell_2}}\nJOIN {{cell_10}}'}),
            );
            expect(copy.content).toBe('SELECT a FROM {{cell_2}}\nJOIN {{cell_10}}');
        });

        it('clears every runtime field', () => {
            const copy = duplicateCell(ranSqlCell());
            expect(copy.result).toBeNull();
            expect(copy.error).toBeUndefined();
            expect(copy.executionTime).toBeNull();
            expect(copy.isLoading).toBe(false);
            expect(copy.history).toBeUndefined();
        });

        it('does not share the chart configuration with the original', () => {
            const source = ranSqlCell();
            const copy = duplicateCell(source);
            expect(copy.chartConfig).toEqual(source.chartConfig);
            expect(copy.chartConfig).not.toBe(source.chartConfig);
            expect(copy.chartConfig?.valueColumns).not.toBe(source.chartConfig?.valueColumns);

            copy.chartConfig?.valueColumns.push('extra');
            if (copy.chartConfig) copy.chartConfig.labelColumn = 'changed';
            expect(source.chartConfig).toEqual({
                type: 'bar',
                labelColumn: 'id',
                valueColumns: ['total', 'count'],
            });
        });

        it('copies the KPI configuration without sharing it', () => {
            const source = ranSqlCell({kpiConfig: {column: 'total', label: 'Total', decimals: 2}});
            const copy = duplicateCell(source);
            expect(copy.kpiConfig).toEqual(source.kpiConfig);
            expect(copy.kpiConfig).not.toBe(source.kpiConfig);
            if (copy.kpiConfig) copy.kpiConfig.label = 'changed';
            expect(source.kpiConfig?.label).toBe('Total');
        });

        it.each([null, undefined])('keeps a %s chart configuration as is', (chartConfig) => {
            expect(duplicateCell(ranSqlCell({chartConfig})).chartConfig).toBe(chartConfig);
        });

        it('starts a Markdown copy expanded and in edit mode', () => {
            const source = makeCell({
                id: 'notes',
                type: 'markdown',
                content: '# Notes about {{cell_1}}',
                name: 'Notes',
                isPreview: true,
                isCollapsed: true,
            });
            const copy = duplicateCell(source);
            expect(copy).toEqual({
                ...source,
                id: copy.id,
                isPreview: false,
                isCollapsed: false,
                isQueryPlanVisible: false,
            });
        });

        it('copies empty and special-character content unchanged', () => {
            expect(duplicateCell(makeCell({content: ''})).content).toBe('');
            const special = "SELECT 'Zürich ✓ 東京', '\\', '{{cell_1}}' -- ${x}";
            expect(duplicateCell(makeCell({content: special})).content).toBe(special);
        });

        it('appends the copy and leaves existing cells and positions unchanged', () => {
            const first = makeCell({id: 'first', content: 'SELECT 1'});
            const second = ranSqlCell({id: 'second'});
            const third = makeCell({id: 'third', type: 'markdown', content: 'Text'});
            const cells = [first, second, third];

            const next = duplicateCellToEnd(cells, 'second');

            expect(next).toHaveLength(4);
            expect(next.slice(0, 3)).toEqual(cells);
            expect(next[0]).toBe(first);
            expect(next[1]).toBe(second);
            expect(next[2]).toBe(third);
            expect(next[3].content).toBe(second.content);
            expect(next[3].result).toBeNull();
            expect(cells).toHaveLength(3);
            expect(second.result).toEqual(result);
        });

        it('gives every copy a distinct id', () => {
            let cells = [makeCell({id: 'only', content: 'SELECT 1'})];
            for (let i = 0; i < 20; i++) cells = duplicateCellToEnd(cells, 'only');
            expect(new Set(cells.map((c) => c.id)).size).toBe(21);
        });

        it('can duplicate the last cell and an earlier copy', () => {
            const cells = duplicateCellToEnd([makeCell({id: 'a', content: 'A'})], 'a');
            const again = duplicateCellToEnd(cells, cells[1].id);
            expect(again.map((c) => c.content)).toEqual(['A', 'A', 'A']);
            expect(new Set(again.map((c) => c.id)).size).toBe(3);
        });

        it('returns the same array when the cell is unknown', () => {
            const cells = [makeCell({id: 'a'})];
            expect(duplicateCellToEnd(cells, 'missing')).toBe(cells);
            const empty: NotebookCell[] = [];
            expect(duplicateCellToEnd(empty, 'a')).toBe(empty);
        });
    });

    describe('moveCellInCells', () => {
        it('should swap cells when moving down', () => {
            const cells = [makeCell({id: 'a'}), makeCell({id: 'b'}), makeCell({id: 'c'})];
            const result = moveCellInCells(cells, 'a', 1);
            expect(result.map((c) => c.id)).toEqual(['b', 'a', 'c']);
        });

        it('should swap cells when moving up', () => {
            const cells = [makeCell({id: 'a'}), makeCell({id: 'b'}), makeCell({id: 'c'})];
            const result = moveCellInCells(cells, 'c', -1);
            expect(result.map((c) => c.id)).toEqual(['a', 'c', 'b']);
        });

        it('should no-op when moving first cell up', () => {
            const cells = [makeCell({id: 'a'}), makeCell({id: 'b'})];
            const result = moveCellInCells(cells, 'a', -1);
            expect(result.map((c) => c.id)).toEqual(['a', 'b']);
        });

        it('should no-op when moving last cell down', () => {
            const cells = [makeCell({id: 'a'}), makeCell({id: 'b'})];
            const result = moveCellInCells(cells, 'b', 1);
            expect(result.map((c) => c.id)).toEqual(['a', 'b']);
        });

        it('should return unchanged array if cellId not found', () => {
            const cells = [makeCell({id: 'a'})];
            const result = moveCellInCells(cells, 'missing', 1);
            expect(result).toEqual(cells);
        });
    });

    describe('extractSqlFromCells', () => {
        it('should join SQL cell contents with double newline', () => {
            const cells = [
                makeCell({id: 'a', type: 'sql', content: 'SELECT 1'}),
                makeCell({id: 'b', type: 'sql', content: 'SELECT 2'}),
            ];
            expect(extractSqlFromCells(cells)).toBe('SELECT 1\n\nSELECT 2');
        });

        it('should skip markdown cells', () => {
            const cells = [
                makeCell({id: 'a', type: 'sql', content: 'SELECT 1'}),
                makeCell({id: 'b', type: 'markdown', content: '# Title'}),
                makeCell({id: 'c', type: 'sql', content: 'SELECT 2'}),
            ];
            expect(extractSqlFromCells(cells)).toBe('SELECT 1\n\nSELECT 2');
        });

        it('should skip empty SQL cells', () => {
            const cells = [
                makeCell({id: 'a', type: 'sql', content: 'SELECT 1'}),
                makeCell({id: 'b', type: 'sql', content: '   '}),
                makeCell({id: 'c', type: 'sql', content: 'SELECT 2'}),
            ];
            expect(extractSqlFromCells(cells)).toBe('SELECT 1\n\nSELECT 2');
        });

        it('should return empty string when no SQL cells', () => {
            const cells = [makeCell({id: 'a', type: 'markdown', content: '# Title'})];
            expect(extractSqlFromCells(cells)).toBe('');
        });

        it('should return empty string for empty array', () => {
            expect(extractSqlFromCells([])).toBe('');
        });
    });
});
