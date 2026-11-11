import {useCallback, useLayoutEffect, useRef, useState, useImperativeHandle, type Ref} from 'react';
import {act, fireEvent, render, screen} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {Editor} from '@/pages/Editor';
import {EditorContext, type EditorContextType} from '@/contexts/EditorContext';
import {createAutoRefreshSchedule, type AutoRefreshSchedule} from '@/utils/autoRefresh';
import {countChunks, type QueryChunk, type StreamedQuery} from '@/api/queryStream';
import type {Tab, QueryResult} from '@/types/editor';
import type {DataGridCommandTarget} from '@/components/ui/DataGrid';

const mocks = vi.hoisted(() => ({
    connectionId: 'connection-1',
    addEntry: vi.fn(),
    guard: vi.fn().mockResolvedValue(true),
    noop: vi.fn(),
    location: {state: null, pathname: '/editor', key: 'test'},
    settings: {resultPageSize: 0, csvIncludeHeaders: true},
    capabilities: {schemas: true, sql_dialect: 'postgres', identifier_quote: '"'},
    t: (key: string, options?: {count?: number}) =>
        options?.count === undefined ? key : `${key}:${options.count}`,
    notify: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/utils/queryNotification', () => ({notifyQueryFinished: mocks.notify}));
vi.mock('react-i18next', () => ({useTranslation: () => ({t: mocks.t})}));
vi.mock('lucide-react', async (importOriginal) => await importOriginal());
vi.mock('react-router-dom', () => ({
    useLocation: () => mocks.location,
    useNavigate: () => mocks.noop,
}));
vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn().mockResolvedValue(() => {}),
    emit: vi.fn(),
}));
vi.mock('@/hooks/useDatabase', () => ({
    useDatabase: () => ({
        activeConnectionId: mocks.connectionId,
        activeDriver: 'postgres',
        activeSchema: 'public',
        activeCapabilities: mocks.capabilities,
        activeDatabaseName: 'testdb',
        activeConnectionName: 'Test',
        connections: [],
        tables: [],
        views: [],
        materializedViews: [],
        // The crux of the bug report: a plain PG connection has NOT opted into
        // multi-database browsing, so selectedDatabases is empty.
        selectedDatabases: [],
    }),
}));
vi.mock('@/hooks/useDrivers', () => ({useDrivers: () => ({allDrivers: []})}));
vi.mock('@/hooks/useSettings', () => ({useSettings: () => ({settings: mocks.settings})}));
vi.mock('@/hooks/useConnectionLayoutContext', () => ({
    useConnectionLayoutContext: () => ({explorerConnectionId: null}),
}));
vi.mock('@/hooks/useSavedQueries', () => ({
    useSavedQueries: () => ({saveQuery: mocks.noop}),
}));
vi.mock('@/hooks/useQueryHistory', () => ({
    useQueryHistory: () => ({addEntry: mocks.addEntry}),
}));
vi.mock('@/hooks/useKeybindings', () => ({
    useKeybindings: () => ({matchesShortcut: mocks.noop, isMac: false}),
}));
vi.mock('@/hooks/useAlert', () => ({useAlert: () => ({showAlert: mocks.noop})}));
vi.mock('@/hooks/useToast', () => ({useToast: () => ({showToast: mocks.noop})}));
vi.mock('@/hooks/useProductionGuard', () => ({useProductionGuard: () => mocks.guard}));
vi.mock('@/hooks/useQueryGuards', () => ({
    useQueryGuards: () => ({guardQuery: mocks.guard, pending: null, resolve: mocks.noop}),
}));
vi.mock('@/hooks/useSqlAutocompleteRegistration', () => ({
    useSqlAutocompleteRegistration: () => {},
}));
vi.mock('@/components/modals/AiQueryModal', () => ({AiQueryModal: () => null}));
vi.mock('@/components/modals/AiExplainModal', () => ({AiExplainModal: () => null}));
vi.mock('@/components/modals/VisualExplainModal', () => ({VisualExplainModal: () => null}));
vi.mock('@/components/modals/NewRowModal', () => ({NewRowModal: () => null}));
vi.mock('@/components/modals/QuerySelectionModal', () => ({
    QuerySelectionModal: () => null,
}));
vi.mock('@/components/modals/ConfirmModal', () => ({ConfirmModal: () => null}));
vi.mock('@/components/modals/ExplainSelectionModal', () => ({
    ExplainSelectionModal: () => null,
}));
vi.mock('@/components/modals/TabSwitcherModal', () => ({TabSwitcherModal: () => null}));
vi.mock('@/components/modals/QueryModal', () => ({QueryModal: () => null}));
vi.mock('@/components/modals/QueryParamsModal', () => ({QueryParamsModal: () => null}));
vi.mock('@/components/modals/ErrorModal', () => ({ErrorModal: () => null}));
vi.mock('@/components/modals/ExportProgressModal', () => ({
    ExportProgressModal: () => null,
}));
vi.mock('@/components/ui/AiDropdownButton', () => ({AiDropdownButton: () => null}));
vi.mock('@/components/ui/MultiResultPanel', () => ({MultiResultPanel: () => null}));
vi.mock('@/components/ui/VisualQueryBuilder', () => ({VisualQueryBuilder: () => null}));
vi.mock('@/components/ui/ContextMenu', () => ({ContextMenu: () => null}));
vi.mock('@/components/ui/SqlEditorWrapper', () => ({SqlEditorWrapper: () => null}));
vi.mock('@/components/ui/RelatedRecordsPanel', () => ({RelatedRecordsPanel: () => null}));
vi.mock('@/components/notebook/NotebookView', () => ({NotebookView: () => null}));
vi.mock('@/components/users/UserManagementView', () => ({UserManagementView: () => null}));
vi.mock('@/components/layout/CommandPaletteScopeBridge', () => ({
    CommandPaletteScopeBridge: () => null,
}));
vi.mock('@/components/ui/DataGrid', () => ({
    DataGrid: function Grid({ref, data}: {ref: Ref<DataGridCommandTarget>; data: unknown[][]}) {
        useImperativeHandle(ref, () => ({isEditing: () => false, getResultCommands: () => ({})}));
        return (
            <div data-testid="grid">
                {data.length}:{JSON.stringify(data[0])}..{JSON.stringify(data.at(-1))}
            </div>
        );
    },
}));
vi.mock('@/hooks/useTabularisClient', () => ({useTabularisClient: () => client}));
vi.mock('@/hooks/usePlatformCapabilities', () => ({
    usePlatformCapabilities: () => ({
        negotiation: {environment: 'browser'},
        subscribeRouteEvent: vi.fn().mockResolvedValue(() => {}),
        publishRouteEvent: vi.fn().mockResolvedValue(undefined),
    }),
}));

const client = {
    call: vi.fn(),
    subscribe: vi.fn().mockResolvedValue(() => {}),
    streamQuery: vi.fn(),
};

const consoleTab = (): Tab => ({
    id: 'console-1',
    connectionId: 'connection-1',
    title: 'console-1',
    type: 'console',
    query: 'SELECT n FROM numbers',
    result: null,
    error: '',
    executionTime: null,
    page: 1,
    activeTable: null,
    pkColumns: null,
    isEditorOpen: true,
});

const rows = (from: number, to: number) =>
    Array.from({length: to - from + 1}, (_, index) => [from + index]);

const reply = (chunks: number): StreamedQuery => ({
    affected_rows: 0,
    server_time_ms: null,
    fetch_time_ms: null,
    in_transaction: false,
    chunks,
    truncated: false,
});

/** The stream the Editor started; the test hands it chunks and ends it. */
let stream: {
    send: (chunk: QueryChunk) => void;
    finish: (reply: StreamedQuery) => void;
    fail: (error: unknown) => void;
};

let context: EditorContextType;
function Harness({initialTabs = [consoleTab()]}: {initialTabs?: Tab[]}) {
    const [tabs, setTabs] = useState(initialTabs);
    const [activeTabId, setActiveTabId] = useState(initialTabs[0].id);
    const schedules = useRef(new Map<string, AutoRefreshSchedule>());
    const getAutoRefreshSchedule = useCallback((id: string) => {
        let schedule = schedules.current.get(id);
        if (!schedule) {
            schedule = createAutoRefreshSchedule();
            schedules.current.set(id, schedule);
        }
        return schedule;
    }, []);
    const updateTab = useCallback<EditorContextType['updateTab']>((id, partial) => {
        setTabs((tabs) =>
            tabs.map((tab) =>
                tab.id === id
                    ? {...tab, ...(typeof partial === 'function' ? partial(tab) : partial)}
                    : tab,
            ),
        );
    }, []);
    const value = {
        tabs,
        activeTabId,
        activeTab: tabs.find((tab) => tab.id === activeTabId) ?? null,
        getAutoRefreshSchedule,
        updateTab,
        setActiveTabId,
        addTab: mocks.noop,
        openNotebook: mocks.noop,
        closeTab: mocks.noop,
        closeAllTabs: mocks.noop,
        closeOtherTabs: mocks.noop,
        closeTabsToLeft: mocks.noop,
        closeTabsToRight: mocks.noop,
        reorderTab: mocks.noop,
        updateResultEntry: mocks.noop,
        getSchema: mocks.noop,
        reopenClosedTab: mocks.noop,
        canReopenClosedTab: false,
    } as EditorContextType;
    useLayoutEffect(() => {
        context = value;
    });
    return (
        <EditorContext.Provider value={value}>
            <Editor />
        </EditorContext.Provider>
    );
}

const grid = () => screen.getByTestId('grid').textContent;

async function run() {
    await act(async () => {
        fireEvent.click(screen.getByRole('button', {name: /^editor\.run/}));
    });
}

async function send(chunk: QueryChunk) {
    await act(async () => stream.send(chunk));
}

describe('streamed query results', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.settings.resultPageSize = 0;
        client.call.mockResolvedValue(null);
        client.streamQuery.mockImplementation(
            (_request: unknown, onChunk: (chunk: QueryChunk) => void) =>
                new Promise<StreamedQuery>((resolve, reject) => {
                    stream = {send: onChunk, finish: resolve, fail: reject};
                }),
        );
    });

    it('with page size 0, the grid shows the first batch, then appends batches until it shows all rows', async () => {
        render(<Harness />);
        await run();
        expect(client.streamQuery).toHaveBeenCalledWith(
            expect.objectContaining({query: 'SELECT n FROM numbers', sessionId: 'console-1'}),
            expect.any(Function),
            expect.objectContaining({requestId: expect.any(String)}),
        );
        expect(client.call).not.toHaveBeenCalledWith(
            'execute_query',
            expect.anything(),
            expect.anything(),
        );

        await send({columns: ['n']});
        await send({rows: rows(1, 500)});
        expect(grid()).toBe('500:[1]..[500]');

        await send({rows: rows(501, 10_500)});
        expect(grid()).toBe('10500:[1]..[10500]');

        await send({rows: rows(10_501, 20_500)});
        expect(screen.getByText(/^editor\.rowsRetrieved:20500/)).toBeInTheDocument();

        await act(async () => stream.finish(reply(4)));
        expect(grid()).toBe('20500:[1]..[20500]');
        expect(screen.getByText(/^editor\.rowsRetrieved:20500/)).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: 'pagination.nextPage'})).toBeNull();
    });

    it('with page size 500, the grid shows 500 rows, and paging works as before', async () => {
        mocks.settings.resultPageSize = 500;
        const page = (number: number): QueryResult => ({
            columns: ['n'],
            rows: rows((number - 1) * 500 + 1, number * 500),
            affected_rows: 0,
            pagination: {page: number, page_size: 500, total_rows: null, has_more: number === 1},
        });
        client.call.mockImplementation((command: string, request: {page?: number}) =>
            Promise.resolve(command === 'execute_query' ? page(request.page ?? 1) : null),
        );
        render(<Harness />);

        await run();
        expect(grid()).toBe('500:[1]..[500]');
        expect(client.call).toHaveBeenCalledWith(
            'execute_query',
            expect.objectContaining({limit: 500, page: 1}),
            expect.anything(),
        );

        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: 'pagination.nextPage'}));
        });
        expect(grid()).toBe('500:[501]..[1000]');
        expect(client.call).toHaveBeenCalledWith(
            'execute_query',
            expect.objectContaining({limit: 500, page: 2}),
            expect.anything(),
        );
        expect(client.streamQuery).not.toHaveBeenCalled();
    });

    it('cancelling a running stream from the UI stops the grid from adding rows', async () => {
        render(<Harness />);
        await run();
        await send({columns: ['n']});
        await send({rows: rows(1, 500)});

        await act(async () => {
            fireEvent.click(screen.getByRole('button', {name: /editor\.stop/}));
        });
        expect(client.call).toHaveBeenCalledWith('cancel_query', {
            connectionId: 'connection-1',
            queryRequestId: expect.any(String),
        });

        await send({rows: rows(501, 10_500)});
        await act(async () => stream.fail(new Error('Query cancelled')));

        expect(grid()).toBe('500:[1]..[500]');
        expect(screen.getByText(/^editor\.rowsRetrieved:500/)).toBeInTheDocument();
    });

    it('when the reply has arrived but stream chunks are still missing after 5 seconds, the run fails with an error and the loading state clears', async () => {
        vi.useFakeTimers();
        try {
            client.streamQuery.mockImplementation(
                async (_request: unknown, onChunk: (chunk: QueryChunk) => void) => {
                    const chunks = countChunks(onChunk);
                    stream = {send: chunks.deliver, finish: () => {}, fail: () => {}};
                    await chunks.until(2);
                    return reply(2);
                },
            );
            render(<Harness />);
            await run();
            await send({columns: ['n']});
            expect(screen.getByRole('button', {name: /editor\.stop/})).toBeInTheDocument();

            await act(async () => {
                await vi.advanceTimersByTimeAsync(5_000);
            });

            expect(context.activeTab?.error).toMatch(/Stream incomplete/);
            expect(context.activeTab?.isLoading).toBe(false);
            expect(screen.queryByRole('button', {name: /editor\.stop/})).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });
});
