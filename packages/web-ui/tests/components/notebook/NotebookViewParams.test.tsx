import type {ComponentProps} from 'react';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {invoke} from '@tauri-apps/api/core';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {NotebookView} from '@/components/notebook/NotebookView';
import type {NotebookCellWrapper} from '@/components/notebook/NotebookCellWrapper';
import type {NotebookToolbar} from '@/components/notebook/NotebookToolbar';
import type {QueryResult, Tab} from '@/types/editor';
import type {NotebookCell, NotebookParam, NotebookState} from '@/types/notebook';
import type {DriverCapabilities} from '@/types/plugins';
import {chooseNotebookImport} from '@/utils/notebookTransfer';

// The real Parameters panel and Report view run here, on the notebook's own
// state and execution path; only the cell editor and the toolbar are replaced.
vi.mock('lucide-react', async (importOriginal) => await importOriginal());
vi.mock('@/hooks/useTabularisClient', () => import('../../support/tauriBackedHooks'));
vi.mock('@/hooks/usePlatformCapabilities', () => import('../../support/tauriBackedHooks'));
const fixtures = vi.hoisted(() => ({
    notebooks: new Map<string, NotebookState>(),
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
vi.mock('@/utils/notebookStore', () => ({
    getNotebookState: vi.fn((id: string) => fixtures.notebooks.get(id)),
    setNotebookState: vi.fn((id: string, state: NotebookState) => {
        fixtures.notebooks.set(id, state);
    }),
    loadNotebook: vi.fn(),
    setNotebookTitle: vi.fn(),
    createNotebookFromState: vi.fn().mockResolvedValue({notebookId: 'imported'}),
}));
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
    };
    return render(
        <NotebookView tab={tab} updateTab={vi.fn()} connectionId={connectionId} isActive />,
    );
}

const saved = () => fixtures.notebooks.get(notebookId) as NotebookState;
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

describe('NotebookView typed parameters', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        fixtures.notebooks.clear();
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
        expect(fixtures.guardQuery).toHaveBeenCalledExactlyOnceWith(expected);
        expect(savedCell('q').error).toBeUndefined();
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
        expect(row('start').getByRole('alert')).toHaveTextContent(`${K}.issues.invalidDate`);
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
        expect(row('name').getByRole('alert')).toHaveTextContent(`${K}.unsupportedDriver`);

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
