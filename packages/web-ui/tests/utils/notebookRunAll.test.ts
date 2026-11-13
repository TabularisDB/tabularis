import {describe, it, expect} from 'vitest';
import {
    getExecutableCells,
    createRunAllResult,
    addSuccess,
    addFailure,
    addSkipped,
    addBlocked,
    getDisabledCells,
    findDisabledPrerequisites,
    formatRunAllSummary,
} from '@/utils/notebookRunAll';
import type {NotebookCell} from '@/types/notebook';

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

describe('notebookRunAll', () => {
    describe('getExecutableCells', () => {
        it('should return only SQL cells with content', () => {
            const cells = [
                makeCell({id: 'a', type: 'sql', content: 'SELECT 1'}),
                makeCell({id: 'b', type: 'markdown', content: '# Title'}),
                makeCell({id: 'c', type: 'sql', content: ''}),
                makeCell({id: 'd', type: 'sql', content: 'SELECT 2'}),
            ];
            const result = getExecutableCells(cells);
            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({cell: cells[0], index: 0});
            expect(result[1]).toEqual({cell: cells[3], index: 3});
        });

        it('should skip whitespace-only SQL cells', () => {
            const cells = [makeCell({content: '   \n  '})];
            expect(getExecutableCells(cells)).toHaveLength(0);
        });

        it('should return empty for empty cells array', () => {
            expect(getExecutableCells([])).toHaveLength(0);
        });
    });

    describe('createRunAllResult', () => {
        it('should initialize with zeros', () => {
            const result = createRunAllResult();
            expect(result.total).toBe(0);
            expect(result.executed).toBe(0);
            expect(result.succeeded).toBe(0);
            expect(result.failed).toBe(0);
            expect(result.skipped).toBe(0);
            expect(result.errors).toEqual([]);
        });
    });

    describe('addSuccess', () => {
        it('should increment executed and succeeded', () => {
            const result = addSuccess(createRunAllResult());
            expect(result.executed).toBe(1);
            expect(result.succeeded).toBe(1);
            expect(result.failed).toBe(0);
        });
    });

    describe('addFailure', () => {
        it('should increment executed and failed and add error', () => {
            const result = addFailure(createRunAllResult(), 'c1', 0, 'error msg');
            expect(result.executed).toBe(1);
            expect(result.failed).toBe(1);
            expect(result.errors).toEqual([{cellId: 'c1', cellIndex: 0, error: 'error msg'}]);
        });
    });

    describe('addSkipped', () => {
        it('should increment skipped count', () => {
            const result = addSkipped(createRunAllResult(), 3);
            expect(result.skipped).toBe(3);
        });
    });

    describe('formatRunAllSummary', () => {
        it('should format mixed result', () => {
            let result = createRunAllResult();
            result = addSuccess(result);
            result = addSuccess(result);
            result = addFailure(result, 'c1', 0, 'err');
            result = addSkipped(result, 1);
            expect(formatRunAllSummary(result)).toBe('2 succeeded, 1 failed, 1 skipped');
        });

        it('should format success-only result', () => {
            let result = createRunAllResult();
            result = addSuccess(result);
            expect(formatRunAllSummary(result)).toBe('1 succeeded');
        });

        it('should return empty for zero result', () => {
            expect(formatRunAllSummary(createRunAllResult())).toBe('');
        });
    });
});

describe('notebookRunAll disabled cells', () => {
    const cachedResult = {columns: ['id'], rows: [[1]], affected_rows: 0};

    describe('getExecutableCells / getDisabledCells', () => {
        it('leaves disabled SQL cells out of Run All and lists them as disabled', () => {
            const cells = [
                makeCell({id: 'a', content: 'SELECT 1'}),
                makeCell({id: 'b', content: 'SELECT 2', isDisabled: true}),
                makeCell({id: 'c', content: '   ', isDisabled: true}),
                makeCell({id: 'd', type: 'markdown', content: '# x', isDisabled: true}),
                makeCell({id: 'e', content: 'SELECT 3', isDisabled: false}),
            ];
            expect(getExecutableCells(cells).map(({cell}) => cell.id)).toEqual(['a', 'e']);
            expect(getDisabledCells(cells)).toEqual([{cell: cells[1], index: 1}]);
        });

        it('treats legacy cells without the flag as enabled', () => {
            const cells = [makeCell({id: 'a', content: 'SELECT 1'})];
            expect(getExecutableCells(cells)).toHaveLength(1);
            expect(getDisabledCells(cells)).toEqual([]);
        });
    });

    describe('findDisabledPrerequisites', () => {
        it('returns a directly referenced disabled cell, even when it has cached output', () => {
            const cells = [
                makeCell({id: 'a', content: 'SELECT 1', isDisabled: true, result: cachedResult}),
                makeCell({id: 'b', content: 'SELECT * FROM {{cell_1}}'}),
            ];
            expect(findDisabledPrerequisites('SELECT * FROM {{cell_1}}', cells)).toEqual([0]);
        });

        it('follows a chain through cells that would have to run first', () => {
            const cells = [
                makeCell({id: 'a', content: 'SELECT 1', isDisabled: true}),
                makeCell({id: 'b', content: 'SELECT * FROM {{cell_1}}'}),
                makeCell({id: 'c', content: 'SELECT * FROM {{cell_2}}', error: 'boom'}),
            ];
            expect(findDisabledPrerequisites('SELECT * FROM {{cell_3}}', cells)).toEqual([0]);
        });

        it('stops at an enabled prerequisite that already has a current result', () => {
            const cells = [
                makeCell({id: 'a', content: 'SELECT 1', isDisabled: true}),
                makeCell({id: 'b', content: 'SELECT * FROM {{cell_1}}', result: cachedResult}),
            ];
            expect(findDisabledPrerequisites('SELECT * FROM {{cell_2}}', cells)).toEqual([]);
        });

        it('returns every disabled prerequisite once, sorted, and survives reference cycles', () => {
            const cells = [
                makeCell({id: 'a', content: 'SELECT * FROM {{cell_2}}'}),
                makeCell({id: 'b', content: 'SELECT * FROM {{cell_1}} JOIN {{cell_4}}'}),
                makeCell({id: 'c', content: 'SELECT 3', isDisabled: true}),
                makeCell({id: 'd', content: 'SELECT 4', isDisabled: true}),
            ];
            expect(
                findDisabledPrerequisites(
                    'SELECT * FROM {{cell_4}}, {{cell_1}}, {{cell_3}}',
                    cells,
                ),
            ).toEqual([2, 3]);
        });

        it('ignores Markdown, missing and enabled cells', () => {
            const cells = [
                makeCell({id: 'a', type: 'markdown', content: '# x', isDisabled: true}),
                makeCell({id: 'b', content: 'SELECT 2', result: cachedResult}),
            ];
            expect(
                findDisabledPrerequisites('SELECT {{cell_1}}, {{cell_2}}, {{cell_9}}', cells),
            ).toEqual([]);
            expect(findDisabledPrerequisites('SELECT 1', cells)).toEqual([]);
        });

        it('applies prepare to prerequisite sources so parameter-made references count', () => {
            const cells = [
                makeCell({id: 'a', content: 'SELECT 1', isDisabled: true}),
                makeCell({id: 'b', content: 'SELECT * FROM @source'}),
            ];
            const prepare = (source: string) => source.replace('@source', '{{cell_1}}');
            expect(findDisabledPrerequisites('SELECT * FROM {{cell_2}}', cells)).toEqual([]);
            expect(findDisabledPrerequisites('SELECT * FROM {{cell_2}}', cells, prepare)).toEqual([
                0,
            ]);
        });
    });

    describe('addBlocked / summary', () => {
        it('counts blocked cells apart from executed, failed and skipped ones', () => {
            let result = createRunAllResult();
            expect(result).toMatchObject({blocked: 0, blockedCells: []});
            result = addSkipped(result, 1);
            result = addBlocked(result, 'b', 1, [{cellId: 'a', cellIndex: 0}]);
            expect(result).toMatchObject({
                executed: 0,
                failed: 0,
                skipped: 1,
                blocked: 1,
                blockedCells: [
                    {cellId: 'b', cellIndex: 1, disabledCells: [{cellId: 'a', cellIndex: 0}]},
                ],
            });
            expect(formatRunAllSummary(addSuccess(result))).toBe(
                '1 succeeded, 1 skipped, 1 blocked',
            );
        });
    });
});
