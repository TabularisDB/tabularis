import {describe, expect, it, vi} from 'vitest';
import {resolveQueryVariables} from '@/utils/notebookVariables';
import {resolveSqlSyntax} from '@/utils/sqlSyntax';
import type {NotebookCell} from '@/types/notebook';
import {buildNotebookExecutionPlan, type NotebookRunRequest} from '@/utils/notebookExecutionPlan';
import {
    acquireNotebookRun,
    executeNotebookPlan,
    findDisabledPrerequisites,
    type CellRunOutcome,
} from '@/utils/notebookRunAll';

const cachedResult = {columns: ['n'], rows: [[1]], affected_rows: 0};
const success = {kind: 'success', result: cachedResult} as const;

function makeCell(input: Partial<NotebookCell> & {id: string}): NotebookCell {
    return {type: 'sql', content: 'SELECT 1', ...input};
}

function plan(cells: NotebookCell[], request: NotebookRunRequest = {mode: 'all'}) {
    const outcome = buildNotebookExecutionPlan({
        cells,
        request,
        prepare: (sql) => ({sql, errors: []}),
        fallbackSchema: 'main',
        schemaIsDatabase: true,
        canReuse: () => true,
        syntax: resolveSqlSyntax({sql_dialect: 'mysql'}),
    });
    if (outcome.kind !== 'ready') throw new Error(JSON.stringify(outcome.issues));
    return outcome.plan;
}

function deferred() {
    let resolve: (value: CellRunOutcome) => void = () => {};
    const promise = new Promise<CellRunOutcome>((done) => {
        resolve = done;
    });
    return {promise, resolve};
}

describe('notebookRunAll', () => {
    it('locks one notebook until its active run settles', () => {
        const release = acquireNotebookRun('first');
        expect(release).toBeTypeOf('function');
        expect(acquireNotebookRun('first')).toBeUndefined();
        const releaseOther = acquireNotebookRun('other');
        expect(releaseOther).toBeTypeOf('function');
        releaseOther?.();
        release?.();
        const reacquired = acquireNotebookRun('first');
        expect(reacquired).toBeTypeOf('function');
        reacquired?.();
    });

    describe('executeNotebookPlan', () => {
        it('plans an 8,000-cell forward chain and checks its cached bindings before dispatch', async () => {
            const size = 8_000;
            const cells = Array.from({length: size}, (_, i) =>
                makeCell({
                    id: String(i),
                    content: i === size - 1 ? 'SELECT 1 AS n' : `SELECT * FROM {{cell_${i + 2}}}`,
                }),
            );
            const request = {mode: 'cell', cellId: '0'} as const;
            expect(plan(cells, request).steps.map(({index}) => index)).toEqual(
                Array.from({length: size}, (_, index) => size - 1 - index),
            );

            const cached = cells.map((cell) => ({...cell, result: cachedResult}));
            const built = buildNotebookExecutionPlan({
                cells: cached,
                request,
                fallbackSchema: 'main',
                connectionId: 'db',
                canReuse: () => true,
                prepare: (sql) => ({sql, errors: []}),
            });
            expect(built.kind).toBe('ready');
            if (built.kind !== 'ready') return;
            const call = vi.fn().mockResolvedValue(cachedResult);
            const run = () =>
                executeNotebookPlan(built.plan, {
                    stopOnError: false,
                    readCells: () => cached,
                    execute: async (node, inputs, checkBeforeSend) => {
                        expect(checkBeforeSend()).toBeUndefined();
                        const {sql} = resolveQueryVariables(
                            node.sql,
                            inputs,
                            undefined,
                            node.references,
                        );
                        const result = await call('execute_query', {
                            connectionId: 'db',
                            schema: node.schema,
                            query: sql,
                            limit: 37,
                            page: 1,
                        });
                        return {kind: 'success', result};
                    },
                });
            expect(await run()).toMatchObject({executed: 1, succeeded: 1});
            expect(call).toHaveBeenCalledExactlyOnceWith('execute_query', {
                connectionId: 'db',
                schema: 'main',
                limit: 37,
                page: 1,
                query: 'WITH cell_2 AS (\n  SELECT 1 AS "n"\n)\nSELECT * FROM cell_2',
            });
            cached[size - 1] = {...cached[size - 1], content: 'SELECT 2 AS n'};
            expect(await run()).toMatchObject({executed: 0, blocked: 1});
            expect(call).toHaveBeenCalledTimes(1);
        });

        it('executes and counts a diamond prerequisite once, passing the fresh result to both consumers', async () => {
            const cells = [
                makeCell({id: 'a', result: cachedResult}),
                makeCell({id: 'b', content: 'SELECT * FROM {{cell_1}}'}),
                makeCell({id: 'c', content: 'SELECT * FROM {{cell_1}}'}),
                makeCell({id: 'd', content: 'SELECT * FROM {{cell_2}} JOIN {{cell_3}} ON 1=1'}),
                makeCell({id: 'off', isDisabled: true}),
            ];
            const fresh = {columns: ['n'], rows: [[42]], affected_rows: 0};
            const executed: string[] = [];
            const result = await executeNotebookPlan(plan(cells), {
                stopOnError: false,
                readCells: () => cells,
                execute: async ({cell}, inputs) => {
                    executed.push(cell.id);
                    if (cell.id === 'a') return {kind: 'success', result: fresh};
                    expect(inputs[0].result).toBe(fresh);
                    return success;
                },
            });
            expect(executed).toEqual(['a', 'b', 'c', 'd']);
            expect(result).toMatchObject({
                total: 5,
                executed: 4,
                succeeded: 4,
                failed: 0,
                blocked: 0,
                skipped: 1,
            });
        });

        it.each([true, false])(
            'blocks all consumers of an unavailable prerequisite (SQL was sent: %s)',
            async (sent) => {
                const cells = [
                    makeCell({id: 'a', result: cachedResult}),
                    makeCell({id: 'b', content: 'SELECT * FROM {{cell_1}}', result: cachedResult}),
                    makeCell({id: 'c', content: 'SELECT * FROM {{cell_2}}'}),
                    makeCell({id: 'd'}),
                ];
                const execute = vi.fn(
                    async ({cell}: {cell: NotebookCell}): Promise<CellRunOutcome> =>
                        cell.id === 'a' ? {kind: 'failed', error: 'unavailable', sent} : success,
                );
                const result = await executeNotebookPlan(plan(cells), {
                    stopOnError: false,
                    readCells: () => cells,
                    execute,
                });
                expect(execute.mock.calls.map(([node]) => node.cell.id)).toEqual(['a', 'd']);
                expect(result).toMatchObject({
                    total: 4,
                    executed: sent ? 2 : 1,
                    succeeded: 1,
                    failed: 1,
                    blocked: 2,
                });
                expect(result.blockedCells).toEqual([
                    {cellId: 'b', cellIndex: 1, prerequisite: {cellId: 'a', cellIndex: 0}},
                    {cellId: 'c', cellIndex: 2, prerequisite: {cellId: 'b', cellIndex: 1}},
                ]);
            },
        );

        it('keeps dependent, unmarked, same-lane and write queries out of a parallel batch', async () => {
            const held = deferred();
            const cells = [
                makeCell({id: 'a', isParallel: true}),
                makeCell({id: 'b', isParallel: true, schema: 'orders'}),
                makeCell({
                    id: 'dependent',
                    isParallel: true,
                    schema: 'shipments',
                    content: 'SELECT * FROM {{cell_1}}',
                }),
                makeCell({id: 'same-lane', isParallel: true, schema: 'shipments'}),
                makeCell({
                    id: 'write',
                    isParallel: true,
                    schema: 'billing',
                    content: 'WITH foo AS (SELECT 1) DELETE FROM t',
                }),
                makeCell({
                    id: 'other-write',
                    isParallel: true,
                    schema: 'sales',
                    content: 'INSERT INTO t VALUES (1)',
                }),
                makeCell({id: 'unmarked', schema: 'billing'}),
            ];
            const active = new Set<string>();
            const started: string[] = [];
            const run = executeNotebookPlan(plan(cells), {
                stopOnError: false,
                readCells: () => cells,
                execute: async ({cell}) => {
                    if (cell.id === 'a') expect(active.size).toBe(0);
                    else if (cell.id === 'b') expect([...active]).toEqual(['a']);
                    else expect(active.size).toBe(0);
                    active.add(cell.id);
                    started.push(cell.id);
                    if (cell.id === 'a') await held.promise;
                    await Promise.resolve();
                    active.delete(cell.id);
                    return success;
                },
            });
            expect(started).toEqual(['a', 'b']);
            held.resolve(success);
            expect(await run).toMatchObject({total: 7, executed: 7, succeeded: 7});
            expect(started).toEqual(cells.map((cell) => cell.id));
        });

        it('does not overlap opt-in cells sharing the notebook fallback database', async () => {
            const held = deferred();
            const cells = [
                makeCell({id: 'first', isParallel: true}),
                makeCell({id: 'second', isParallel: true, schema: 'main'}),
            ];
            const execute = vi.fn().mockReturnValueOnce(held.promise).mockResolvedValue(success);
            const run = executeNotebookPlan(plan(cells), {
                stopOnError: false,
                readCells: () => cells,
                execute,
            });
            expect(execute).toHaveBeenCalledTimes(1);
            held.resolve(success);
            expect(await run).toMatchObject({succeeded: 2});
            expect(execute).toHaveBeenCalledTimes(2);
        });

        it('skips edited and deleted pending cells and blocks their consumer instead of rebinding the reference', async () => {
            const cells = [
                makeCell({id: 'first'}),
                makeCell({id: 'edited'}),
                makeCell({id: 'deleted', result: cachedResult}),
                makeCell({id: 'consumer', content: 'SELECT * FROM {{cell_3}}'}),
                makeCell({id: 'independent'}),
            ];
            let live = cells;
            const execute = vi.fn(async ({cell}: {cell: NotebookCell}) => {
                if (cell.id === 'first')
                    live = [cells[0], {...cells[1], content: 'SELECT 2'}, ...cells.slice(3)];
                return success;
            });
            const result = await executeNotebookPlan(plan(cells), {
                stopOnError: false,
                readCells: () => live,
                execute,
            });
            expect(execute.mock.calls.map(([node]) => node.cell.id)).toEqual([
                'first',
                'independent',
            ]);
            expect(result).toMatchObject({
                total: 5,
                succeeded: 2,
                skipped: 2,
                blocked: 1,
                changedCells: [
                    {cellId: 'edited', cellIndex: 1},
                    {cellId: 'deleted', cellIndex: 2},
                ],
                blockedCells: [
                    {
                        cellId: 'consumer',
                        cellIndex: 3,
                        prerequisite: {cellId: 'deleted', cellIndex: 2},
                    },
                ],
            });
        });

        it('blocks use of a cached prerequisite that was removed before dispatch', async () => {
            const cells = [
                makeCell({id: 'cached', result: cachedResult}),
                makeCell({id: 'use', content: 'SELECT * FROM {{cell_1}}'}),
            ];
            let live = cells;
            const execute = vi.fn(async (_node, _inputs, checkBeforeSend) => {
                live = cells.slice(1);
                return checkBeforeSend() ?? success;
            });
            const result = await executeNotebookPlan(plan(cells, {mode: 'cell', cellId: 'use'}), {
                stopOnError: false,
                readCells: () => live,
                execute,
            });
            expect(result).toMatchObject({total: 1, executed: 0, succeeded: 0, blocked: 1});
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
});
