import {useContext, type ComponentProps} from 'react';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {invoke} from '@tauri-apps/api/core';
import {open, save} from '@tauri-apps/plugin-dialog';
import {readFile, writeFile} from '@tauri-apps/plugin-fs';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {NotebookView} from '@/components/notebook/NotebookView';
import type {NotebookCellWrapper} from '@/components/notebook/NotebookCellWrapper';
import type {NotebookToolbar} from '@/components/notebook/NotebookToolbar';
import type {RunAllSummary} from '@/components/notebook/RunAllSummary';
import {useDangerousQueryGuard} from '@/hooks/useDangerousQueryGuard';
import {useQueryGuards} from '@/hooks/useQueryGuards';
import type {QueryResult, Tab} from '@/types/editor';
import type {NotebookCell, NotebookState, RunAllResult} from '@/types/notebook';
import {registerPendingEditorFlush} from '@/utils/pendingEditorChanges';
import {resolveParams} from '@/utils/notebookParams';
import {resolveQueryVariables, type ResolvedQuery} from '@/utils/notebookVariables';
import {
    _resetForTesting,
    evictFromCache,
    getNotebookState,
    loadNotebook,
    setNotebookState,
} from '@/utils/notebookStore';
import type {DriverCapabilities} from '@/types/plugins';
import type {SavedConnection} from '@/contexts/DatabaseContext';
import {tauriBackedClient} from '../../support/tauriBackedHooks';
import {ProductionGuardProvider} from '@/contexts/ProductionGuardContext';
import {ProductionGuardContext, snoozedConnectionIds} from '@/hooks/useProductionGuard';

vi.mock('@/hooks/useTabularisClient', () => import('../../support/tauriBackedHooks'));
vi.mock('@/hooks/usePlatformCapabilities', () => import('../../support/tauriBackedHooks'));
const fixtures = vi.hoisted(() => ({
    database: {
        activeDriver: 'postgres',
        activeSchema: 'active_schema' as string | null,
        activeCapabilities: null as Partial<DriverCapabilities> | null,
        selectedDatabases: [] as string[],
        connections: [] as SavedConnection[],
    },
    settings: {resultPageSize: 37, safetyConfirmationDelayEnabled: false},
    guardQuery: vi.fn(),
    resolveGuard: vi.fn(),
    matchesShortcut: vi.fn(),
    showAlert: vi.fn(),
    mounts: new Map<string, number>(),
}));

vi.mock('react-i18next', () => {
    // Stable, like the real hook: NotebookView's callbacks depend on it.
    const t = (
        key: string,
        options?: {path?: string; cell?: string; reference?: string; number?: number},
    ) =>
        [key, options?.number, options?.path, options?.cell, options?.reference]
            .filter((item) => item !== undefined)
            .join(' ');
    return {useTranslation: () => ({t})};
});
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
    useQueryGuards: vi.fn(() => ({
        pending: null,
        isPending: false,
        guardQuery: fixtures.guardQuery,
        resolve: fixtures.resolveGuard,
    })),
}));
vi.mock('@/hooks/useSqlAutocompleteRegistration', () => ({
    useSqlAutocompleteRegistration: vi.fn(),
}));
vi.mock('@/utils/notebookStore', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/utils/notebookStore')>();
    return {
        ...actual,
        setNotebookState: vi.fn(actual.setNotebookState),
        loadNotebook: vi.fn(),
        setNotebookTitle: vi.fn(),
    };
});
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
vi.mock('@/components/ui/SqlPreview', () => ({
    SqlPreview: ({sql}: {sql: string}) => <pre>{sql}</pre>,
}));
vi.mock('@/components/notebook/NotebookHistoryPanel', () => ({
    NotebookHistoryPanel: () => null,
}));
vi.mock('@/components/notebook/AddCellButton', () => ({AddCellButton: () => null}));
vi.mock('@/components/notebook/RunAllSummary', () => ({
    RunAllSummary: ({result}: ComponentProps<typeof RunAllSummary>) => (
        <output data-testid="run-all-summary" data-result={JSON.stringify(result)}>
            {result.total}
        </output>
    ),
}));
vi.mock('@/components/notebook/ParamsPanel', () => ({ParamsPanel: () => null}));
vi.mock('@/components/notebook/NotebookOutline', () => ({NotebookOutline: () => null}));
vi.mock('@/components/ui/DataGrid', () => ({
    DataGrid: ({columns, data}: {columns: string[]; data: unknown[][]}) => (
        <div data-testid="report-grid" data-rows={data.length}>
            {columns.join(',')}
        </div>
    ),
}));
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
        viewMode,
        onViewModeChange,
        onExportMarkdown,
        onToggleStopOnError,
        onImport,
    }: ComponentProps<typeof NotebookToolbar>) => (
        <>
            <button onClick={onImport}>Import</button>
            <button onClick={onToggleStopOnError}>Stop on error</button>
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
            {onViewModeChange && (
                <>
                    <button
                        onClick={() => onViewModeChange('edit')}
                        aria-pressed={viewMode === 'edit'}
                    >
                        Edit mode
                    </button>
                    <button
                        onClick={() => onViewModeChange('report')}
                        aria-pressed={viewMode === 'report'}
                    >
                        Report mode
                    </button>
                </>
            )}
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
            onRunAffected,
            isRunBusy,
            onUpdate,
            onDelete,
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
                    data-disabled={!!cell.isDisabled}
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
                    <button onClick={onRunAffected} disabled={isRunBusy}>
                        Run affected {cell.id}
                    </button>
                    <button onClick={onDelete}>Delete {cell.id}</button>
                    <button onClick={() => onUpdate({isDisabled: !cell.isDisabled})}>
                        Toggle disabled {cell.id}
                    </button>
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

function useDangerousQueryGuardForTest() {
    return useDangerousQueryGuard();
}

function sqlCell(id: string, content: string, partial: Partial<NotebookCell> = {}): NotebookCell {
    return {id, type: 'sql', content, ...partial};
}

function renderNotebook(state?: NotebookState, tabOverrides: Partial<Tab> = {}) {
    if (state) {
        setNotebookState(notebookId, state);
        vi.mocked(setNotebookState).mockClear();
    }
    return render(notebookView(tabOverrides));
}

function notebookView(
    tabOverrides: Partial<Tab> = {},
    updateTab: (id: string, partial: Partial<Tab>) => void = vi.fn(),
) {
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
    return (
        <NotebookView
            tab={tab}
            updateTab={updateTab}
            connectionId={tab.connectionId ?? connectionId}
            isActive
        />
    );
}

const mysqlLayout: Partial<DriverCapabilities> = {
    sql_dialect: 'mysql',
    identifier_quote: '`',
    schemas: false,
    file_based: false,
};

function requestSql(query: string, schema = 'tab_schema', limit = 37, connection = connectionId) {
    return ['execute_query', {connectionId: connection, schema, query, limit, page: 1}];
}

function explainFor(id: string): ResolvedQuery | null {
    return JSON.parse(
        screen.getByTestId(`explain-${id}`).textContent ?? 'null',
    ) as ResolvedQuery | null;
}

function savedCell(id: string): NotebookCell {
    const cell = getNotebookState(notebookId)?.cells.find((entry) => entry.id === id);
    if (!cell) throw new Error(`Missing test cell ${id}`);
    return cell;
}

async function settle() {
    await act(async () => {
        await Promise.resolve();
    });
}

function summary(): RunAllResult {
    return JSON.parse(screen.getByTestId('run-all-summary').getAttribute('data-result') ?? 'null');
}

async function click(name: string) {
    await act(async () => {
        fireEvent.click(screen.getByRole('button', {name}));
    });
}

describe('NotebookView', () => {
    afterEach(_resetForTesting);

    beforeEach(() => {
        vi.clearAllMocks();
        fixtures.mounts.clear();
        fixtures.database.activeDriver = 'postgres';
        fixtures.database.activeCapabilities = null;
        fixtures.database.activeSchema = 'active_schema';
        fixtures.database.selectedDatabases = [];
        fixtures.database.connections = [];
        snoozedConnectionIds.clear();
        fixtures.settings.resultPageSize = 37;
        fixtures.guardQuery.mockReset().mockResolvedValue(true);
        fixtures.matchesShortcut.mockReset().mockReturnValue(false);
        mockInvoke.mockReset().mockResolvedValue(queryResult);
    });

    it('cannot save an empty document from the toolbar while the disk read is pending', async () => {
        const store =
            await vi.importActual<typeof import('@/utils/notebookStore')>('@/utils/notebookStore');
        const disk = Promise.withResolvers<string>();
        vi.mocked(loadNotebook).mockImplementationOnce(store.loadNotebook);
        mockInvoke.mockReturnValueOnce(disk.promise);
        renderNotebook();

        const toggle = screen.queryByRole('button', {name: 'Stop on error'});
        if (toggle) fireEvent.click(toggle);
        await act(async () =>
            disk.resolve(
                JSON.stringify({
                    version: 2,
                    title: 'Saved',
                    cells: [sqlCell('stored', 'SELECT 42')],
                }),
            ),
        );
        await click('Stop on error');
        await store.flushAllPendingSaves();
        const save = mockInvoke.mock.calls.find(([command]) => command === 'save_notebook');
        expect(JSON.parse(String(save?.[1]?.content))).toMatchObject({
            cells: [{id: 'stored', content: 'SELECT 42'}],
            stopOnError: true,
        });
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

            expect(mockResolveParams).toHaveBeenCalledWith(
                rawQuery.trim(),
                params,
                expect.anything(),
            );
            expect(mockResolveVariables).toHaveBeenCalledWith(parameterSql, state.cells, {
                dialect: expect.anything(),
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
            expect(getNotebookState(notebookId)?.cells.map((cell) => cell.id)).toEqual([
                'second',
                'first',
            ]);
            expect(fixtures.mounts.get('first')).toBe(1);
            expect(fixtures.mounts.get('second')).toBe(1);
        });
    });

    describe('Run Cell', () => {
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
                    dialect: expect.anything(),
                    escapeBackslashes,
                    identifierQuote,
                });
                expect(mockInvoke).not.toHaveBeenCalled();

                mockInvoke.mockResolvedValueOnce(sourceResult);
                await click('Run source');
                await click('Run target');

                expect(mockInvoke.mock.calls).toEqual([
                    requestSql('SELECT id, label FROM people'),
                    requestSql(expectedSql, 'cell_schema'),
                ]);
                expect(fixtures.guardQuery.mock.calls).toEqual([
                    ['SELECT id, label FROM people', expect.any(AbortSignal)],
                    [expectedSql, expect.any(AbortSignal)],
                ]);
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
                expect(savedCell('source').history).toHaveLength(1);
                expect(screen.getByTestId('cell-target')).toHaveAttribute('data-loading', 'false');
                expect(explainFor('target')).toEqual(prepared);
                // The exact calls also exclude EXPLAIN and duplicate prerequisite execution.
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

    describe('shared execution plans', () => {
        it.each(['mariadb', 'unidentified-driver'] as const)(
            'does not dispatch an unrelated cell marked only by a hash comment on %s',
            async (driver) => {
                fixtures.database.activeDriver = driver;
                fixtures.database.activeCapabilities = {identifier_quote: '`'};
                const source = 'SELECT 1';
                renderNotebook({
                    cells: [
                        sqlCell('source', source),
                        sqlCell('unrelated', 'SELECT NEXT VALUE FOR audit_seq AS n # {{cell_1}}'),
                        sqlCell('consumer', 'SELECT * FROM {{cell_1}}'),
                    ],
                });
                const quote = '`';
                const consumer = `WITH cell_1 AS (\n  SELECT 7 AS ${quote}id${quote}\n  UNION ALL\n  SELECT 8 AS ${quote}id${quote}\n)\nSELECT * FROM cell_1`;
                await click('Run affected source');
                expect(mockInvoke.mock.calls).toEqual([requestSql(source), requestSql(consumer)]);
                expect(fixtures.guardQuery.mock.calls).toEqual([
                    [source, expect.any(AbortSignal)],
                    [consumer, expect.any(AbortSignal)],
                ]);
            },
        );

        it.each(["'''don't bind {{cell_1}}'''", '"""a "quoted {{cell_1}}" value"""'])(
            'keeps an ambiguous triple-quoted literal out of affected runs without a dialect: %s',
            async (literal) => {
                fixtures.database.activeDriver = 'unidentified-driver';
                fixtures.database.activeCapabilities = {identifier_quote: '`'};
                const sql = `SELECT ${literal} AS note`;
                renderNotebook({
                    cells: [
                        sqlCell('source', 'SELECT 1'),
                        sqlCell('literal', sql),
                        sqlCell('consumer', 'SELECT * FROM {{cell_1}}'),
                    ],
                });
                await click('Run affected source');
                expect(mockInvoke.mock.calls).toEqual([
                    requestSql('SELECT 1'),
                    requestSql(expect.stringMatching(/SELECT \* FROM cell_1$/)),
                ]);
                mockInvoke.mockClear();
                await click('Run literal');
                expect(mockInvoke.mock.calls).toEqual([requestSql(sql)]);
            },
        );

        it('uses a declared dialect instead of the legacy fallback to parse real edges', async () => {
            fixtures.database.activeDriver = 'mariadb';
            fixtures.database.activeCapabilities = {sql_dialect: 'postgres', identifier_quote: '"'};
            renderNotebook({
                cells: [
                    sqlCell('source', 'SELECT 1'),
                    sqlCell('use', 'SELECT 3 # id FROM {{cell_1}}'),
                ],
            });
            await click('Run affected source');
            expect(mockInvoke.mock.calls).toEqual([
                requestSql('SELECT 1'),
                requestSql(
                    'WITH cell_1 AS (\n  SELECT 7 AS "id"\n  UNION ALL\n  SELECT 8 AS "id"\n)\nSELECT 3 # id FROM cell_1',
                ),
            ]);
        });

        it('ignores comment-only consumers and keeps reference-like literals unchanged on dispatch', async () => {
            const literal = "SELECT '{{cell_1}}'";
            const line = 'SELECT 1 -- {{cell_8}}';
            const block = 'SELECT 2 /* {{cell_1}} */';
            renderNotebook({
                cells: [
                    sqlCell('literal', literal),
                    sqlCell('line', line),
                    sqlCell('block', block, {schema: 'other_schema'}),
                ],
            });
            await click('Run affected literal');
            expect(mockInvoke.mock.calls).toEqual([requestSql(literal)]);
            await click('Run line');
            await click('Run block');
            expect(mockInvoke.mock.calls).toEqual([
                requestSql(literal),
                requestSql(line),
                requestSql(block, 'other_schema'),
            ]);
            expect(fixtures.guardQuery.mock.calls).toEqual(
                [literal, line, block].map((sql) => [sql, expect.any(AbortSignal)]),
            );
        });

        it('refreshes a migrated output with no execution provenance before consuming it', async () => {
            renderNotebook({
                cells: [
                    sqlCell('old', 'SELECT 999 AS id', {
                        result: sourceResult,
                        schema: 'source_schema',
                    }),
                    sqlCell('use', 'SELECT * FROM {{cell_1}}', {schema: 'consumer_schema'}),
                ],
            });
            mockInvoke.mockResolvedValueOnce({columns: ['id'], rows: [[999]], affected_rows: 0});
            await click('Run use');
            expect(mockInvoke.mock.calls).toEqual([
                requestSql('SELECT 999 AS id', 'source_schema'),
                requestSql(
                    'WITH cell_1 AS (\n  SELECT 999 AS "id"\n)\nSELECT * FROM cell_1',
                    'consumer_schema',
                ),
            ]);
        });

        it('refetches the full prerequisite page when the effective row limit changes', async () => {
            const source = 'SELECT id FROM people';
            const consume = 'SELECT COUNT(*) AS n FROM {{cell_1}}';
            const rows = Array.from({length: 412}, (_, index) => [index + 1]);
            const cte = `WITH cell_1 AS (\n  ${rows.map(([id]) => `SELECT ${id} AS "id"`).join('\n  UNION ALL\n  ')}\n)\nSELECT COUNT(*) AS n FROM cell_1`;
            mockInvoke.mockImplementation(async (_command, request) => {
                if (request?.query === source) {
                    return {
                        columns: ['id'],
                        rows: rows.slice(0, Number(request.limit)),
                        affected_rows: 0,
                    };
                }
                return {
                    columns: ['n'],
                    rows: [[String(request?.query).match(/SELECT \d+ AS "id"/g)?.length ?? 0]],
                    affected_rows: 0,
                };
            });
            const view = renderNotebook({
                cells: [
                    sqlCell('source', source, {schema: 'source_schema'}),
                    sqlCell('use', consume),
                ],
            });
            await click('Run source');
            expect(savedCell('source').result?.rows).toHaveLength(37);
            fixtures.settings.resultPageSize = 500;
            view.rerender(notebookView());
            await click('Run use');
            expect(mockInvoke.mock.calls).toEqual([
                requestSql(source, 'source_schema', 37),
                requestSql(source, 'source_schema', 500),
                requestSql(cte, 'tab_schema', 500),
            ]);
            expect(savedCell('use').result?.rows).toEqual([[412]]);
        });

        it('runs the affected branch and a missing input without touching a cached input or unrelated SQL', async () => {
            renderNotebook({
                cells: [
                    sqlCell('source', 'SELECT 101', {result: sourceResult}),
                    sqlCell('branch', 'SELECT * FROM {{cell_1}} JOIN {{cell_4}} ON 1=1'),
                    sqlCell('downstream', 'SELECT * FROM {{cell_2}} JOIN {{cell_5}} ON 1=1'),
                    sqlCell('missing', 'SELECT 404'),
                    sqlCell('cached', 'SELECT 505'),
                    sqlCell('unrelated', 'SELECT 606'),
                ],
            });
            await click('Run cached');
            expect(mockInvoke.mock.calls).toEqual([requestSql('SELECT 505')]);
            mockInvoke.mockClear();
            await click('Run affected source');
            expect(mockInvoke.mock.calls.map(([, args]) => args?.query)).toEqual([
                'SELECT 101',
                'SELECT 404',
                expect.stringContaining('SELECT * FROM cell_1 JOIN cell_4 ON 1=1'),
                expect.stringContaining('SELECT * FROM cell_2 JOIN cell_5 ON 1=1'),
            ]);
            expect(summary()).toMatchObject({
                mode: 'affected',
                total: 4,
                succeeded: 4,
                executed: 4,
            });
            expect(savedCell('cached').history).toHaveLength(1);
            expect(savedCell('unrelated').result).toBeUndefined();
        });

        it('refreshes a cached prerequisite for a different connection or fallback schema', async () => {
            const source = 'SELECT 7 AS id';
            const consume = 'WITH cell_1 AS (\n  SELECT 7 AS "id"\n)\nSELECT * FROM cell_1';
            mockInvoke.mockResolvedValue({columns: ['id'], rows: [[7]], affected_rows: 0});
            const view = renderNotebook({
                cells: [sqlCell('source', source), sqlCell('use', 'SELECT * FROM {{cell_1}}')],
            });
            await click('Run source');
            view.rerender(notebookView({connectionId: 'new-connection'}));
            await click('Run use');
            view.rerender(notebookView({connectionId: 'new-connection', schema: 'new_schema'}));
            await click('Run use');
            expect(mockInvoke.mock.calls).toEqual([
                requestSql(source),
                requestSql(source, 'tab_schema', 37, 'new-connection'),
                requestSql(consume, 'tab_schema', 37, 'new-connection'),
                requestSql(source, 'new_schema', 37, 'new-connection'),
                requestSql(consume, 'new_schema', 37, 'new-connection'),
            ]);
        });

        it('blocks a consumer when a positional reference moves during its guard', async () => {
            const source = 'SELECT 7 AS id';
            const consume = 'WITH cell_1 AS (\n  SELECT 7 AS "id"\n)\nSELECT * FROM cell_1';
            mockInvoke.mockResolvedValueOnce({columns: ['id'], rows: [[7]], affected_rows: 0});
            renderNotebook({
                cells: [
                    sqlCell('source', source),
                    sqlCell('other', 'SELECT 99 AS id'),
                    sqlCell('use', 'SELECT * FROM {{cell_1}}'),
                ],
            });
            await click('Run source');
            const pending = Promise.withResolvers<boolean>();
            fixtures.guardQuery.mockReturnValueOnce(pending.promise);
            await click('Run use');
            expect(fixtures.guardQuery).toHaveBeenLastCalledWith(consume, expect.any(AbortSignal));
            await click('Move down source');
            await act(async () => pending.resolve(true));
            expect(mockInvoke.mock.calls).toEqual([requestSql(source)]);
            expect(summary()).toMatchObject({
                executed: 0,
                blockedCells: [{cellId: 'use', prerequisite: {cellId: 'source'}}],
            });
        });

        it('refreshes a previously run prerequisite whose SQL was edited', async () => {
            renderNotebook({
                cells: [
                    sqlCell('source', 'SELECT 101'),
                    sqlCell('lookup', 'SELECT 202'),
                    sqlCell('use', 'SELECT * FROM {{cell_1}} JOIN {{cell_2}} ON 1=1'),
                ],
            });
            await click('Run lookup');
            fireEvent.change(screen.getByRole('textbox', {name: 'SQL lookup'}), {
                target: {value: 'SELECT 222'},
            });
            await click('Run affected source');
            expect(mockInvoke.mock.calls.map(([, args]) => args?.query)).toEqual([
                'SELECT 202',
                'SELECT 101',
                'SELECT 222',
                expect.stringContaining('SELECT * FROM cell_1 JOIN cell_2 ON 1=1'),
            ]);
        });

        it.each([
            [
                'self',
                ['SELECT * FROM {{cell_2}}'],
                'editor.notebook.execution.self editor.notebook.execution.cell 2',
            ],
            [
                'cycle',
                ['SELECT * FROM {{cell_3}}', 'SELECT * FROM {{cell_2}}'],
                'editor.notebook.execution.cycle editor.notebook.execution.cell 2 → editor.notebook.execution.cell 3 → editor.notebook.execution.cell 2',
            ],
            [
                'missing',
                ['SELECT * FROM {{cell_9}}'],
                'editor.notebook.execution.missing editor.notebook.execution.cell 2 {{cell_9}}',
            ],
            [
                'Markdown target',
                ['SELECT * FROM {{cell_3}}'],
                'editor.notebook.execution.missing editor.notebook.execution.cell 2 {{cell_3}}',
            ],
        ])(
            'aborts the whole Run All with a %s diagnostic before guarding or sending any SQL',
            async (_name, sources, diagnostic) => {
                renderNotebook({
                    cells: [
                        sqlCell('independent', 'SELECT 1'),
                        ...sources.map((content, i) =>
                            sqlCell(`sql-${i}`, content, {result: sourceResult}),
                        ),
                        {id: 'notes', type: 'markdown', content: '# Not a query'},
                    ],
                });
                await click('Run All');
                expect(mockInvoke).not.toHaveBeenCalled();
                expect(fixtures.guardQuery).not.toHaveBeenCalled();
                expect(summary().preflightErrors).toEqual([diagnostic]);
            },
        );

        it('reports a downstream cycle on Run affected before attempting the source query', async () => {
            renderNotebook({
                cells: [
                    sqlCell('source', 'SELECT 1'),
                    sqlCell('first', 'SELECT * FROM {{cell_1}} JOIN {{cell_3}} ON 1=1'),
                    sqlCell('second', 'SELECT * FROM {{cell_2}}'),
                ],
            });
            await click('Run affected source');
            expect(fixtures.guardQuery).not.toHaveBeenCalled();
            expect(mockInvoke).not.toHaveBeenCalled();
            expect(summary().preflightErrors[0]).toContain('editor.notebook.execution.cycle');
        });

        it('blocks the entire downstream branch when a prerequisite with cached output is denied', async () => {
            fixtures.guardQuery.mockResolvedValueOnce(false);
            renderNotebook({
                cells: [
                    sqlCell('source', 'DELETE FROM t', {result: sourceResult}),
                    sqlCell('first', 'SELECT * FROM {{cell_1}}', {result: sourceResult}),
                    sqlCell('second', 'SELECT * FROM {{cell_2}}'),
                ],
            });
            await click('Run affected source');
            expect(fixtures.guardQuery).toHaveBeenCalledExactlyOnceWith(
                'DELETE FROM t',
                expect.any(AbortSignal),
            );
            expect(mockInvoke).not.toHaveBeenCalled();
            expect(savedCell('source').result).toEqual(sourceResult);
            expect(summary()).toMatchObject({
                total: 3,
                failed: 1,
                blocked: 2,
                executed: 0,
                errors: [{cellId: 'source', error: 'editor.notebook.execution.guardDenied'}],
            });
        });

        it('locks across entry points during confirmation and while a SQL call is in flight', async () => {
            const guard = Promise.withResolvers<boolean>();
            const rpc = Promise.withResolvers<QueryResult>();
            fixtures.guardQuery.mockReturnValueOnce(guard.promise);
            mockInvoke.mockReturnValueOnce(rpc.promise);
            renderNotebook({
                cells: [sqlCell('source', 'SELECT 1'), sqlCell('use', 'SELECT * FROM {{cell_1}}')],
            });

            await click('Run affected source');
            expect(screen.getByRole('button', {name: 'Run All'})).toBeDisabled();
            await click('Run use');
            fixtures.matchesShortcut.mockReturnValue(true);
            fireEvent.keyDown(window, {key: 'Enter', ctrlKey: true, shiftKey: true});
            expect(fixtures.showAlert).toHaveBeenCalledTimes(2);
            expect(fixtures.showAlert).toHaveBeenLastCalledWith('editor.notebook.execution.busy', {
                kind: 'info',
            });
            await act(async () => guard.resolve(true));

            await click('Run source');
            expect(fixtures.showAlert).toHaveBeenCalledTimes(3);
            expect(mockInvoke).toHaveBeenCalledTimes(1);
            await act(async () => rpc.resolve(queryResult));

            expect(mockInvoke).toHaveBeenCalledTimes(2);
            expect(summary()).toMatchObject({succeeded: 2});
            await click('Run All');
            expect(mockInvoke).toHaveBeenCalledTimes(4);
        });

        it('settles an in-flight write into the remounted notebook and never repeats it for a consumer', async () => {
            const rpc = Promise.withResolvers<QueryResult>();
            const insert = 'INSERT INTO audit(id) VALUES (7) RETURNING id';
            const consume = 'WITH cell_1 AS (\n  SELECT 7 AS "id"\n)\nSELECT * FROM cell_1';
            mockInvoke.mockReturnValueOnce(rpc.promise);
            const initial = renderNotebook({
                cells: [
                    sqlCell('source', insert, {schema: 'audit_schema'}),
                    sqlCell('use', 'SELECT * FROM {{cell_1}}'),
                ],
            });
            await click('Run source');
            initial.unmount();
            renderNotebook();
            await click('Run use');
            expect(mockInvoke.mock.calls).toEqual([requestSql(insert, 'audit_schema')]);
            expect(fixtures.showAlert).toHaveBeenCalledWith('editor.notebook.execution.busy', {
                kind: 'info',
            });

            await act(async () => rpc.resolve({columns: ['id'], rows: [[7]], affected_rows: 1}));
            expect(savedCell('source')).toMatchObject({
                isLoading: false,
                history: [{query: insert}],
            });
            expect(screen.getByTestId('cell-source')).toHaveAttribute('data-loading', 'false');
            await click('Run use');
            expect(mockInvoke.mock.calls).toEqual([
                requestSql(insert, 'audit_schema'),
                requestSql(consume),
            ]);
            expect(summary()).toMatchObject({total: 1, succeeded: 1});
        });

        it('blocks automatic retry when a sent write result cannot attach to its original input', async () => {
            const rpc = Promise.withResolvers<QueryResult>();
            const insert = 'INSERT INTO audit(id) VALUES (7) RETURNING id';
            mockInvoke.mockReturnValueOnce(rpc.promise);
            renderNotebook({
                cells: [sqlCell('write', insert), sqlCell('use', 'SELECT * FROM {{cell_1}}')],
            });
            await click('Run affected write');
            fireEvent.change(screen.getByRole('textbox', {name: 'SQL write'}), {
                target: {value: 'INSERT INTO audit(id) VALUES (8) RETURNING id'},
            });
            await act(async () => rpc.resolve(queryResult));
            expect(savedCell('write')).toMatchObject({isLoading: false, result: null});
            expect(summary()).toMatchObject({
                executed: 1,
                succeeded: 0,
                skipped: 1,
                blocked: 1,
                changedCells: [{cellId: 'write'}],
                blockedCells: [{cellId: 'use', prerequisite: {cellId: 'write'}}],
            });
            expect(mockInvoke.mock.calls).toEqual([requestSql(insert)]);

            await click('Undo');
            await click('Run use');
            expect(mockInvoke.mock.calls).toEqual([requestSql(insert)]);
            expect(fixtures.guardQuery).toHaveBeenCalledExactlyOnceWith(
                insert,
                expect.any(AbortSignal),
            );
            expect(summary()).toMatchObject({
                executed: 0,
                blocked: 1,
                errors: [{cellId: 'write', error: 'editor.notebook.execution.unconfirmedWrite'}],
            });

            await click('Run write');
            expect(mockInvoke.mock.calls).toEqual([requestSql(insert), requestSql(insert)]);
        });

        it.each([
            {suffix: '', loseIds: false},
            {suffix: ' /* note */', loseIds: false},
            {suffix: ' /* note */', loseIds: true},
        ])(
            'does not replay an in-flight write after eviction and reload (edit: $suffix, lost IDs: $loseIds)',
            async ({suffix, loseIds}) => {
                const store =
                    await vi.importActual<typeof import('@/utils/notebookStore')>(
                        '@/utils/notebookStore',
                    );
                const rpc = Promise.withResolvers<QueryResult>();
                const insert = 'INSERT INTO audit(id) VALUES (7) RETURNING id';
                const consume =
                    'WITH cell_1 AS (\n  SELECT 7 AS "id"\n  UNION ALL\n  SELECT 8 AS "id"\n)\nSELECT * FROM cell_1';
                let file = JSON.stringify({
                    version: 2,
                    title: 'Legacy notebook',
                    cells: [
                        {type: 'sql', content: insert},
                        {type: 'sql', content: 'SELECT * FROM {{cell_1}}'},
                    ],
                });
                let writeCount = 0;
                mockInvoke.mockImplementation(async (command, args) => {
                    if (command === 'load_notebook') return file;
                    if (command === 'save_notebook') {
                        file = String(args?.content);
                        return;
                    }
                    if (args?.query === insert || (suffix && args?.query === insert + suffix)) {
                        writeCount++;
                        if (writeCount === 1) return rpc.promise;
                    }
                    return queryResult;
                });
                const {cells} = await store.loadNotebook(
                    notebookId,
                    connectionId,
                    tauriBackedClient,
                );
                const [write, use] = cells;
                const view = renderNotebook();
                await click(`Run ${write.id}`);
                if (suffix) {
                    fireEvent.change(screen.getByRole('textbox', {name: `SQL ${write.id}`}), {
                        target: {value: insert + suffix},
                    });
                }
                view.unmount();
                await evictFromCache(notebookId);
                expect(getNotebookState(notebookId)).toBeUndefined();
                if (loseIds) {
                    const saved = JSON.parse(file) as {cells: Array<{id?: string}>};
                    for (const cell of saved.cells) delete cell.id;
                    file = JSON.stringify(saved);
                }
                vi.mocked(loadNotebook).mockImplementationOnce(store.loadNotebook);
                renderNotebook();
                await waitFor(() => expect(getNotebookState(notebookId)).toBeDefined());
                const [reloadedWrite, reloadedUse] = getNotebookState(notebookId)!.cells;
                if (loseIds) expect(reloadedWrite.id).not.toBe(write.id);
                else expect([reloadedWrite.id, reloadedUse.id]).toEqual([write.id, use.id]);
                expect(reloadedWrite).toMatchObject({content: insert + suffix, result: null});

                await act(async () => rpc.resolve(queryResult));
                await click(`Run ${reloadedUse.id}`);
                const sqlCalls = () =>
                    mockInvoke.mock.calls.filter(([command]) => command === 'execute_query');
                expect(writeCount).toBe(1);
                if (suffix) {
                    expect(sqlCalls()).toEqual([requestSql(insert)]);
                    expect(summary()).toMatchObject({
                        executed: 0,
                        blocked: 1,
                        errors: [
                            {
                                cellId: reloadedWrite.id,
                                error: 'editor.notebook.execution.unconfirmedWrite',
                            },
                        ],
                    });
                    expect(fixtures.guardQuery).toHaveBeenCalledExactlyOnceWith(
                        insert,
                        expect.any(AbortSignal),
                    );

                    await click(`Run ${reloadedWrite.id}`);
                    await click(`Run ${reloadedUse.id}`);
                    expect(sqlCalls()).toEqual([
                        requestSql(insert),
                        requestSql(insert + suffix),
                        requestSql(consume),
                    ]);
                    expect(writeCount).toBe(2);
                } else {
                    expect(sqlCalls()).toEqual([requestSql(insert), requestSql(consume)]);
                }
            },
        );

        it('requires an explicit retry after losing the reply to an Oracle sequence query', async () => {
            fixtures.database.activeCapabilities = {sql_dialect: 'oracle'};
            const sql = 'SELECT audit_seq.NEXTVAL FROM dual';
            renderNotebook({
                cells: [sqlCell('source', sql), sqlCell('use', 'SELECT * FROM {{cell_1}}')],
            });
            mockInvoke.mockRejectedValueOnce(new Error('reply lost'));
            await click('Run source');
            await click('Run use');
            expect(mockInvoke.mock.calls).toEqual([requestSql(sql)]);
            expect(summary()).toMatchObject({
                executed: 0,
                blocked: 1,
                errors: [{cellId: 'source', error: 'editor.notebook.execution.unconfirmedWrite'}],
            });

            await click('Run source');
            await click('Run use');
            expect(mockInvoke.mock.calls.map(([, args]) => args?.query)).toEqual([
                sql,
                sql,
                expect.stringContaining('SELECT * FROM cell_1'),
            ]);
        });

        it.each(['Run All', 'Run affected source', 'Run use'])(
            'lets %s proceed after explicitly deleting a cell with a lost write reply',
            async (action) => {
                const insert = 'INSERT INTO audit VALUES (7)';
                const source = 'SELECT id FROM source_table';
                renderNotebook({
                    cells: [
                        sqlCell('source', source),
                        sqlCell('use', 'SELECT * FROM {{cell_1}}'),
                        sqlCell('write', insert),
                    ],
                });
                mockInvoke.mockRejectedValueOnce(new Error('reply lost'));
                await click('Run write');
                await click('Delete write');
                await click(action);

                expect(mockInvoke.mock.calls).toEqual([
                    requestSql(insert),
                    requestSql(source),
                    requestSql(
                        'WITH cell_1 AS (\n  SELECT 7 AS "id"\n  UNION ALL\n  SELECT 8 AS "id"\n)\nSELECT * FROM cell_1',
                    ),
                ]);
                expect(summary()).toMatchObject({executed: 2, succeeded: 2, failed: 0});
            },
        );

        it('protects a lost write restored by Undo without blocking other cells while deleted', async () => {
            const insert = 'INSERT INTO audit VALUES (7) RETURNING id';
            const other = 'SELECT id FROM source_table';
            renderNotebook({
                cells: [
                    sqlCell('write', insert),
                    sqlCell('other', other),
                    sqlCell('use', 'SELECT * FROM {{cell_1}}', {isDisabled: true}),
                ],
            });
            mockInvoke.mockRejectedValueOnce(new Error('reply lost'));
            await click('Run write');
            await click('Delete write');
            await click('Run All');
            expect(mockInvoke.mock.calls).toEqual([requestSql(insert), requestSql(other)]);
            expect(summary()).toMatchObject({succeeded: 1, failed: 0});

            await click('Undo');
            expect(savedCell('write').content).toBe(insert);
            await click('Toggle disabled use');
            await click('Run All');
            expect(mockInvoke.mock.calls).toEqual([
                requestSql(insert),
                requestSql(other),
                requestSql(other),
            ]);
            expect(summary()).toMatchObject({
                executed: 1,
                blocked: 1,
                errors: [{cellId: 'write', error: 'editor.notebook.execution.unconfirmedWrite'}],
            });

            await click('Run use');
            expect(mockInvoke).toHaveBeenCalledTimes(3);
            expect(summary()).toMatchObject({executed: 0, blocked: 1});
        });

        it.each(['connection', 'schema'] as const)(
            'keeps a lost write protected after the same SQL succeeds on a different %s',
            async (dimension) => {
                const sql = 'INSERT INTO audit VALUES (7) RETURNING id';
                const view = renderNotebook({cells: [sqlCell('write', sql)]});
                mockInvoke.mockRejectedValueOnce(new Error('reply lost'));
                await click('Run write');

                const target =
                    dimension === 'connection'
                        ? {connectionId: 'other-connection'}
                        : {schema: 'other_schema'};
                view.rerender(notebookView(target));
                await click('Run write');

                view.rerender(notebookView());
                await click('Run All');
                expect(summary()).toMatchObject({
                    executed: 0,
                    errors: [
                        {cellId: 'write', error: 'editor.notebook.execution.unconfirmedWrite'},
                    ],
                });
                expect(mockInvoke.mock.calls).toEqual([
                    requestSql(sql),
                    requestSql(sql, target.schema, 37, target.connectionId),
                ]);
            },
        );

        it('keeps a lost write protected after a different write succeeds and is undone', async () => {
            const insert = (id: number) => `INSERT INTO audit VALUES (${id}) RETURNING id`;
            renderNotebook({
                cells: [sqlCell('write', insert(7)), sqlCell('use', 'SELECT * FROM {{cell_1}}')],
            });
            mockInvoke.mockRejectedValueOnce(new Error('reply lost'));
            await click('Run write');
            fireEvent.change(screen.getByRole('textbox', {name: 'SQL write'}), {
                target: {value: insert(8)},
            });
            await click('Run write');
            expect(savedCell('write').result).toEqual(queryResult);

            await click('Undo');
            expect(savedCell('write').content).toBe(insert(7));
            for (const action of ['Run use', 'Run All']) {
                await click(action);
                expect(summary()).toMatchObject({
                    executed: 0,
                    blocked: 1,
                    errors: [
                        {cellId: 'write', error: 'editor.notebook.execution.unconfirmedWrite'},
                    ],
                });
                expect(mockInvoke.mock.calls).toEqual([
                    requestSql(insert(7)),
                    requestSql(insert(8)),
                ]);
            }
        });

        it('keeps a verified output reusable after cancelling a rerun and blocks the current consumer', async () => {
            const source = 'DELETE FROM audit RETURNING id';
            const mocked = vi.mocked(useQueryGuards);
            mocked.mockImplementation(useDangerousQueryGuardForTest);
            try {
                renderNotebook({
                    cells: [sqlCell('source', source), sqlCell('use', 'SELECT * FROM {{cell_1}}')],
                });
                await click('Run source');
                await click('editor.dangerousQueryConfirm');
                const output = savedCell('source').result;
                expect(output).toEqual(queryResult);

                await click('Run affected source');
                expect(within(screen.getByRole('dialog')).getByText(source)).toBeInTheDocument();
                await click('common.cancel');
                expect(savedCell('source').result).toBe(output);
                expect(savedCell('source').error).toBeUndefined();
                expect(mockInvoke.mock.calls).toEqual([requestSql(source)]);
                expect(summary()).toMatchObject({
                    executed: 0,
                    blocked: 1,
                    errors: [{cellId: 'source', error: 'editor.notebook.execution.guardDenied'}],
                });

                await click('Run use');
                expect(mockInvoke.mock.calls).toEqual([
                    requestSql(source),
                    requestSql(
                        'WITH cell_1 AS (\n  SELECT 7 AS "id"\n  UNION ALL\n  SELECT 8 AS "id"\n)\nSELECT * FROM cell_1',
                    ),
                ]);
            } finally {
                mocked.mockReset();
            }
        });

        it('can automatically retry a known constant read after a lost reply', async () => {
            fixtures.database.activeCapabilities = {sql_dialect: 'sqlite'};
            renderNotebook({
                cells: [
                    sqlCell('source', 'SELECT 7 AS id'),
                    sqlCell('use', 'SELECT * FROM {{cell_1}}'),
                ],
            });
            mockInvoke.mockRejectedValueOnce(new Error('reply lost'));
            await click('Run source');
            await click('Run use');
            expect(mockInvoke.mock.calls.map(([, args]) => args?.query)).toEqual([
                'SELECT 7 AS id',
                'SELECT 7 AS id',
                expect.stringContaining('SELECT * FROM cell_1'),
            ]);
        });

        it.each([true, false])(
            'drops a closed notebook production prompt (was active: %s) without affecting the surviving owner',
            async (active) => {
                const real =
                    await vi.importActual<typeof import('@/hooks/useQueryGuards')>(
                        '@/hooks/useQueryGuards',
                    );
                const mocked = vi.mocked(useQueryGuards);
                mocked.mockImplementation(real.useQueryGuards);
                fixtures.database.connections = [
                    {
                        id: connectionId,
                        name: 'Production',
                        params: {driver: 'postgres', database: 'prod'},
                        environment: 'production',
                    },
                ];
                const discarded = 'DELETE FROM abandoned';
                const surviving = 'DELETE FROM surviving';
                function Peer() {
                    const request = useContext(ProductionGuardContext);
                    return (
                        <button
                            onClick={async () => {
                                if (await request?.(connectionId, 'Production', surviving)) {
                                    await invoke('execute_query', {
                                        connectionId,
                                        query: surviving,
                                        schema: 'tab_schema',
                                        limit: 37,
                                        page: 1,
                                    });
                                }
                            }}
                        >
                            Queue peer
                        </button>
                    );
                }

                setNotebookState(notebookId, {cells: [sqlCell('discarded', discarded)]});
                const tree = (open: boolean) => (
                    <ProductionGuardProvider>
                        <Peer />
                        {open && notebookView()}
                    </ProductionGuardProvider>
                );
                try {
                    const view = render(tree(true));
                    if (active) {
                        await click('Run discarded');
                        expect(screen.getByText(discarded, {selector: 'pre'})).toBeInTheDocument();
                        fireEvent.click(
                            screen.getByRole('checkbox', {name: 'environment.warnSnooze'}),
                        );
                        await click('Queue peer');
                    } else {
                        await click('Queue peer');
                        await click('Run discarded');
                        expect(screen.getByText(surviving)).toBeInTheDocument();
                    }
                    expect(mockInvoke).not.toHaveBeenCalled();
                    view.rerender(tree(false));
                    await settle();
                    expect(screen.queryByText(discarded)).not.toBeInTheDocument();
                    expect(screen.getByText(surviving)).toBeInTheDocument();
                    expect(
                        screen.getByRole('checkbox', {name: 'environment.warnSnooze'}),
                    ).not.toBeChecked();
                    await click('environment.warnConfirm');
                    expect(snoozedConnectionIds.has(connectionId)).toBe(false);
                    expect(
                        screen.queryByRole('button', {name: 'environment.warnConfirm'}),
                    ).not.toBeInTheDocument();
                    expect(mockInvoke.mock.calls).toEqual([requestSql(surviving)]);
                } finally {
                    mocked.mockReset();
                }
            },
        );

        it('opens a cached document without reviving its stale spinner', () => {
            renderNotebook({
                cells: [sqlCell('idle', 'SELECT 7', {result: queryResult, isLoading: true})],
            });
            expect(screen.getByTestId('cell-idle')).toHaveAttribute('data-loading', 'false');
            expect(savedCell('idle')).toMatchObject({isLoading: false, result: queryResult});
            expect(screen.getByRole('button', {name: 'Clear outputs'})).toBeEnabled();
            expect(mockInvoke).not.toHaveBeenCalled();
        });

        it('restores document edits with the latest runtime output through undo and redo', async () => {
            const guard = Promise.withResolvers<boolean>();
            fixtures.guardQuery.mockReturnValueOnce(guard.promise);
            renderNotebook({
                cells: [sqlCell('running', 'SELECT 7'), sqlCell('edited', 'SELECT 1')],
            });
            await click('Run running');
            expect(savedCell('running').isLoading).toBe(true);
            fireEvent.change(screen.getByRole('textbox', {name: 'SQL edited'}), {
                target: {value: 'SELECT 2'},
            });
            await act(async () => guard.resolve(true));

            await click('Undo');
            expect(savedCell('edited').content).toBe('SELECT 1');
            expect(savedCell('running')).toMatchObject({
                isLoading: false,
                result: queryResult,
                history: [{query: 'SELECT 7'}],
            });
            expect(screen.getByTestId('cell-running')).toHaveAttribute('data-loading', 'false');
            expect(screen.getByRole('button', {name: 'Clear outputs'})).toBeEnabled();
            await click('Redo');
            expect(savedCell('edited').content).toBe('SELECT 2');
            expect(savedCell('running')).toMatchObject({
                isLoading: false,
                result: queryResult,
                history: [{query: 'SELECT 7'}],
            });
            expect(mockInvoke.mock.calls).toEqual([requestSql('SELECT 7')]);
        });

        it('runs an imported notebook while the old RPC is still in flight', async () => {
            const oldQuery = 'SELECT id FROM old_table';
            const newQuery = 'SELECT id FROM new_table';
            const oldRpc = Promise.withResolvers<QueryResult>();
            const newRpc = Promise.withResolvers<QueryResult>();
            mockInvoke.mockImplementation(async (command, args) => {
                if (command === 'execute_query') {
                    return args?.query === oldQuery ? oldRpc.promise : newRpc.promise;
                }
            });
            vi.mocked(open).mockResolvedValueOnce('/tmp/imported.tabularis-notebook');
            vi.mocked(readFile).mockResolvedValueOnce(
                new TextEncoder().encode(
                    JSON.stringify({
                        version: 2,
                        title: 'Imported',
                        cells: [sqlCell('new', newQuery)],
                    }),
                ),
            );
            setNotebookState(notebookId, {cells: [sqlCell('old', oldQuery)]});
            const updateTab = vi.fn<(id: string, partial: Partial<Tab>) => void>();
            const view = render(notebookView({}, updateTab));

            try {
                await click('Run old');
                await click('Import');
                const imported = updateTab.mock.calls.find(([, patch]) => patch.notebookId)?.[1];
                const importedId = imported?.notebookId;
                expect(importedId).toBeDefined();
                view.rerender(notebookView(imported, updateTab));
                const newCell = getNotebookState(importedId!)!.cells[0];
                const rpcCalls = () =>
                    mockInvoke.mock.calls.filter(([command]) => command === 'execute_query');

                const runAll = screen.getByRole('button', {name: 'Run All'});
                expect(runAll).toBeEnabled();
                await click(`Run ${newCell.id}`);
                expect(rpcCalls()).toEqual([requestSql(oldQuery), requestSql(newQuery)]);
                expect(fixtures.showAlert).not.toHaveBeenCalledWith(
                    'editor.notebook.execution.busy',
                    {
                        kind: 'info',
                    },
                );
                expect(runAll).toBeDisabled();
                expect(updateTab).toHaveBeenLastCalledWith('tab-1', {isLoading: true});

                await act(async () => oldRpc.resolve(queryResult));
                expect(savedCell('old').result).toEqual(queryResult);
                expect(runAll).toBeDisabled();
                expect(updateTab).toHaveBeenLastCalledWith('tab-1', {isLoading: true});
                expect(screen.queryByTestId('run-all-summary')).not.toBeInTheDocument();

                await act(async () => newRpc.resolve(queryResult));
                expect(runAll).toBeEnabled();
                expect(updateTab).toHaveBeenLastCalledWith('tab-1', {isLoading: false});
                expect(summary()).toMatchObject({executed: 1, succeeded: 1});
                expect(rpcCalls()).toEqual([requestSql(oldQuery), requestSql(newQuery)]);
            } finally {
                await act(async () => {
                    oldRpc.resolve(queryResult);
                    newRpc.resolve(queryResult);
                });
            }
        });

        it('releases a closed tab waiting for a confirmation without executing its SQL', async () => {
            const guard = Promise.withResolvers<boolean>();
            fixtures.guardQuery.mockReturnValueOnce(guard.promise);
            const initial = renderNotebook({cells: [sqlCell('write', 'DELETE FROM t')]});
            await click('Run write');
            initial.unmount();
            await settle();
            renderNotebook();
            await click('Run write');
            expect(mockInvoke.mock.calls).toEqual([requestSql('DELETE FROM t')]);
            await act(async () => guard.resolve(true));
            expect(mockInvoke.mock.calls).toEqual([requestSql('DELETE FROM t')]);
        });

        it('flushes queued editor changes before planning and skips edits and removals made during a run', async () => {
            const rpc = Promise.withResolvers<QueryResult>();
            mockInvoke.mockReturnValueOnce(rpc.promise);
            renderNotebook({
                cells: [
                    sqlCell('first', 'SELECT 1'),
                    sqlCell('edited', 'SELECT 2'),
                    sqlCell('deleted', 'SELECT 3'),
                    sqlCell('use', 'SELECT * FROM {{cell_3}}'),
                ],
            });
            const unregister = registerPendingEditorFlush(() => {
                unregister();
                fireEvent.change(screen.getByRole('textbox', {name: 'SQL first'}), {
                    target: {value: 'SELECT 11'},
                });
            });
            try {
                await click('Run All');
            } finally {
                unregister();
            }
            expect(mockInvoke.mock.calls.map(([, args]) => args?.query)).toEqual(['SELECT 11']);
            fireEvent.change(screen.getByRole('textbox', {name: 'SQL edited'}), {
                target: {value: 'SELECT 22'},
            });
            await click('Delete deleted');
            await act(async () => rpc.resolve(queryResult));
            expect(mockInvoke).toHaveBeenCalledTimes(1);
            expect(summary()).toMatchObject({
                total: 4,
                succeeded: 1,
                skipped: 2,
                blocked: 1,
                changedCells: [{cellId: 'edited'}, {cellId: 'deleted'}],
                blockedCells: [{cellId: 'use', prerequisite: {cellId: 'deleted'}}],
            });
            expect(savedCell('edited').content).toBe('SELECT 22');
        });

        it('does not dispatch edited SQL after a dangerous query is confirmed', async () => {
            const guard = Promise.withResolvers<boolean>();
            fixtures.guardQuery.mockReturnValueOnce(guard.promise);
            renderNotebook({cells: [sqlCell('write', 'DELETE FROM t')]});
            await click('Run write');
            fireEvent.change(screen.getByRole('textbox', {name: 'SQL write'}), {
                target: {value: 'DROP TABLE t'},
            });
            await act(async () => guard.resolve(true));
            expect(mockInvoke).not.toHaveBeenCalled();
            expect(savedCell('write')).toMatchObject({content: 'DROP TABLE t', isLoading: false});
            expect(summary()).toMatchObject({skipped: 1, changedCells: [{cellId: 'write'}]});
        });
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

            fireEvent.click(
                within(screen.getByRole('dialog', {name: clearLabel})).getByRole('button', {
                    name: clearLabel,
                }),
            );

            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
            expect(setNotebookState).toHaveBeenCalledTimes(1);
            const saved = getNotebookState(notebookId);
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
            fireEvent.click(screen.getByRole('button', {name: 'common.cancel'}));

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
            fireEvent.click(
                within(screen.getByRole('dialog', {name: clearLabel})).getByRole('button', {
                    name: clearLabel,
                }),
            );

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
            fireEvent.click(
                within(screen.getByRole('dialog', {name: clearLabel})).getByRole('button', {
                    name: clearLabel,
                }),
            );

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

        const ids = () => getNotebookState(notebookId)?.cells.map((cell) => cell.id) ?? [];
        const lastCell = () => {
            const cells = getNotebookState(notebookId)?.cells ?? [];
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
            const saved = getNotebookState(notebookId);
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
    describe('Report view', () => {
        it('switches Edit -> Report -> Edit without executing cells, losing output, or changing collapse preferences', async () => {
            renderNotebook({
                cells: [
                    {
                        ...sqlCell('setup', 'SELECT 1'),
                        includeInReport: false,
                        isCollapsed: true,
                        isQueryCollapsed: true,
                        isResultCollapsed: true,
                    },
                    {
                        ...sqlCell('report_cell', 'SELECT 2'),
                        name: 'Summary',
                        result: queryResult,
                        isCollapsed: true,
                        isQueryCollapsed: true,
                        isResultCollapsed: false,
                    },
                ],
            });
            await settle();

            expect(screen.getByTestId('cell-setup')).toBeInTheDocument();
            expect(screen.getByTestId('cell-report_cell')).toBeInTheDocument();

            // Switch to Report mode
            fireEvent.click(screen.getByRole('button', {name: 'Report mode'}));
            expect(mockInvoke).not.toHaveBeenCalled();

            // Setup cell is omitted; report_cell is rendered
            expect(screen.queryByTestId('cell-setup')).not.toBeInTheDocument();
            expect(screen.getByRole('region', {name: 'Summary'})).toBeInTheDocument();

            // Switch back to Edit mode
            fireEvent.click(screen.getByRole('button', {name: 'Edit mode'}));
            expect(mockInvoke).not.toHaveBeenCalled();

            // Outputs and collapse preferences are preserved
            expect(savedCell('setup')).toMatchObject({
                includeInReport: false,
                isCollapsed: true,
                isQueryCollapsed: true,
                isResultCollapsed: true,
            });
            expect(savedCell('report_cell')).toMatchObject({
                result: queryResult,
                isCollapsed: true,
                isQueryCollapsed: true,
                isResultCollapsed: false,
            });
        });

        it('executes Run All in Report view through the guarded execution path', async () => {
            renderNotebook({
                cells: [
                    {
                        ...sqlCell('q1', 'SELECT 1'),
                        name: 'Metric',
                        result: null,
                    },
                ],
            });
            await settle();

            fireEvent.click(screen.getByRole('button', {name: 'Report mode'}));
            expect(screen.getByText('editor.notebook.reportNoOutput')).toBeInTheDocument();
            expect(mockInvoke).not.toHaveBeenCalled();

            await act(async () => {
                fireEvent.click(screen.getByRole('button', {name: 'Run All'}));
            });

            await waitFor(() =>
                expect(fixtures.guardQuery).toHaveBeenCalledWith(
                    'SELECT 1',
                    expect.any(AbortSignal),
                ),
            );
            await waitFor(() =>
                expect(mockInvoke).toHaveBeenCalledWith(
                    'execute_query',
                    expect.objectContaining({query: 'SELECT 1'}),
                ),
            );
            await waitFor(() => expect(savedCell('q1').result).toEqual(queryResult));
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
            const before = getNotebookState(notebookId);

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
            expect(getNotebookState(notebookId)).toBe(before);
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

    describe('Disabled SQL cells', () => {
        const cached: QueryResult = {columns: ['n'], rows: [[1]], affected_rows: 0};

        it('does not run a disabled cell directly and keeps its existing output', async () => {
            renderNotebook({
                cells: [sqlCell('off', 'SELECT 1', {isDisabled: true, result: cached})],
            });
            await click('Run off');
            expect(mockInvoke).not.toHaveBeenCalled();
            expect(fixtures.guardQuery).not.toHaveBeenCalled();
            expect(savedCell('off')).toMatchObject({isDisabled: true, result: cached});
        });

        it.each([
            {label: 'without output', partial: {}},
            {label: 'with cached output', partial: {result: cached}},
        ])(
            'blocks a consumer of a disabled cell $label instead of running or reusing it',
            async ({partial}) => {
                renderNotebook({
                    cells: [
                        sqlCell('off', 'SELECT 1', {isDisabled: true, ...partial}),
                        sqlCell('use', 'SELECT * FROM {{cell_1}}'),
                    ],
                });
                await click('Run use');
                expect(mockInvoke).not.toHaveBeenCalled();
                expect(fixtures.guardQuery).not.toHaveBeenCalled();
                expect(summary().preflightErrors).toEqual([
                    'editor.notebook.execution.disabled editor.notebook.execution.cell 2 {{cell_1}}',
                ]);
                expect(savedCell('use').error).toBeUndefined();
                expect(savedCell('off')).toMatchObject({isDisabled: true, ...partial});
            },
        );

        it('blocks the end of a dependency chain whose root is disabled', async () => {
            renderNotebook({
                cells: [
                    sqlCell('off', 'SELECT 1', {isDisabled: true}),
                    sqlCell('mid', 'SELECT * FROM {{cell_1}}'),
                    sqlCell('end', 'SELECT * FROM {{cell_2}}'),
                ],
            });
            await click('Run end');
            expect(mockInvoke).not.toHaveBeenCalled();
            expect(summary().preflightErrors).toEqual([
                'editor.notebook.execution.disabled editor.notebook.execution.cell 2 {{cell_1}}',
            ]);
            expect(savedCell('end').error).toBeUndefined();
        });

        it('blocks a consumer whose reference comes from a notebook parameter', async () => {
            renderNotebook({
                params: [{name: 'source', value: '{{cell_1}}'}],
                cells: [
                    sqlCell('off', 'SELECT 1', {isDisabled: true, result: cached}),
                    sqlCell('use', 'SELECT * FROM @source'),
                ],
            });
            await click('Run use');
            expect(mockInvoke).not.toHaveBeenCalled();
            expect(summary().preflightErrors).toEqual([
                'editor.notebook.execution.disabled editor.notebook.execution.cell 2 {{cell_1}}',
            ]);
        });

        it('Run All aborts before any SQL when a disabled prerequisite blocks the plan', async () => {
            renderNotebook({
                stopOnError: true,
                cells: [
                    sqlCell('off', 'SELECT 1', {isDisabled: true, result: cached}),
                    sqlCell('use', 'SELECT * FROM {{cell_1}}', {isParallel: true}),
                    sqlCell('plain', 'SELECT 3'),
                    sqlCell('chain', 'SELECT * FROM {{cell_2}}'),
                ],
            });
            await click('Run All');
            expect(mockInvoke).not.toHaveBeenCalled();
            expect(fixtures.guardQuery).not.toHaveBeenCalled();
            expect(summary()).toMatchObject({
                total: 4,
                succeeded: 0,
                failed: 0,
                skipped: 4,
                preflightErrors: [
                    'editor.notebook.execution.disabled editor.notebook.execution.cell 2 {{cell_1}}',
                ],
            });
            expect(savedCell('off')).toMatchObject({isDisabled: true, result: cached});
        });

        it('Run All skips disabled cells that no other query depends on', async () => {
            renderNotebook({
                cells: [
                    sqlCell('off', 'SELECT 1', {isDisabled: true, isParallel: true}),
                    sqlCell('fast', 'SELECT 2', {isParallel: true}),
                ],
            });
            await click('Run All');
            expect(mockInvoke.mock.calls.map((call) => call[1]?.query)).toEqual(['SELECT 2']);
            expect(summary()).toMatchObject({total: 2, succeeded: 1, skipped: 1});
        });

        it('re-enabling does not execute, and the toggle is undoable', async () => {
            renderNotebook({
                cells: [sqlCell('off', 'SELECT 1', {isDisabled: true, result: cached})],
            });
            fireEvent.click(screen.getByRole('button', {name: 'Toggle disabled off'}));
            await settle();
            expect(savedCell('off').isDisabled).toBe(false);
            expect(savedCell('off').result).toEqual(cached);
            expect(mockInvoke).not.toHaveBeenCalled();

            fireEvent.click(screen.getByRole('button', {name: 'Undo'}));
            expect(savedCell('off').isDisabled).toBe(true);
            fireEvent.click(screen.getByRole('button', {name: 'Redo'}));
            expect(savedCell('off').isDisabled).toBe(false);
            expect(mockInvoke).not.toHaveBeenCalled();

            await click('Run off');
            expect(mockInvoke).toHaveBeenCalledTimes(1);
        });

        it('keeps the cell disabled when a query sent before disabling answers', async () => {
            let finish: (value: QueryResult) => void = () => {};
            mockInvoke.mockReturnValueOnce(
                new Promise<QueryResult>((resolve) => {
                    finish = resolve;
                }),
            );
            renderNotebook({cells: [sqlCell('base', 'SELECT 1')]});
            await click('Run base');
            await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(1));
            fireEvent.click(screen.getByRole('button', {name: 'Toggle disabled base'}));
            expect(savedCell('base')).toMatchObject({isDisabled: true, isLoading: true});

            await act(async () => {
                finish(queryResult);
            });
            await waitFor(() => expect(savedCell('base').isLoading).toBe(false));
            expect(savedCell('base')).toMatchObject({isDisabled: true, result: queryResult});
            expect(screen.getByTestId('cell-base')).toHaveAttribute('data-disabled', 'true');
        });

        it('Run All skips a cell disabled while earlier cells were running', async () => {
            let finish: (value: QueryResult) => void = () => {};
            mockInvoke.mockReturnValueOnce(
                new Promise<QueryResult>((resolve) => {
                    finish = resolve;
                }),
            );
            renderNotebook({cells: [sqlCell('first', 'SELECT 1'), sqlCell('later', 'SELECT 2')]});
            await click('Run All');
            await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(1));
            fireEvent.click(screen.getByRole('button', {name: 'Toggle disabled later'}));
            await act(async () => {
                finish(queryResult);
            });
            await waitFor(() => expect(screen.getByTestId('run-all-summary')).toBeInTheDocument());
            expect(mockInvoke).toHaveBeenCalledTimes(1);
            expect(summary()).toMatchObject({total: 2, succeeded: 1, skipped: 1});
        });

        it('does not send a consumer disabled while its lazy dependency runs', async () => {
            let finish: (value: QueryResult) => void = () => {};
            mockInvoke.mockReturnValueOnce(
                new Promise<QueryResult>((resolve) => {
                    finish = resolve;
                }),
            );
            renderNotebook({
                cells: [sqlCell('dep', 'SELECT 1'), sqlCell('use', 'SELECT * FROM {{cell_1}}')],
            });
            await click('Run use');
            await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(1));
            fireEvent.click(screen.getByRole('button', {name: 'Toggle disabled use'}));
            expect(savedCell('use').isDisabled).toBe(true);

            await act(async () => {
                finish(sourceResult);
            });
            await waitFor(() => expect(summary().skipped).toBe(1));
            expect(mockInvoke.mock.calls).toEqual([
                [
                    'execute_query',
                    {connectionId, query: 'SELECT 1', schema: 'tab_schema', limit: 37, page: 1},
                ],
            ]);
            expect(fixtures.guardQuery).toHaveBeenCalledExactlyOnceWith(
                'SELECT 1',
                expect.any(AbortSignal),
            );
            expect(savedCell('dep').result).toEqual(sourceResult);
            expect(savedCell('use').isDisabled).toBe(true);
            expect(savedCell('use').isLoading).not.toBe(true);
            expect(savedCell('use').error).toBeUndefined();
        });

        it.each([
            {label: 'output', partial: {result: cached}},
            {label: 'error', partial: {error: 'earlier failure'}},
        ])(
            'keeps the earlier $label of a consumer disabled while its lazy dependency runs',
            async ({partial}) => {
                let finish: (value: QueryResult) => void = () => {};
                mockInvoke.mockReturnValueOnce(
                    new Promise<QueryResult>((resolve) => {
                        finish = resolve;
                    }),
                );
                renderNotebook({
                    cells: [
                        sqlCell('dep', 'SELECT 1'),
                        sqlCell('use', 'SELECT * FROM {{cell_1}}', partial),
                    ],
                });
                await click('Run use');
                await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(1));
                expect(savedCell('use')).toMatchObject(partial);
                fireEvent.click(screen.getByRole('button', {name: 'Toggle disabled use'}));

                await act(async () => {
                    finish(sourceResult);
                });
                await waitFor(() => expect(summary().skipped).toBe(1));
                expect(mockInvoke).toHaveBeenCalledTimes(1);
                expect(savedCell('use')).toMatchObject({isDisabled: true, ...partial});
            },
        );

        it('keeps the earlier output of a cell disabled while the query guard waits', async () => {
            let confirm: (value: boolean) => void = () => {};
            fixtures.guardQuery.mockReturnValueOnce(
                new Promise<boolean>((resolve) => {
                    confirm = resolve;
                }),
            );
            renderNotebook({cells: [sqlCell('base', 'DELETE FROM t', {result: cached})]});
            await click('Run base');
            await waitFor(() => expect(fixtures.guardQuery).toHaveBeenCalledTimes(1));
            fireEvent.click(screen.getByRole('button', {name: 'Toggle disabled base'}));
            await act(async () => {
                confirm(true);
            });
            await waitFor(() => expect(savedCell('base').isLoading).toBe(false));
            expect(mockInvoke).not.toHaveBeenCalled();
            expect(savedCell('base')).toMatchObject({isDisabled: true, result: cached});
        });

        it('clears the earlier output once the query is really sent', async () => {
            let finish: (value: QueryResult) => void = () => {};
            mockInvoke.mockReturnValueOnce(
                new Promise<QueryResult>((resolve) => {
                    finish = resolve;
                }),
            );
            renderNotebook({
                cells: [sqlCell('base', 'SELECT 1', {result: cached, error: 'earlier failure'})],
            });
            await click('Run base');
            await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(1));
            expect(savedCell('base')).toMatchObject({isLoading: true, result: null});
            expect(savedCell('base').error).toBeUndefined();
            await act(async () => {
                finish(sourceResult);
            });
            await waitFor(() => expect(savedCell('base').result).toEqual(sourceResult));
        });

        it('lists every disabled prerequisite of a blocked cell', async () => {
            renderNotebook({
                cells: [
                    sqlCell('a', 'SELECT 1', {isDisabled: true}),
                    sqlCell('b', 'SELECT 2', {isDisabled: true}),
                    sqlCell('use', 'SELECT * FROM {{cell_2}} JOIN {{cell_1}}'),
                ],
            });
            await click('Run use');
            expect(mockInvoke).not.toHaveBeenCalled();
            expect(summary().preflightErrors).toEqual([
                'editor.notebook.execution.disabled editor.notebook.execution.cell 3 {{cell_2}}',
                'editor.notebook.execution.disabled editor.notebook.execution.cell 3 {{cell_1}}',
            ]);
        });

        it('does not send a cell disabled while the query guard waits for confirmation', async () => {
            let confirm: (value: boolean) => void = () => {};
            fixtures.guardQuery.mockReturnValueOnce(
                new Promise<boolean>((resolve) => {
                    confirm = resolve;
                }),
            );
            renderNotebook({cells: [sqlCell('base', 'DELETE FROM t')]});
            await click('Run base');
            await waitFor(() => expect(fixtures.guardQuery).toHaveBeenCalledTimes(1));
            fireEvent.click(screen.getByRole('button', {name: 'Toggle disabled base'}));
            await act(async () => {
                confirm(true);
            });
            await waitFor(() => expect(savedCell('base').isLoading).toBe(false));
            expect(mockInvoke).not.toHaveBeenCalled();
            expect(savedCell('base')).toMatchObject({isDisabled: true});
            expect(savedCell('base').error).toBeUndefined();
        });

        it('Run All skips a consumer disabled while the parallel cells run', async () => {
            let finish: (value: QueryResult) => void = () => {};
            mockInvoke.mockReturnValueOnce(
                new Promise<QueryResult>((resolve) => {
                    finish = resolve;
                }),
            );
            // The dependency is parallel, so it runs before the sequential consumer starts.
            renderNotebook({
                cells: [
                    sqlCell('use', 'SELECT * FROM {{cell_2}}'),
                    sqlCell('dep', 'SELECT 1', {isParallel: true}),
                ],
            });
            // Run All starts the parallel dependency first; hold it, then disable the consumer.
            await click('Run All');
            await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(1));
            fireEvent.click(screen.getByRole('button', {name: 'Toggle disabled use'}));
            await act(async () => {
                finish(sourceResult);
            });
            await waitFor(() => expect(screen.getByTestId('run-all-summary')).toBeInTheDocument());
            expect(mockInvoke).toHaveBeenCalledTimes(1);
            expect(summary()).toMatchObject({total: 2, succeeded: 1, failed: 0, skipped: 1});
        });

        it('never retries a failed dependency even if it previously had output', async () => {
            mockInvoke.mockRejectedValueOnce(new Error('first attempt failed'));
            renderNotebook({
                cells: [
                    sqlCell('dep', 'SELECT 1', {result: cached}),
                    sqlCell('use', 'SELECT * FROM {{cell_1}}', {result: cached}),
                    sqlCell('downstream', 'SELECT * FROM {{cell_2}}'),
                ],
            });
            await click('Run All');
            expect(mockInvoke.mock.calls.map((call) => call[1]?.query)).toEqual(['SELECT 1']);
            expect(summary()).toMatchObject({
                total: 3,
                executed: 1,
                failed: 1,
                blocked: 2,
                succeeded: 0,
                blockedCells: [
                    {cellId: 'use', prerequisite: {cellId: 'dep'}},
                    {cellId: 'downstream', prerequisite: {cellId: 'use'}},
                ],
            });
        });

        it.each([true, false])(
            'uses one PostgreSQL database lane across schemas (stopOnError: %s)',
            async (stopOnError) => {
                fixtures.database.activeCapabilities = {
                    sql_dialect: 'postgres',
                    schemas: true,
                    file_based: false,
                };
                const held = Promise.withResolvers<QueryResult>();
                mockInvoke.mockReturnValueOnce(held.promise);
                renderNotebook({
                    stopOnError,
                    cells: [
                        sqlCell('first', 'SELECT 1', {schema: 'public', isParallel: true}),
                        sqlCell('second', 'SELECT 2', {schema: 'analysis', isParallel: true}),
                    ],
                });
                await click('Run All');
                expect(mockInvoke.mock.calls).toEqual([requestSql('SELECT 1', 'public')]);
                await act(async () => {
                    if (stopOnError) held.reject(new Error('query failed'));
                    else held.resolve(queryResult);
                });
                expect(mockInvoke.mock.calls).toEqual([
                    requestSql('SELECT 1', 'public'),
                    ...(stopOnError ? [] : [requestSql('SELECT 2', 'analysis')]),
                ]);
                expect(summary()).toMatchObject({
                    executed: stopOnError ? 1 : 2,
                    skipped: stopOnError ? 1 : 0,
                });
            },
        );

        it.each([
            "SELECT nextval('audit_seq')",
            'SELECT custom_fn(id) FROM items',
            'SELECT n FROM audit_view',
            'SELECT id FROM items FOR UPDATE',
            'SELECT id FROM items FOR SHARE',
            'SELECT id FROM items LOCK IN SHARE MODE',
            "SELECT 1 INTO OUTFILE 'file.csv'",
            'SELECT 1 /*!50000 INTO @v */',
        ])('serializes %s even beside an opted-in read on another database lane', async (sql) => {
            fixtures.database.activeCapabilities = mysqlLayout;
            fixtures.database.selectedDatabases = ['billing', 'orders'];
            const held = Promise.withResolvers<QueryResult>();
            mockInvoke.mockReturnValueOnce(held.promise);
            renderNotebook({
                cells: [
                    sqlCell('potential-write', sql, {schema: 'billing', isParallel: true}),
                    sqlCell('read', 'SELECT 1', {schema: 'orders', isParallel: true}),
                ],
            });
            await click('Run All');
            expect(mockInvoke.mock.calls).toEqual([requestSql(sql, 'billing')]);
            await act(async () => held.resolve(queryResult));
            expect(mockInvoke.mock.calls).toEqual([
                requestSql(sql, 'billing'),
                requestSql('SELECT 1', 'orders'),
            ]);
            expect(summary()).toMatchObject({executed: 2, succeeded: 2});
        });

        it('parallel opt-in runs reads on different databases together but keeps one database in order', async () => {
            fixtures.database.activeCapabilities = mysqlLayout;
            fixtures.database.selectedDatabases = ['billing', 'orders'];
            const pending: Array<(value: QueryResult) => void> = [];
            mockInvoke.mockImplementation(
                () =>
                    new Promise<QueryResult>((resolve) => {
                        pending.push(resolve);
                    }),
            );
            renderNotebook({
                cells: [
                    sqlCell('a', 'SELECT 1 AS a', {schema: 'billing', isParallel: true}),
                    sqlCell('b', 'SELECT 2 AS b', {schema: 'orders', isParallel: true}),
                    sqlCell('a2', 'SELECT 3 AS a2', {schema: 'billing', isParallel: true}),
                ],
            });
            await click('Run All');
            await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(2));
            expect(mockInvoke.mock.calls).toEqual([
                requestSql('SELECT 1 AS a', 'billing'),
                requestSql('SELECT 2 AS b', 'orders'),
            ]);

            await act(async () => {
                pending[0](queryResult);
                pending[1](queryResult);
            });
            await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(3));
            expect(mockInvoke.mock.calls).toEqual([
                requestSql('SELECT 1 AS a', 'billing'),
                requestSql('SELECT 2 AS b', 'orders'),
                requestSql('SELECT 3 AS a2', 'billing'),
            ]);
            await act(async () => {
                pending[2](queryResult);
            });
            expect(summary()).toMatchObject({succeeded: 3});
        });

        it('serializes guard and execution for writes even on different databases with parallel opt-in', async () => {
            const confirmations = new Map<string, (allowed: boolean) => void>();
            fixtures.guardQuery.mockImplementation(
                (sql: string) =>
                    new Promise<boolean>((resolve) => {
                        confirmations.set(sql, resolve);
                    }),
            );
            renderNotebook({
                cells: [
                    sqlCell('a', 'DELETE FROM a', {schema: 'billing', isParallel: true}),
                    sqlCell('b', 'DELETE FROM b', {schema: 'orders', isParallel: true}),
                ],
            });
            await click('Run All');
            expect(fixtures.guardQuery).toHaveBeenCalledExactlyOnceWith(
                'DELETE FROM a',
                expect.any(AbortSignal),
            );
            expect(confirmations.has('DELETE FROM b')).toBe(false);
            expect(mockInvoke).not.toHaveBeenCalled();

            await act(async () => {
                confirmations.get('DELETE FROM a')?.(true);
            });
            await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(1));
            expect(mockInvoke.mock.calls[0][1]).toEqual(
                expect.objectContaining({query: 'DELETE FROM a', schema: 'billing'}),
            );

            expect(fixtures.guardQuery).toHaveBeenLastCalledWith(
                'DELETE FROM b',
                expect.any(AbortSignal),
            );
            await act(async () => {
                confirmations.get('DELETE FROM b')?.(true);
            });
            await waitFor(() => expect(screen.getByTestId('run-all-summary')).toBeInTheDocument());
            expect(mockInvoke.mock.calls.map((call) => call[1]?.query)).toEqual([
                'DELETE FROM a',
                'DELETE FROM b',
            ]);
            expect(summary()).toMatchObject({total: 2, succeeded: 2, failed: 0, skipped: 0});
        });

        it('closes the old dangerous confirmation when the same tab switches notebook IDs', async () => {
            const real =
                await vi.importActual<typeof import('@/hooks/useQueryGuards')>(
                    '@/hooks/useQueryGuards',
                );
            const mocked = vi.mocked(useQueryGuards);
            mocked.mockImplementation(real.useQueryGuards);
            const replacementId = 'imported-notebook';
            setNotebookState(replacementId, {cells: [sqlCell('new', 'DROP TABLE replacement')]});

            try {
                const view = renderNotebook({cells: [sqlCell('old', 'DELETE FROM abandoned')]});
                await click('Run old');
                expect(
                    within(screen.getByRole('dialog')).getByText('DELETE FROM abandoned'),
                ).toBeInTheDocument();
                view.rerender(notebookView({notebookId: replacementId}));

                await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
                expect(mockInvoke).not.toHaveBeenCalled();
                expect(savedCell('old').isLoading).toBe(false);
                await click('Run new');
                expect(
                    within(screen.getByRole('dialog')).getByText('DROP TABLE replacement'),
                ).toBeInTheDocument();
                await click('editor.dangerousQueryConfirm');
                expect(mockInvoke.mock.calls).toEqual([requestSql('DROP TABLE replacement')]);
            } finally {
                mocked.mockReset();
            }
        });

        it('starts a fresh safety countdown for each queued dangerous query', async () => {
            const confirmLabel = 'editor.dangerousQueryConfirm';
            vi.useFakeTimers();
            fixtures.settings.safetyConfirmationDelayEnabled = true;

            const mockUseQueryGuards = vi.mocked(useQueryGuards);
            mockUseQueryGuards.mockImplementation(useDangerousQueryGuardForTest);
            try {
                renderNotebook({
                    cells: [
                        sqlCell('a', 'DELETE FROM a', {schema: 'billing'}),
                        sqlCell('b', 'DROP TABLE b', {schema: 'orders'}),
                    ],
                });
                await click('Run All');

                expect(
                    within(screen.getByRole('dialog')).getByText('DELETE FROM a'),
                ).toBeInTheDocument();
                expect(screen.getByRole('button', {name: `${confirmLabel} (5)`})).toBeDisabled();
                expect(mockInvoke).not.toHaveBeenCalled();

                act(() => vi.advanceTimersByTime(5000));
                await click(confirmLabel);

                expect(
                    within(screen.getByRole('dialog')).getByText('DROP TABLE b'),
                ).toBeInTheDocument();
                const secondConfirm = screen.getByRole('button', {
                    name: /^editor\.dangerousQueryConfirm/,
                });
                expect(secondConfirm).toBeDisabled();
                expect(secondConfirm).toHaveTextContent(`${confirmLabel} (5)`);
                fireEvent.click(secondConfirm);
                expect(mockInvoke.mock.calls.map((call) => call[1]?.query)).toEqual([
                    'DELETE FROM a',
                ]);

                act(() => vi.advanceTimersByTime(4999));
                expect(secondConfirm).toBeDisabled();
                act(() => vi.advanceTimersByTime(1));
                expect(secondConfirm).toBeEnabled();
                await click(confirmLabel);

                expect(mockInvoke.mock.calls.map((call) => call[1]?.query)).toEqual([
                    'DELETE FROM a',
                    'DROP TABLE b',
                ]);
                expect(summary()).toMatchObject({total: 2, succeeded: 2});
            } finally {
                mockUseQueryGuards.mockReset();
                fixtures.settings.safetyConfirmationDelayEnabled = false;
                vi.useRealTimers();
            }
        });

        it('stop on error skips the rest of a failed flat database and still runs the others', async () => {
            fixtures.database.activeCapabilities = mysqlLayout;
            fixtures.database.selectedDatabases = ['billing', 'orders'];
            mockInvoke.mockImplementation((_command, args: {query?: string}) => {
                if (args?.query === 'SELECT a') return Promise.reject(new Error('boom'));
                return Promise.resolve(queryResult);
            });
            renderNotebook({
                stopOnError: true,
                cells: [
                    sqlCell('a', 'SELECT a', {schema: 'billing'}),
                    sqlCell('a2', 'SELECT a2', {schema: 'billing'}),
                    sqlCell('b', 'SELECT b', {schema: 'orders'}),
                ],
            });
            await click('Run All');
            await waitFor(() => expect(screen.getByTestId('run-all-summary')).toBeInTheDocument());
            expect(mockInvoke.mock.calls).toEqual([
                requestSql('SELECT a', 'billing'),
                requestSql('SELECT b', 'orders'),
            ]);
            expect(summary()).toMatchObject({
                total: 3,
                succeeded: 1,
                failed: 1,
                skipped: 1,
            });
        });

        it('does not run a cell that would read a result skipped by stop-on-error', async () => {
            mockInvoke.mockImplementation((_command, args: {query?: string}) => {
                if (args?.query === 'SELECT a') return Promise.reject(new Error('boom'));
                return Promise.resolve(queryResult);
            });
            renderNotebook({
                stopOnError: true,
                cells: [
                    sqlCell('a', 'SELECT a', {schema: 'billing'}),
                    sqlCell('a2', 'SELECT a2', {schema: 'billing', result: cached}),
                    sqlCell('b', 'SELECT * FROM {{cell_2}}', {schema: 'orders'}),
                ],
            });
            await click('Run All');
            await waitFor(() => expect(screen.getByTestId('run-all-summary')).toBeInTheDocument());
            expect(mockInvoke.mock.calls.map((call) => call[1]?.query)).toEqual(['SELECT a']);
            expect(summary()).toMatchObject({
                total: 3,
                succeeded: 0,
                failed: 1,
                skipped: 1,
                blocked: 1,
            });
            expect(savedCell('b').result).toBeUndefined();
        });

        it('prepares no query plan for a disabled cell', () => {
            renderNotebook({
                cells: [sqlCell('off', 'SELECT 1', {isDisabled: true, isQueryPlanVisible: true})],
            });
            expect(explainFor('off')).toBeNull();
            expect(mockInvoke).not.toHaveBeenCalled();
        });
    });
});
