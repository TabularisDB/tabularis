import type {ComponentProps} from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {invoke} from '@tauri-apps/api/core';
import {save} from '@tauri-apps/plugin-dialog';
import {writeFile} from '@tauri-apps/plugin-fs';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {NotebookView} from '@/components/notebook/NotebookView';
import type {ConfirmModal} from '@/components/modals/ConfirmModal';
import type {NotebookCellWrapper} from '@/components/notebook/NotebookCellWrapper';
import type {NotebookToolbar} from '@/components/notebook/NotebookToolbar';
import type {RunAllSummary} from '@/components/notebook/RunAllSummary';
import type {QueryResult, Tab} from '@/types/editor';
import type {NotebookCell, NotebookState} from '@/types/notebook';
import {resolveParams} from '@/utils/notebookParams';
import {resolveQueryVariables, type ResolvedQuery} from '@/utils/notebookVariables';
import {loadNotebook, setNotebookState} from '@/utils/notebookStore';

vi.mock('@/hooks/useTabularisClient', () => import('../../support/tauriBackedHooks'));
vi.mock('@/hooks/usePlatformCapabilities', () => import('../../support/tauriBackedHooks'));
const fixtures = vi.hoisted(() => ({
    notebooks: new Map<string, NotebookState>(),
    database: {
        activeDriver: 'postgres',
        activeSchema: 'active_schema' as string | null,
        activeCapabilities: null as {identifier_quote: string; sql_dialect: string} | null,
        selectedDatabases: [] as string[],
    },
    settings: {resultPageSize: 37, safetyConfirmationDelayEnabled: false},
    guardQuery: vi.fn(),
    resolveGuard: vi.fn(),
    matchesShortcut: vi.fn(),
    showAlert: vi.fn(),
    mounts: new Map<string, number>(),
}));

vi.mock('@/hooks/useDatabase', () => ({
    useDatabase: () => fixtures.database,
}));
vi.mock('@/hooks/useSettings', () => ({
    useSettings: () => ({settings: fixtures.settings}),
}));
vi.mock('@/hooks/useAlert', () => ({
    useAlert: () => ({showAlert: fixtures.showAlert}),
}));
vi.mock('@/hooks/useKeybindings', () => ({
    useKeybindings: () => ({matchesShortcut: fixtures.matchesShortcut}),
}));
vi.mock('@/hooks/useQueryGuards', () => ({
    useQueryGuards: () => ({
        pending: null,
        guardQuery: fixtures.guardQuery,
        resolve: fixtures.resolveGuard,
    }),
}));
vi.mock('@/hooks/useSqlAutocompleteRegistration', () => ({
    useSqlAutocompleteRegistration: vi.fn(),
}));
vi.mock('@/utils/notebookStore', () => ({
    getNotebookState: vi.fn((id: string) => fixtures.notebooks.get(id)),
    setNotebookState: vi.fn((id: string, state: NotebookState) => {
        fixtures.notebooks.set(id, state);
    }),
    loadNotebook: vi.fn(),
    setNotebookTitle: vi.fn(),
    createNotebookFromState: vi.fn(),
}));
// Observe preparation without replacing the real parameter/reference algorithms.
vi.mock('@/utils/notebookParams', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/utils/notebookParams')>();
    return {...actual, resolveParams: vi.fn(actual.resolveParams)};
});
vi.mock('@/utils/notebookVariables', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/utils/notebookVariables')>();
    return {...actual, resolveQueryVariables: vi.fn(actual.resolveQueryVariables)};
});
vi.mock('@tauri-apps/api/core', () => ({invoke: vi.fn(), isTauri: () => true}));
vi.mock('@tauri-apps/plugin-dialog', () => ({save: vi.fn(), open: vi.fn()}));
vi.mock('@tauri-apps/plugin-fs', () => ({
    writeTextFile: vi.fn(),
    readTextFile: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
}));
vi.mock('@/components/modals/ConfirmModal', () => ({
    ConfirmModal: ({isOpen, title, onConfirm, onClose}: ComponentProps<typeof ConfirmModal>) =>
        isOpen ? (
            <div role="dialog" aria-label={title}>
                <button onClick={onConfirm}>Confirm {title}</button>
                <button onClick={onClose}>Cancel {title}</button>
            </div>
        ) : null,
}));
vi.mock('@/components/notebook/NotebookHistoryPanel', () => ({
    NotebookHistoryPanel: () => null,
}));
vi.mock('@/components/notebook/AddCellButton', () => ({AddCellButton: () => null}));
vi.mock('@/components/notebook/RunAllSummary', () => ({
    RunAllSummary: ({result}: ComponentProps<typeof RunAllSummary>) => (
        <output data-testid="run-all-summary">{result.total}</output>
    ),
}));
vi.mock('@/components/notebook/ParamsPanel', () => ({ParamsPanel: () => null}));
vi.mock('@/components/notebook/NotebookOutline', () => ({NotebookOutline: () => null}));
vi.mock('@/components/notebook/NotebookToolbar', () => ({
    NotebookToolbar: ({
        onRunAll,
        isRunning,
        onClearOutputs,
        canClearOutputs,
        onUndo,
        canUndo,
        onRedo,
        canRedo,
        onExportMarkdown,
    }: ComponentProps<typeof NotebookToolbar>) => (
        <>
            <button onClick={onExportMarkdown}>Export Markdown</button>
            <button onClick={onRunAll} disabled={isRunning}>
                Run All
            </button>
            <button onClick={onClearOutputs} disabled={!canClearOutputs}>
                Clear outputs
            </button>
            <button onClick={onUndo} disabled={!canUndo}>
                Undo
            </button>
            <button onClick={onRedo} disabled={!canRedo}>
                Redo
            </button>
        </>
    ),
}));
// Only the child boundary is replaced: NotebookView owns state and execution.
// Do not read cell.result here, so the hidden-plan test can detect materialization.
vi.mock('@/components/notebook/NotebookCellWrapper', async () => {
    const {useEffect} = await import('react');
    return {
        NotebookCellWrapper: ({
            cell,
            explainQuery,
            activeSchema,
            connectionId,
            onRun,
            onUpdate,
            onMoveDown,
            onDuplicate,
            canDuplicate,
        }: ComponentProps<typeof NotebookCellWrapper>) => {
            // A remount discards per-cell plan state, so mounts are observable here.
            useEffect(() => {
                fixtures.mounts.set(cell.id, (fixtures.mounts.get(cell.id) ?? 0) + 1);
            }, [cell.id]);
            return (
                <section
                    data-testid={`cell-${cell.id}`}
                    data-schema={activeSchema}
                    data-connection={connectionId}
                    data-loading={!!cell.isLoading}
                >
                    <output data-testid={`explain-${cell.id}`}>
                        {JSON.stringify(explainQuery ?? null)}
                    </output>
                    <textarea
                        aria-label={`SQL ${cell.id}`}
                        value={cell.content}
                        onChange={(event) => onUpdate({content: event.target.value})}
                    />
                    <button
                        onClick={() => onUpdate({isQueryPlanVisible: !cell.isQueryPlanVisible})}
                    >
                        Toggle plan {cell.id}
                    </button>
                    <button onClick={onRun}>Run {cell.id}</button>
                    <button onClick={onMoveDown}>Move down {cell.id}</button>
                    <button onClick={onDuplicate} disabled={!canDuplicate}>
                        Duplicate {cell.id}
                    </button>
                </section>
            );
        },
    };
});

const mockInvoke = vi.mocked(invoke);
const mockSave = vi.mocked(save);
const mockWriteFile = vi.mocked(writeFile);
const mockResolveParams = vi.mocked(resolveParams);
const mockResolveVariables = vi.mocked(resolveQueryVariables);
const notebookId = 'notebook-1';
const connectionId = 'notebook-connection';
const rawQuery = '  SELECT * FROM @source WHERE id >= ${minimum}  \n';
const parameterSql = 'SELECT * FROM {{cell_1}} WHERE id >= 7';
const params = [
    {name: 'source', value: '{{cell_1}}'},
    {name: 'minimum', value: '7'},
];
const sourceResult: QueryResult = {
    columns: ['id', 'label'],
    rows: [[7, String.raw`C:\team\O'Reilly`]],
    affected_rows: 0,
};
const queryResult: QueryResult = {columns: ['id'], rows: [[7], [8]], affected_rows: 0};
const standardSql = `WITH cell_1 AS (\n  SELECT 7 AS "id", '${String.raw`C:\team\O''Reilly`}' AS "label"\n)\nSELECT * FROM cell_1 WHERE id >= 7`;
const mysqlSql = `WITH cell_1 AS (\n  SELECT 7 AS \`id\`, '${String.raw`C:\\team\\O''Reilly`}' AS \`label\`\n)\nSELECT * FROM cell_1 WHERE id >= 7`;
const backtickStandardSql = `WITH cell_1 AS (\n  SELECT 7 AS \`id\`, '${String.raw`C:\team\O''Reilly`}' AS \`label\`\n)\nSELECT * FROM cell_1 WHERE id >= 7`;

function sqlCell(id: string, content: string, partial: Partial<NotebookCell> = {}): NotebookCell {
    return {id, type: 'sql', content, ...partial};
}

function renderNotebook(state: NotebookState, tabOverrides: Partial<Tab> = {}) {
    fixtures.notebooks.set(notebookId, state);
    const tab: Tab = {
        id: 'tab-1',
        title: 'Notebook',
        type: 'notebook',
        notebookId,
        connectionId,
        query: '',
        result: null,
        error: '',
        executionTime: null,
        page: 1,
        activeTable: null,
        pkColumns: null,
        schema: 'tab_schema',
        ...tabOverrides,
    };
    return render(
        <NotebookView tab={tab} updateTab={vi.fn()} connectionId={connectionId} isActive />,
    );
}

function explainFor(id: string): ResolvedQuery | null {
    return JSON.parse(
        screen.getByTestId(`explain-${id}`).textContent ?? 'null',
    ) as ResolvedQuery | null;
}

function savedCell(id: string): NotebookCell {
    const cell = fixtures.notebooks.get(notebookId)?.cells.find((entry) => entry.id === id);
    if (!cell) throw new Error(`Missing test cell ${id}`);
    return cell;
}

async function settle() {
    await act(async () => {
        await Promise.resolve();
    });
}

describe('NotebookView', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        fixtures.notebooks.clear();
        fixtures.mounts.clear();
        fixtures.database.activeDriver = 'postgres';
        fixtures.database.activeCapabilities = null;
        fixtures.database.activeSchema = 'active_schema';
        fixtures.settings.resultPageSize = 37;
        fixtures.guardQuery.mockReset().mockResolvedValue(true);
        fixtures.matchesShortcut.mockReset().mockReturnValue(false);
        mockInvoke.mockReset().mockResolvedValue(queryResult);
    });

    describe('explainQuery preparation', () => {
        it('resolves notebook parameters before references and passes cached data to the visible plan', async () => {
            const state: NotebookState = {
                params,
                cells: [
                    sqlCell('source', 'SELECT id, label FROM people', {result: sourceResult}),
                    sqlCell('target', rawQuery, {isQueryPlanVisible: true}),
                ],
            };
            renderNotebook(state);
            await settle();

            expect(mockResolveParams).toHaveBeenCalledWith(rawQuery.trim(), params);
            expect(mockResolveVariables).toHaveBeenCalledWith(parameterSql, state.cells, {
                escapeBackslashes: false,
                identifierQuote: '"',
            });
            expect(explainFor('target')).toEqual({sql: standardSql, unresolvedRefs: []});
            expect(screen.getByRole('textbox', {name: 'SQL target'})).toHaveValue(rawQuery);
            expect(screen.getByTestId('cell-target')).toHaveAttribute(
                'data-connection',
                connectionId,
            );
            expect(loadNotebook).not.toHaveBeenCalled();
            expect(setNotebookState).not.toHaveBeenCalled();
            expect(fixtures.guardQuery).not.toHaveBeenCalled();
            expect(mockInvoke).not.toHaveBeenCalled();
        });

        it.each([undefined, false])(
            'does not resolve or materialize a hidden plan (visibility %s), including after edits',
            async (isQueryPlanVisible) => {
                const readRows = vi.fn(() => sourceResult.rows);
                const cachedResult: QueryResult = {
                    columns: sourceResult.columns,
                    affected_rows: 0,
                    get rows() {
                        return readRows();
                    },
                };
                renderNotebook({
                    params,
                    cells: [
                        sqlCell('source', 'SELECT id, label FROM people', {result: cachedResult}),
                        sqlCell('target', rawQuery, {isQueryPlanVisible}),
                        {
                            id: 'notes',
                            type: 'markdown',
                            content: '{{cell_1}}',
                            isQueryPlanVisible: true,
                        },
                    ],
                });
                await settle();
                expect(explainFor('target')).toBeNull();
                expect(explainFor('notes')).toBeNull();
                expect(mockResolveParams).not.toHaveBeenCalled();
                expect(mockResolveVariables).not.toHaveBeenCalled();
                expect(readRows).not.toHaveBeenCalled();

                fireEvent.click(screen.getByRole('button', {name: 'Toggle plan target'}));
                expect(savedCell('target').isQueryPlanVisible).toBe(true);
                expect(explainFor('target')).toEqual({sql: standardSql, unresolvedRefs: []});
                expect(readRows).toHaveBeenCalled();

                mockResolveParams.mockClear();
                mockResolveVariables.mockClear();
                readRows.mockClear();
                fireEvent.click(screen.getByRole('button', {name: 'Toggle plan target'}));
                fireEvent.change(screen.getByRole('textbox', {name: 'SQL target'}), {
                    target: {value: rawQuery.replace('*', 'label')},
                });
                await settle();
                expect(savedCell('target').isQueryPlanVisible).toBe(false);
                expect(explainFor('target')).toBeNull();
                expect(mockResolveParams).not.toHaveBeenCalled();
                expect(mockResolveVariables).not.toHaveBeenCalled();
                expect(readRows).not.toHaveBeenCalled();

                fireEvent.click(screen.getByRole('button', {name: 'Toggle plan target'}));
                expect(explainFor('target')).toEqual({
                    sql: standardSql.replace('SELECT *', 'SELECT label'),
                    unresolvedRefs: [],
                });
                expect(mockResolveVariables).toHaveBeenCalled();
                // The dependency still holds the same result, so its rows are reused.
                expect(readRows).not.toHaveBeenCalled();
                expect(mockInvoke).not.toHaveBeenCalled();
            },
        );

        it.each([
            {
                name: 'missing result',
                partial: {result: null},
                reference: '{{cell_1}}',
                cellIndex: 0,
            },
            {
                name: 'errored result',
                partial: {result: sourceResult, error: 'Previous execution failed'},
                reference: '{{cell_1}}',
                cellIndex: 0,
            },
            {
                name: 'missing cell',
                partial: {result: sourceResult},
                reference: '{{cell_9}}',
                cellIndex: 8,
            },
        ])(
            'keeps a $name unresolved without lazy-executing dependencies',
            async ({partial, reference, cellIndex}) => {
                renderNotebook({
                    params: [{name: 'source', value: reference}],
                    cells: [
                        sqlCell('source', 'SELECT id, label FROM people', partial),
                        sqlCell('target', ' SELECT * FROM @source ', {isQueryPlanVisible: true}),
                    ],
                });
                await settle();
                expect(explainFor('target')).toEqual({
                    sql: `SELECT * FROM ${reference}`,
                    unresolvedRefs: [{match: reference, cellIndex}],
                });
                fireEvent.change(screen.getByRole('textbox', {name: 'SQL target'}), {
                    target: {value: 'SELECT id FROM @source'},
                });
                await settle();
                expect(explainFor('target')).toEqual({
                    sql: `SELECT id FROM ${reference}`,
                    unresolvedRefs: [{match: reference, cellIndex}],
                });
                expect(savedCell('source')).toMatchObject(partial);
                expect(savedCell('source').history).toBeUndefined();
                expect(fixtures.guardQuery).not.toHaveBeenCalled();
                expect(mockInvoke).not.toHaveBeenCalled();
            },
        );

        it('keeps cells mounted across reordering and editing', async () => {
            renderNotebook({
                cells: [
                    sqlCell('first', 'SELECT 1', {isQueryPlanVisible: true}),
                    sqlCell('second', 'SELECT 2', {isQueryPlanVisible: true}),
                ],
            });
            await settle();
            expect(fixtures.mounts.get('first')).toBe(1);
            expect(fixtures.mounts.get('second')).toBe(1);

            fireEvent.click(screen.getByRole('button', {name: 'Move down first'}));
            await settle();
            fireEvent.change(screen.getByRole('textbox', {name: 'SQL first'}), {
                target: {value: 'SELECT 11'},
            });
            await settle();

            expect(savedCell('first').content).toBe('SELECT 11');
            expect(fixtures.notebooks.get(notebookId)?.cells.map((cell) => cell.id)).toEqual([
                'second',
                'first',
            ]);
            expect(fixtures.mounts.get('first')).toBe(1);
            expect(fixtures.mounts.get('second')).toBe(1);
        });
    });

    describe('legacy runCell', () => {
        it.each([
            {
                driver: 'mysql',
                capabilities: null,
                escapeBackslashes: true,
                identifierQuote: '`',
                expectedSql: mysqlSql,
            },
            {
                driver: 'postgres',
                capabilities: null,
                escapeBackslashes: false,
                identifierQuote: '"',
                expectedSql: standardSql,
            },
            {
                driver: 'sqlite',
                capabilities: null,
                escapeBackslashes: false,
                identifierQuote: '"',
                expectedSql: standardSql,
            },
            {
                driver: 'test-driver',
                capabilities: null,
                escapeBackslashes: false,
                identifierQuote: '"',
                expectedSql: standardSql,
            },
            {
                driver: 'backtick-plugin',
                capabilities: {identifier_quote: '`', sql_dialect: 'generic'},
                escapeBackslashes: false,
                identifierQuote: '`',
                expectedSql: backtickStandardSql,
            },
        ])(
            'uses the same prepared SQL for the plan and execute_query with $driver escaping, preserving result history',
            async ({driver, capabilities, escapeBackslashes, identifierQuote, expectedSql}) => {
                fixtures.database.activeDriver = driver;
                fixtures.database.activeCapabilities = capabilities;
                const previousEntry = {
                    query: 'SELECT 1',
                    result: null,
                    executionTime: 1,
                    timestamp: 1,
                };
                renderNotebook({
                    params,
                    cells: [
                        sqlCell('source', 'SELECT id, label FROM people', {result: sourceResult}),
                        sqlCell('target', rawQuery, {
                            schema: 'cell_schema',
                            isQueryPlanVisible: true,
                            history: [previousEntry],
                        }),
                    ],
                });
                const prepared = explainFor('target');
                expect(prepared).toEqual({sql: expectedSql, unresolvedRefs: []});
                expect(mockResolveVariables).toHaveBeenCalledWith(parameterSql, expect.any(Array), {
                    escapeBackslashes,
                    identifierQuote,
                });
                expect(mockInvoke).not.toHaveBeenCalled();

                await act(async () => {
                    fireEvent.click(screen.getByRole('button', {name: 'Run target'}));
                });

                expect(mockInvoke).toHaveBeenCalledExactlyOnceWith('execute_query', {
                    connectionId,
                    query: prepared?.sql,
                    schema: 'cell_schema',
                    limit: 37,
                    page: 1,
                });
                expect(fixtures.guardQuery).toHaveBeenCalledExactlyOnceWith(expectedSql);
                const target = savedCell('target');
                expect(target).toMatchObject({
                    result: queryResult,
                    isLoading: false,
                    executionTime: expect.any(Number),
                });
                expect(target.error).toBeUndefined();
                expect(target.executionTime).toBeGreaterThanOrEqual(0);
                expect(target.history).toEqual([
                    {
                        query: rawQuery.trim(),
                        result: queryResult,
                        error: undefined,
                        executionTime: target.executionTime,
                        timestamp: expect.any(Number),
                    },
                    previousEntry,
                ]);
                expect(savedCell('source').history).toBeUndefined();
                expect(screen.getByTestId('cell-target')).toHaveAttribute('data-loading', 'false');
                expect(explainFor('target')).toEqual(prepared);
                // The exact single invocation above also excludes EXPLAIN and batch execution.
            },
        );

        it.each([
            {tabSchema: 'tab_schema', activeSchema: 'active_schema', expectedSchema: 'tab_schema'},
            {tabSchema: undefined, activeSchema: 'active_schema', expectedSchema: 'active_schema'},
            {tabSchema: undefined, activeSchema: null, expectedSchema: undefined},
        ])(
            'forwards per-cell schema and notebook fallback $expectedSchema to both the child and execution',
            async ({tabSchema, activeSchema, expectedSchema}) => {
                fixtures.database.activeSchema = activeSchema;
                renderNotebook(
                    {
                        cells: [
                            sqlCell('override', 'SELECT 1', {
                                schema: 'cell_schema',
                                isQueryPlanVisible: true,
                            }),
                            sqlCell('fallback', 'SELECT 2', {isQueryPlanVisible: true}),
                        ],
                    },
                    {schema: tabSchema},
                );
                expect(screen.getByTestId('cell-override')).toHaveAttribute(
                    'data-schema',
                    'cell_schema',
                );
                if (expectedSchema)
                    expect(screen.getByTestId('cell-fallback')).toHaveAttribute(
                        'data-schema',
                        expectedSchema,
                    );
                else expect(screen.getByTestId('cell-fallback')).not.toHaveAttribute('data-schema');

                await act(async () => {
                    fireEvent.click(screen.getByRole('button', {name: 'Run override'}));
                });
                await act(async () => {
                    fireEvent.click(screen.getByRole('button', {name: 'Run fallback'}));
                });
                expect(mockInvoke.mock.calls).toEqual([
                    [
                        'execute_query',
                        {
                            connectionId,
                            query: 'SELECT 1',
                            schema: 'cell_schema',
                            limit: 37,
                            page: 1,
                        },
                    ],
                    [
                        'execute_query',
                        {
                            connectionId,
                            query: 'SELECT 2',
                            limit: 37,
                            page: 1,
                            ...(expectedSchema ? {schema: expectedSchema} : {}),
                        },
                    ],
                ]);
            },
        );
    });

    describe('Run All', () => {
        it.each([false, true])(
            'runs ordinary queries only and uses fresh dependency results (plan visible: %s)',
            async (isQueryPlanVisible) => {
                mockInvoke.mockResolvedValueOnce(sourceResult).mockResolvedValueOnce(queryResult);
                renderNotebook({
                    params,
                    cells: [
                        sqlCell('source', 'SELECT id, label FROM people'),
                        sqlCell('target', rawQuery, {schema: 'cell_schema', isQueryPlanVisible}),
                    ],
                });
                await settle();
                expect(mockInvoke).not.toHaveBeenCalled();
                await act(async () => {
                    fireEvent.click(screen.getByRole('button', {name: 'Run All'}));
                });

                expect(mockInvoke.mock.calls).toEqual([
                    [
                        'execute_query',
                        {
                            connectionId,
                            query: 'SELECT id, label FROM people',
                            schema: 'tab_schema',
                            limit: 37,
                            page: 1,
                        },
                    ],
                    [
                        'execute_query',
                        {
                            connectionId,
                            query: standardSql,
                            schema: 'cell_schema',
                            limit: 37,
                            page: 1,
                        },
                    ],
                ]);
                expect(savedCell('source').result).toEqual(sourceResult);
                expect(savedCell('target').result).toEqual(queryResult);
                expect(savedCell('source').history).toHaveLength(1);
                expect(savedCell('target').history).toHaveLength(1);
                expect(savedCell('target').history?.[0]).toMatchObject({
                    query: rawQuery.trim(),
                    result: queryResult,
                });
                expect(explainFor('target')).toEqual(
                    isQueryPlanVisible ? {sql: standardSql, unresolvedRefs: []} : null,
                );
                expect(screen.getByRole('button', {name: 'Run All'})).toBeEnabled();
            },
        );
    });

    describe('Clear all outputs', () => {
        const clearLabel = 'editor.notebook.clearOutputs';
        const historyEntry = {
            query: 'SELECT 1',
            result: queryResult,
            executionTime: 3,
            timestamp: 1,
        };
        const failedEntry = {
            query: 'SELECT oops',
            result: null,
            error: 'syntax error',
            executionTime: 2,
            timestamp: 2,
        };
        const chartConfig = {type: 'bar' as const, labelColumn: 'id', valueColumns: ['id']};

        function notebookWithOutputs(): NotebookState {
            return {
                params,
                stopOnError: true,
                cells: [
                    sqlCell('ok', 'SELECT 1', {
                        schema: 'cell_schema',
                        result: queryResult,
                        executionTime: 12,
                        history: [historyEntry],
                        chartConfig,
                    }),
                    {id: 'notes', type: 'markdown', content: '# Notes', isPreview: true},
                    sqlCell('failed', 'SELECT oops', {
                        error: 'syntax error',
                        executionTime: 4,
                        history: [failedEntry],
                    }),
                ],
            };
        }

        function deferredQuery() {
            let finish: (value: QueryResult) => void = () => {};
            mockInvoke.mockReturnValueOnce(
                new Promise<QueryResult>((resolve) => {
                    finish = resolve;
                }),
            );
            return (value: QueryResult) => finish(value);
        }

        const clearButton = () => screen.getByRole('button', {name: 'Clear outputs'});

        it('asks for confirmation, then clears every SQL cell output in one update', async () => {
            const state = notebookWithOutputs();
            renderNotebook(state);
            await settle();
            expect(clearButton()).toBeEnabled();

            fireEvent.click(clearButton());
            expect(screen.getByRole('dialog', {name: clearLabel})).toBeInTheDocument();
            expect(setNotebookState).not.toHaveBeenCalled();
            expect(savedCell('ok').result).toEqual(queryResult);

            fireEvent.click(screen.getByRole('button', {name: `Confirm ${clearLabel}`}));

            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            expect(setNotebookState).toHaveBeenCalledTimes(1);
            const saved = fixtures.notebooks.get(notebookId);
            expect(saved?.cells.map((cell) => cell.id)).toEqual(['ok', 'notes', 'failed']);
            expect(savedCell('ok')).toEqual({
                ...state.cells[0],
                result: null,
                error: undefined,
                executionTime: null,
            });
            expect(savedCell('failed')).toEqual({
                ...state.cells[2],
                result: null,
                error: undefined,
                executionTime: null,
            });
            expect(savedCell('ok').history).toEqual([historyEntry]);
            expect(savedCell('failed').history).toEqual([failedEntry]);
            expect(savedCell('ok').chartConfig).toEqual(chartConfig);
            expect(savedCell('notes')).toEqual(state.cells[1]);
            expect(saved?.params).toEqual(params);
            expect(saved?.stopOnError).toBe(true);
            // Only live output is dropped: no database call, and nothing left to clear.
            expect(mockInvoke).not.toHaveBeenCalled();
            expect(fixtures.guardQuery).not.toHaveBeenCalled();
            expect(clearButton()).toBeDisabled();
            // It is not an undo step.
            expect(screen.getByRole('button', {name: 'Undo'})).toBeDisabled();
        });

        it('keeps every output when the confirmation is cancelled', async () => {
            renderNotebook(notebookWithOutputs());
            await settle();

            fireEvent.click(clearButton());
            fireEvent.click(screen.getByRole('button', {name: `Cancel ${clearLabel}`}));

            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            expect(setNotebookState).not.toHaveBeenCalled();
            expect(savedCell('ok').result).toEqual(queryResult);
            expect(savedCell('failed').error).toBe('syntax error');
            expect(clearButton()).toBeEnabled();
        });

        it('hides the Run All summary and keeps the execution history of the run', async () => {
            mockInvoke.mockResolvedValue(queryResult);
            renderNotebook({cells: [sqlCell('only', 'SELECT 1')]});
            await settle();
            await act(async () => {
                fireEvent.click(screen.getByRole('button', {name: 'Run All'}));
            });
            expect(screen.getByTestId('run-all-summary')).toHaveTextContent('1');
            expect(savedCell('only').result).toEqual(queryResult);

            fireEvent.click(clearButton());
            fireEvent.click(screen.getByRole('button', {name: `Confirm ${clearLabel}`}));

            expect(screen.queryByTestId('run-all-summary')).not.toBeInTheDocument();
            expect(savedCell('only').result).toBeNull();
            expect(savedCell('only').executionTime).toBeNull();
            expect(savedCell('only').history).toHaveLength(1);
            // The run itself was the only query: clearing issued none.
            expect(mockInvoke).toHaveBeenCalledTimes(1);
        });

        it.each([
            {name: 'Run All', trigger: 'Run All'},
            {name: 'a single cell run', trigger: 'Run only'},
        ])('is disabled while $name is executing', async ({trigger}) => {
            const finish = deferredQuery();
            renderNotebook({
                cells: [sqlCell('only', 'SELECT 1', {result: queryResult, executionTime: 5})],
            });
            await settle();
            expect(clearButton()).toBeEnabled();

            await act(async () => {
                fireEvent.click(screen.getByRole('button', {name: trigger}));
            });
            await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(1));
            expect(clearButton()).toBeDisabled();

            await act(async () => {
                finish(queryResult);
            });
            await waitFor(() => expect(clearButton()).toBeEnabled());
        });

        it('does not clear when a run starts while the confirmation is open', async () => {
            const finish = deferredQuery();
            renderNotebook({
                cells: [sqlCell('only', 'SELECT 1', {result: queryResult, executionTime: 5})],
            });
            await settle();

            fireEvent.click(clearButton());
            await act(async () => {
                fireEvent.click(screen.getByRole('button', {name: 'Run All'}));
            });
            await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(1));
            fireEvent.click(screen.getByRole('button', {name: `Confirm ${clearLabel}`}));

            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            expect(savedCell('only')).toMatchObject({isLoading: true, executionTime: 5});

            await act(async () => {
                finish(queryResult);
            });
            await waitFor(() => expect(savedCell('only').result).toEqual(queryResult));
        });

        it.each([
            {name: 'an empty notebook', cells: [] as NotebookCell[]},
            {
                name: 'cells that never ran',
                cells: [
                    sqlCell('idle', 'SELECT 1'),
                    {id: 'notes', type: 'markdown' as const, content: '# Notes'},
                ],
            },
        ])('is disabled for $name', async ({cells}) => {
            renderNotebook({cells});
            await settle();

            expect(clearButton()).toBeDisabled();
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        });
    });

    describe('Duplicate to end', () => {
        const historyEntry = {
            query: 'SELECT 1',
            result: queryResult,
            executionTime: 3,
            timestamp: 1,
        };
        const chartConfig = {type: 'bar' as const, labelColumn: 'id', valueColumns: ['id']};

        function notebookToDuplicate(): NotebookState {
            return {
                params,
                stopOnError: true,
                cells: [
                    sqlCell('base', 'SELECT 1 AS id', {result: queryResult, executionTime: 2}),
                    sqlCell('second', 'SELECT * FROM {{cell_1}}', {
                        name: 'Second',
                        schema: 'cell_schema',
                        result: queryResult,
                        error: undefined,
                        executionTime: 12,
                        history: [historyEntry],
                        chartConfig,
                        isQueryPlanVisible: true,
                    }),
                    {
                        id: 'notes',
                        type: 'markdown',
                        content: '# Notes on {{cell_2}}',
                        isPreview: true,
                        isCollapsed: true,
                    },
                ],
            };
        }

        const ids = () => fixtures.notebooks.get(notebookId)?.cells.map((cell) => cell.id) ?? [];
        const lastCell = () => {
            const cells = fixtures.notebooks.get(notebookId)?.cells ?? [];
            return cells[cells.length - 1];
        };
        const duplicateButton = (id: string) =>
            screen.getByRole('button', {name: `Duplicate ${id}`});

        it('appends a document-only copy of the second SQL cell without running it', async () => {
            const state = notebookToDuplicate();
            renderNotebook(state);
            await settle();

            fireEvent.click(duplicateButton('second'));
            await settle();

            expect(setNotebookState).toHaveBeenCalledTimes(1);
            const saved = fixtures.notebooks.get(notebookId);
            expect(saved?.cells).toHaveLength(4);
            // Existing cells keep their objects and positions.
            expect(saved?.cells.slice(0, 3)).toEqual(state.cells);
            const copy = lastCell();
            expect(state.cells.map((cell) => cell.id)).not.toContain(copy.id);
            expect(copy).toEqual({
                ...state.cells[1],
                id: copy.id,
                result: null,
                error: undefined,
                executionTime: null,
                isLoading: false,
                history: undefined,
                isCollapsed: false,
                isQueryPlanVisible: false,
            });
            expect(copy.content).toBe('SELECT * FROM {{cell_1}}');
            // The original keeps its open plan; the copy starts closed, so no plan is prepared for it.
            expect(savedCell('second').isQueryPlanVisible).toBe(true);
            expect(explainFor(copy.id)).toBeNull();
            expect(copy.chartConfig).toEqual(chartConfig);
            expect(copy.chartConfig).not.toBe(state.cells[1].chartConfig);
            expect(saved?.params).toEqual(params);
            expect(saved?.stopOnError).toBe(true);
            // The copy is rendered last, and nothing was executed.
            const sections = screen.getAllByRole('textbox');
            expect(sections[sections.length - 1]).toHaveAccessibleName(`SQL ${copy.id}`);
            expect(mockInvoke).not.toHaveBeenCalled();
            expect(fixtures.guardQuery).not.toHaveBeenCalled();
            expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
        });

        it('starts a Markdown copy expanded and in edit mode', async () => {
            const state = notebookToDuplicate();
            renderNotebook(state);
            await settle();

            fireEvent.click(duplicateButton('notes'));
            await settle();

            expect(ids().slice(0, 3)).toEqual(['base', 'second', 'notes']);
            expect(lastCell()).toEqual({
                ...state.cells[2],
                id: lastCell().id,
                result: null,
                error: undefined,
                executionTime: null,
                isLoading: false,
                history: undefined,
                isPreview: false,
                isCollapsed: false,
                isQueryPlanVisible: false,
            });
            expect(savedCell('notes')).toEqual(state.cells[2]);
        });

        it('keeps the copy independent from later edits to the original', async () => {
            renderNotebook(notebookToDuplicate());
            await settle();

            fireEvent.click(duplicateButton('second'));
            const copyId = lastCell().id;
            fireEvent.change(screen.getByRole('textbox', {name: 'SQL second'}), {
                target: {value: 'SELECT 2'},
            });

            expect(savedCell('second').content).toBe('SELECT 2');
            expect(savedCell(copyId).content).toBe('SELECT * FROM {{cell_1}}');
        });

        it('is one undoable step that redo restores', async () => {
            renderNotebook(notebookToDuplicate());
            await settle();
            const undo = screen.getByRole('button', {name: 'Undo'});
            const redo = screen.getByRole('button', {name: 'Redo'});
            expect(undo).toBeDisabled();

            fireEvent.click(duplicateButton('second'));
            const copyId = lastCell().id;
            expect(ids()).toEqual(['base', 'second', 'notes', copyId]);
            expect(undo).toBeEnabled();

            fireEvent.click(undo);
            expect(ids()).toEqual(['base', 'second', 'notes']);
            expect(undo).toBeDisabled();
            expect(redo).toBeEnabled();

            fireEvent.click(redo);
            expect(ids()).toEqual(['base', 'second', 'notes', copyId]);
            expect(savedCell(copyId).content).toBe('SELECT * FROM {{cell_1}}');
            expect(redo).toBeDisabled();
            expect(mockInvoke).not.toHaveBeenCalled();
        });

        it.each([
            {name: 'Run All', trigger: 'Run All'},
            {name: 'a single cell run', trigger: 'Run base'},
        ])('is disabled while $name is executing', async ({trigger}) => {
            let finish: (value: QueryResult) => void = () => {};
            mockInvoke.mockReturnValueOnce(
                new Promise<QueryResult>((resolve) => {
                    finish = resolve;
                }),
            );
            renderNotebook({cells: [sqlCell('base', 'SELECT 1')]});
            await settle();
            expect(duplicateButton('base')).toBeEnabled();

            await act(async () => {
                fireEvent.click(screen.getByRole('button', {name: trigger}));
            });
            await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(1));
            expect(duplicateButton('base')).toBeDisabled();
            fireEvent.click(duplicateButton('base'));
            expect(ids()).toEqual(['base']);

            await act(async () => {
                finish(queryResult);
            });
            await waitFor(() => expect(duplicateButton('base')).toBeEnabled());
        });
    });
    describe('Export Markdown', () => {
        const exportButton = () => screen.getByRole('button', {name: 'Export Markdown'});

        function notebookWithRuntimeData(): NotebookState {
            return {
                params: [{name: 'region', value: 'secret-param-value'}],
                stopOnError: true,
                cells: [
                    {id: 'intro', type: 'markdown', content: '# Intro', isPreview: true},
                    sqlCell('q', 'SELECT * FROM t WHERE r = @region', {
                        schema: 'secret_schema',
                        isCollapsed: true,
                        result: {columns: ['v'], rows: [['result-value-42']], affected_rows: 0},
                        error: 'error-text',
                        chartConfig: {type: 'bar', labelColumn: 'v', valueColumns: ['v']},
                        history: [
                            {
                                query: 'SELECT history_query',
                                result: null,
                                executionTime: 1,
                                timestamp: 1,
                            },
                        ],
                    }),
                    {id: 'blank', type: 'markdown', content: '   '},
                ],
            };
        }

        async function clickExport() {
            await act(async () => {
                fireEvent.click(exportButton());
            });
            await settle();
        }

        it('writes the in-memory source, including collapsed cells, without running or saving anything', async () => {
            mockSave.mockResolvedValueOnce('/tmp/Notebook.md');
            mockWriteFile.mockResolvedValueOnce(undefined);
            const state = notebookWithRuntimeData();
            renderNotebook(state);
            await settle();
            fireEvent.change(screen.getByLabelText('SQL q'), {
                target: {value: 'SELECT * FROM t WHERE r = @region -- edited'},
            });
            vi.mocked(setNotebookState).mockClear();
            const before = fixtures.notebooks.get(notebookId);

            await clickExport();

            await waitFor(() => expect(mockWriteFile).toHaveBeenCalledOnce());
            expect(mockSave).toHaveBeenCalledWith(
                expect.objectContaining({
                    defaultPath: 'Notebook.md',
                    filters: [{name: 'Markdown', extensions: ['md']}],
                }),
            );
            const [path, contents] = mockWriteFile.mock.calls[0];
            expect(path).toBe('/tmp/Notebook.md');
            expect(new TextDecoder().decode(contents as Uint8Array)).toBe(
                '# Intro\n\n```sql\nSELECT * FROM t WHERE r = @region -- edited\n```\n',
            );
            expect(fixtures.showAlert).toHaveBeenCalledWith('editor.notebook.exportSuccess', {
                kind: 'info',
            });
            expect(mockInvoke).not.toHaveBeenCalled();
            expect(setNotebookState).not.toHaveBeenCalled();
            expect(fixtures.notebooks.get(notebookId)).toBe(before);
        });

        it('shows a message and opens no save dialog when there is no source', async () => {
            renderNotebook({
                cells: [sqlCell('empty', ''), {id: 'md', type: 'markdown', content: ' \n '}],
            });
            await settle();

            await clickExport();

            expect(fixtures.showAlert).toHaveBeenCalledWith('editor.notebook.exportMarkdownEmpty', {
                kind: 'info',
            });
            expect(mockSave).not.toHaveBeenCalled();
            expect(mockWriteFile).not.toHaveBeenCalled();
        });

        it('does nothing when the save dialog is cancelled', async () => {
            mockSave.mockResolvedValueOnce(null);
            renderNotebook(notebookWithRuntimeData());
            await settle();
            vi.mocked(setNotebookState).mockClear();

            await clickExport();

            await waitFor(() => expect(mockSave).toHaveBeenCalledOnce());
            expect(mockWriteFile).not.toHaveBeenCalled();
            expect(fixtures.showAlert).not.toHaveBeenCalled();
            expect(setNotebookState).not.toHaveBeenCalled();
        });

        it('reports a failed write', async () => {
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
            mockSave.mockResolvedValueOnce('/tmp/Notebook.md');
            mockWriteFile.mockRejectedValueOnce(new Error('disk full'));
            renderNotebook(notebookWithRuntimeData());
            await settle();

            await clickExport();

            await waitFor(() =>
                expect(fixtures.showAlert).toHaveBeenCalledWith('editor.notebook.exportError', {
                    kind: 'error',
                }),
            );
            expect(consoleError).toHaveBeenCalled();
            consoleError.mockRestore();
        });
    });
});
