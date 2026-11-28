import type {ComponentProps} from 'react';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {invoke} from '@tauri-apps/api/core';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {NotebookView} from '@/components/notebook/NotebookView';
import type {NotebookCellWrapper} from '@/components/notebook/NotebookCellWrapper';
import type {NotebookToolbar} from '@/components/notebook/NotebookToolbar';
import type {QueryResult, Tab} from '@/types/editor';
import type {NotebookCell, NotebookParam, NotebookState} from '@/types/notebook';
import type {DriverCapabilities} from '@/types/plugins';
import {_resetForTesting, getNotebookState, setNotebookState} from '@/utils/notebookStore';
import {deserializeNotebook} from '@/utils/notebookFile';
import {chooseNotebookImport} from '@/utils/notebookTransfer';

// The real Parameters panel and Report view run here, on the notebook's own
// state and execution path; only the cell editor and the toolbar are replaced.
vi.mock('lucide-react', async (importOriginal) => await importOriginal());
vi.mock('@/hooks/useTabularisClient', () => import('../../support/tauriBackedHooks'));
vi.mock('@/hooks/usePlatformCapabilities', () => import('../../support/tauriBackedHooks'));
const fixtures = vi.hoisted(() => ({
    database: {
        activeDriver: 'plugin-driver',
        activeSchema: null as string | null,
        activeCapabilities: null as Partial<DriverCapabilities> | null,
        selectedDatabases: [] as string[],
    },
    guardQuery: vi.fn(),
    showAlert: vi.fn(),
}));

vi.mock('react-i18next', () => {
    // Stable, like the real hook: NotebookView's callbacks depend on it.
    const t = (key: string, options?: {name?: string; reason?: string}) =>
        options?.name ? `${key} @${options.name} ${options.reason ?? ''}`.trim() : key;
    return {useTranslation: () => ({t})};
});
vi.mock('@/hooks/useDatabase', () => ({useDatabase: () => fixtures.database}));
vi.mock('@/hooks/useSettings', () => ({
    useSettings: () => ({settings: {resultPageSize: 37, safetyConfirmationDelayEnabled: false}}),
}));
vi.mock('@/hooks/useAlert', () => ({useAlert: () => ({showAlert: fixtures.showAlert})}));
vi.mock('@/hooks/useKeybindings', () => ({
    useKeybindings: () => ({matchesShortcut: () => false}),
}));
vi.mock('@/hooks/useQueryGuards', () => ({
    useQueryGuards: () => ({pending: null, guardQuery: fixtures.guardQuery, resolve: vi.fn()}),
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
        createNotebookFromState: vi.fn().mockResolvedValue({notebookId: 'imported'}),
    };
});
vi.mock('@/utils/notebookTransfer', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/utils/notebookTransfer')>()),
    chooseNotebookImport: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({invoke: vi.fn(), isTauri: () => true}));
vi.mock('@tauri-apps/plugin-dialog', () => ({save: vi.fn(), open: vi.fn()}));
vi.mock('@tauri-apps/plugin-fs', () => ({
    writeTextFile: vi.fn(),
    readTextFile: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
}));
vi.mock('@/components/modals/ConfirmModal', () => ({ConfirmModal: () => null}));
vi.mock('@/components/notebook/NotebookHistoryPanel', () => ({NotebookHistoryPanel: () => null}));
vi.mock('@/components/notebook/AddCellButton', () => ({AddCellButton: () => null}));
vi.mock('@/components/notebook/RunAllSummary', () => ({RunAllSummary: () => null}));
vi.mock('@/components/notebook/NotebookOutline', () => ({NotebookOutline: () => null}));
vi.mock('@/components/ui/DataGrid', () => ({
    DataGrid: ({data}: {data: unknown[][]}) => <div data-testid="report-grid">{data.length}</div>,
}));
vi.mock('@/components/notebook/NotebookToolbar', () => ({
    NotebookToolbar: ({
        onRunAll,
        onUndo,
        onImport,
        onViewModeChange,
    }: ComponentProps<typeof NotebookToolbar>) => (
        <>
            <button onClick={onRunAll}>Run All</button>
            <button onClick={onImport}>Import</button>
            <button onClick={onUndo}>Undo</button>
            <button onClick={() => onViewModeChange?.('edit')}>Edit mode</button>
            <button onClick={() => onViewModeChange?.('report')}>Report mode</button>
        </>
    ),
}));
vi.mock('@/components/notebook/NotebookCellWrapper', () => ({
    NotebookCellWrapper: ({
        cell,
        explainQuery,
        explainError,
        onRun,
    }: ComponentProps<typeof NotebookCellWrapper>) => (
        <section>
            <output data-testid={`plan-sql-${cell.id}`}>{explainQuery?.sql ?? ''}</output>
            <output data-testid={`plan-error-${cell.id}`}>{explainError ?? ''}</output>
            <button onClick={onRun}>Run {cell.id}</button>
        </section>
    ),
}));

const mockInvoke = vi.mocked(invoke);
const notebookId = 'notebook-params';
const connectionId = 'connection';
const queryResult: QueryResult = {columns: ['id'], rows: [[1]], affected_rows: 0};
const K = 'editor.notebook.params';

const sqliteDriver: Partial<DriverCapabilities> = {identifier_quote: '"', sql_dialect: 'sqlite'};
// An installed driver that speaks a supported dialect with its own literal rules.
const pluginDriver: Partial<DriverCapabilities> = {
    identifier_quote: '`',
    sql_dialect: 'mysql',
    sql_syntax: {string_escape: 'backslash', boolean_literals: 'numeric'},
};

function sqlCell(id: string, content: string, partial: Partial<NotebookCell> = {}): NotebookCell {
    return {id, type: 'sql', content, ...partial};
}

function renderNotebook(state: NotebookState) {
    if (state) {
        setNotebookState(notebookId, state);
        vi.mocked(setNotebookState).mockClear();
    }
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
    };
    return render(
        <NotebookView tab={tab} updateTab={vi.fn()} connectionId={connectionId} isActive />,
    );
}

const saved = () => getNotebookState(notebookId) as NotebookState;
const savedCell = (id: string) => saved().cells.find((cell) => cell.id === id) as NotebookCell;
const executedQueries = () =>
    mockInvoke.mock.calls
        .filter(([command]) => command === 'execute_query')
        .map(([, args]) => (args as {query: string}).query);

async function click(name: string) {
    await act(async () => {
        fireEvent.click(screen.getByRole('button', {name}));
    });
}

const row = (name: string) => within(screen.getByRole('group', {name: `@${name}`}));
const valueOf = (name: string) => row(name).getByRole('textbox', {name: `${K}.value`});
/** The message a row names, through its group's `aria-describedby`. */
const messageOf = (name: string) =>
    document.getElementById(
        screen.getByRole('group', {name: `@${name}`}).getAttribute('aria-describedby') ?? '',
    );

describe('NotebookView typed parameters', () => {
    afterEach(_resetForTesting);

    beforeEach(() => {
        vi.clearAllMocks();
        fixtures.database.activeCapabilities = sqliteDriver;
        fixtures.guardQuery.mockReset().mockResolvedValue(true);
        mockInvoke.mockReset().mockResolvedValue(queryResult);
    });

    const typedParams: NotebookParam[] = [
        {name: 'name', value: String.raw`O'Brien \ x`, type: 'text'},
        {name: 'active', value: 'true', type: 'boolean'},
        {name: 'start', value: '2026-01-01', type: 'date'},
        {name: 'tbl', value: 'orders'},
    ];
    const source = 'SELECT * FROM @tbl WHERE name = @name AND active = ${active} AND d >= @start';

    it.each([
        [
            'a built-in dialect',
            sqliteDriver,
            String.raw`SELECT * FROM orders WHERE name = 'O''Brien \ x' AND active = TRUE AND d >= '2026-01-01'`,
        ],
        [
            'the literal rules an installed driver declares',
            pluginDriver,
            String.raw`SELECT * FROM orders WHERE name = 'O\'Brien \\ x' AND active = 1 AND d >= '2026-01-01'`,
        ],
    ])('runs and explains typed values written for %s', async (_label, capabilities, expected) => {
        fixtures.database.activeCapabilities = capabilities;
        renderNotebook({
            params: typedParams,
            cells: [sqlCell('q', source, {isQueryPlanVisible: true})],
        });

        expect(screen.getByTestId('plan-sql-q')).toHaveTextContent(expected);
        expect(screen.getByTestId('plan-error-q')).toBeEmptyDOMElement();

        await click('Run q');

        await waitFor(() => expect(executedQueries()).toEqual([expected]));
        expect(fixtures.guardQuery).toHaveBeenCalledExactlyOnceWith(
            expected,
            expect.any(AbortSignal),
        );
        expect(savedCell('q').error).toBeUndefined();
    });

    it('dispatches typed reference-like text literally but binds a raw table reference', async () => {
        const literal = "SELECT '{{cell_1}}'";
        const expanded = 'WITH cell_1 AS (\n  SELECT 1 AS "id"\n)\nSELECT * FROM cell_1';
        renderNotebook({
            params: [
                {name: 'text', type: 'text', value: '{{cell_1}}'},
                {name: 'source', value: '{{cell_1}}'},
            ],
            cells: [sqlCell('source', 'SELECT @text'), sqlCell('use', 'SELECT * FROM @source')],
        });
        await click('Run source');
        await click('Run use');
        expect(fixtures.guardQuery.mock.calls).toEqual([
            [literal, expect.any(AbortSignal)],
            [expanded, expect.any(AbortSignal)],
        ]);
        expect(mockInvoke.mock.calls).toEqual(
            [literal, expanded].map((query) => [
                'execute_query',
                {connectionId, query, limit: 37, page: 1},
            ]),
        );
    });

    it('does not resend a successful write after applying an unused parameter, but refreshes a changed input', async () => {
        const insert = (n: number) => `INSERT INTO audit(n) VALUES (${n}) RETURNING n`;
        const consume = (n: number) =>
            `WITH cell_1 AS (\n  SELECT ${n} AS "n"\n)\nSELECT * FROM cell_1`;
        const output = (n: number): QueryResult => ({
            columns: ['n'],
            rows: [[n]],
            affected_rows: 1,
        });
        mockInvoke
            .mockResolvedValueOnce(output(1))
            .mockResolvedValueOnce(output(1))
            .mockResolvedValueOnce(output(2))
            .mockResolvedValueOnce(output(2));
        renderNotebook({
            params: [
                {name: 'used', type: 'number', value: '1'},
                {name: 'unused', type: 'number', value: '10'},
            ],
            cells: [
                sqlCell('write', 'INSERT INTO audit(n) VALUES (@used) RETURNING n', {
                    schema: 'audit',
                }),
                sqlCell('use', 'SELECT * FROM {{cell_1}}'),
            ],
        });
        const request = (query: string, schema?: string) => [
            'execute_query',
            {connectionId, query, limit: 37, page: 1, ...(schema ? {schema} : {})},
        ];
        await click('Run write');
        fireEvent.change(valueOf('unused'), {target: {value: '50'}});
        await click(`${K}.apply`);
        await click('Run use');
        expect(mockInvoke.mock.calls).toEqual([request(insert(1), 'audit'), request(consume(1))]);

        fireEvent.change(valueOf('used'), {target: {value: '2'}});
        await click(`${K}.apply`);
        await click('Run use');
        expect(mockInvoke.mock.calls).toEqual([
            request(insert(1), 'audit'),
            request(consume(1)),
            request(insert(2), 'audit'),
            request(consume(2)),
        ]);
    });

    it('stops the cell and its query plan when a typed reference sits inside quotes', async () => {
        renderNotebook({
            params: typedParams,
            cells: [sqlCell('q', "SELECT '${name}'", {isQueryPlanVisible: true})],
        });
        const message = `${K}.errors.quoted @name`;

        expect(screen.getByTestId('plan-error-q')).toHaveTextContent(message);

        await click('Run q');

        expect(savedCell('q')).toMatchObject({error: message, isLoading: false, result: null});
        expect(fixtures.guardQuery).not.toHaveBeenCalled();
        expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('stops the cell when a typed value loaded from a file is invalid', async () => {
        renderNotebook({
            params: [{name: 'start', value: '2025-02-29', type: 'date'}],
            cells: [sqlCell('q', 'SELECT * FROM t WHERE d >= @start')],
        });

        await click('Run q');

        expect(savedCell('q').error).toBe(`${K}.errors.invalid @start ${K}.issues.invalidDate`);
        expect(mockInvoke).not.toHaveBeenCalled();
        // The panel shows the same row as invalid, so it can be fixed.
        expect(messageOf('start')).toHaveTextContent(`${K}.issues.invalidDate`);
    });

    it('stops the cell when a parameter loaded from a file has a type this build does not know', async () => {
        fixtures.database.activeCapabilities = pluginDriver;
        const {params} = deserializeNotebook(
            JSON.stringify({
                version: 2,
                title: 'x',
                createdAt: '2026-01-01',
                cells: [],
                params: [{name: 'since', value: '2026-01-01 10:00', type: 'datetime'}],
            }),
        );
        renderNotebook({params, cells: [sqlCell('q', 'SELECT * FROM t WHERE d >= @since')]});

        await click('Run q');
        // Wait for the run to end one way or the other: stopped, or sent.
        await waitFor(() => expect(savedCell('q').error ?? executedQueries()[0]).toBeDefined());

        // `@since` must not reach the database: MySQL reads it as a NULL user variable.
        expect(executedQueries()).toEqual([]);
        expect(savedCell('q').error).toBe(`${K}.errors.invalid @since ${K}.issues.unknownType`);
        expect(messageOf('since')).toHaveTextContent(`${K}.issues.unknownType`);
    });

    it.each([
        ['declares no dialect', {identifier_quote: '"'}],
        ['declares a dialect without typed parameters', {sql_dialect: 'mssql'}],
        ['has no capabilities', null],
    ] as const)('keeps raw parameters only when the driver %s', async (_label, capabilities) => {
        fixtures.database.activeCapabilities = capabilities;
        renderNotebook({
            params: typedParams,
            cells: [sqlCell('typed', 'SELECT @name'), sqlCell('raw', 'SELECT * FROM @tbl')],
        });

        expect(row('tbl').getByRole('combobox', {name: `${K}.type`})).toBeDisabled();
        expect(messageOf('name')).toHaveTextContent(`${K}.unsupportedDriver`);

        await click('Run typed');
        expect(savedCell('typed').error).toBe(`${K}.errors.unsupported @name`);
        expect(mockInvoke).not.toHaveBeenCalled();

        await click('Run raw');
        await waitFor(() => expect(executedQueries()).toEqual(['SELECT * FROM orders']));
    });

    it('drops the drafts of a notebook that an import replaces', async () => {
        renderNotebook({
            params: [{name: 'limit', value: '10', type: 'number'}],
            cells: [sqlCell('q', 'SELECT 1')],
        });
        fireEvent.change(valueOf('limit'), {target: {value: '50'}});
        expect(screen.getByText(`${K}.unapplied`)).toBeInTheDocument();

        vi.mocked(chooseNotebookImport).mockResolvedValue({
            title: 'Imported',
            state: {
                params: [{name: 'limit', value: '7', type: 'number'}],
                cells: [sqlCell('imported', 'SELECT 2')],
            },
        });
        await click('Import');

        await waitFor(() => expect(valueOf('limit')).toHaveValue('7'));
        expect(screen.queryByText(`${K}.unapplied`)).not.toBeInTheDocument();
    });

    it('freezes parameters for the plan and refreshes outdated input on the next run', async () => {
        const pending = Promise.withResolvers<typeof queryResult>();
        mockInvoke.mockReturnValueOnce(pending.promise);
        renderNotebook({
            params: [{name: 'limit', value: '10', type: 'number'}],
            cells: [
                sqlCell('source', 'SELECT @limit AS n'),
                sqlCell('use', 'SELECT * FROM {{cell_1}} LIMIT @limit'),
            ],
        });

        await click('Run All');
        expect(executedQueries()).toEqual(['SELECT 10 AS n']);
        fireEvent.change(valueOf('limit'), {target: {value: '50'}});
        await click(`${K}.apply`);
        await act(async () => pending.resolve(queryResult));
        expect(executedQueries()[1]).toContain('SELECT * FROM cell_1 LIMIT 10');
        expect(saved().params?.[0]?.value).toBe('50');

        await click('Run use');
        expect(executedQueries()[2]).toBe('SELECT 50 AS n');
        expect(executedQueries()[3]).toContain('SELECT * FROM cell_1 LIMIT 50');
    });

    it('runs with applied values until Apply, which executes nothing and marks the output outdated', async () => {
        renderNotebook({
            params: [{name: 'limit', value: '10', type: 'number'}],
            cells: [sqlCell('q', 'SELECT id FROM t LIMIT @limit', {name: 'Orders'})],
        });

        await click('Run q');
        await waitFor(() => expect(executedQueries()).toEqual(['SELECT id FROM t LIMIT 10']));

        // A draft changes neither the notebook nor what the next run sends.
        fireEvent.change(valueOf('limit'), {target: {value: '50'}});
        expect(saved().params).toEqual([{name: 'limit', value: '10', type: 'number'}]);
        await click('Run q');
        await waitFor(() => expect(executedQueries()).toHaveLength(2));
        expect(executedQueries()[1]).toBe('SELECT id FROM t LIMIT 10');

        // The draft is still there in the Report view's panel.
        await click('Report mode');
        expect(valueOf('limit')).toHaveValue('50');
        expect(screen.getByText(`${K}.unapplied`)).toBeInTheDocument();
        expect(screen.queryByText('editor.notebook.reportOutdated')).not.toBeInTheDocument();

        await click(`${K}.apply`);
        expect(saved().params).toEqual([{name: 'limit', value: '50', type: 'number'}]);
        expect(executedQueries()).toHaveLength(2);
        expect(screen.getByText('editor.notebook.reportOutdated')).toBeInTheDocument();
        expect(screen.queryByText(`${K}.unapplied`)).not.toBeInTheDocument();

        await click('Run All');
        await waitFor(() => expect(executedQueries()).toHaveLength(3));
        expect(executedQueries()[2]).toBe('SELECT id FROM t LIMIT 50');
        await waitFor(() =>
            expect(screen.queryByText('editor.notebook.reportOutdated')).not.toBeInTheDocument(),
        );

        // One Apply is one undo step.
        await click('Undo');
        expect(saved().params).toEqual([{name: 'limit', value: '10', type: 'number'}]);
        expect(valueOf('limit')).toHaveValue('10');
        expect(executedQueries()).toHaveLength(3);
    });
});
