import {useLayoutEffect, useState, useCallback} from 'react';
import {act, fireEvent, render, screen} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {Editor} from '@/pages/Editor';
import {EditorContext, type EditorContextType} from '@/contexts/EditorContext';
import {createAutoRefreshSchedule} from '@/utils/autoRefresh';
import {resetResultChartStates} from '@/hooks/useResultChartState';
import type {Tab, QueryResult} from '@/types/editor';

const mocks = vi.hoisted(() => ({
    connectionId: 'connection-1',
    guard: vi.fn().mockResolvedValue(true),
    noop: vi.fn(),
    location: {state: null, pathname: '/editor', key: 'test'},
    settings: {resultPageSize: 100, csvIncludeHeaders: true},
    capabilities: {schemas: true, sql_dialect: 'postgresql', identifier_quote: '"'},
    t: (key: string, options?: Record<string, unknown>) =>
        key === 'toolbar.autoRefresh.failed' ? String(options?.error) : key,
    sqlOnChange: new Map<string, (value: string) => void>(),
    client: {
        call: vi.fn().mockResolvedValue(null),
        subscribe: vi.fn().mockResolvedValue(() => {}),
    },
    platform: {
        negotiation: {environment: 'browser'},
        subscribeRouteEvent: vi.fn().mockResolvedValue(() => {}),
        publishRouteEvent: vi.fn().mockResolvedValue(undefined),
    },
}));
vi.mock('@/hooks/useTabularisClient', () => ({useTabularisClient: () => mocks.client}));
vi.mock('@/hooks/usePlatformCapabilities', () => ({
    usePlatformCapabilities: () => mocks.platform,
}));
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
        activeDatabaseName: 'test',
        activeConnectionName: 'Test',
        connections: [],
        tables: [],
        views: [],
        materializedViews: [],
        selectedDatabases: [],
    }),
}));
vi.mock('@/hooks/useDrivers', () => ({useDrivers: () => ({allDrivers: []})}));
vi.mock('@/hooks/useSettings', () => ({useSettings: () => ({settings: mocks.settings})}));
vi.mock('@/hooks/useConnectionLayoutContext', () => ({
    useConnectionLayoutContext: () => ({explorerConnectionId: null}),
}));
vi.mock('@/hooks/useSavedQueries', () => ({useSavedQueries: () => ({saveQuery: mocks.noop})}));
vi.mock('@/hooks/useQueryHistory', () => ({useQueryHistory: () => ({addEntry: mocks.noop})}));
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
vi.mock('@/components/modals/QuerySelectionModal', () => ({QuerySelectionModal: () => null}));
vi.mock('@/components/modals/ConfirmModal', () => ({ConfirmModal: () => null}));
vi.mock('@/components/modals/ExplainSelectionModal', () => ({ExplainSelectionModal: () => null}));
vi.mock('@/components/modals/TabSwitcherModal', () => ({TabSwitcherModal: () => null}));
vi.mock('@/components/modals/QueryModal', () => ({QueryModal: () => null}));
vi.mock('@/components/modals/QueryParamsModal', () => ({QueryParamsModal: () => null}));
vi.mock('@/components/modals/ErrorModal', () => ({ErrorModal: () => null}));
vi.mock('@/components/modals/ExportProgressModal', () => ({ExportProgressModal: () => null}));
vi.mock('@/components/ui/AiDropdownButton', () => ({AiDropdownButton: () => null}));
vi.mock('@/components/ui/MultiResultPanel', () => ({MultiResultPanel: () => null}));
vi.mock('@/components/ui/VisualQueryBuilder', () => ({VisualQueryBuilder: () => null}));
vi.mock('@/components/ui/ContextMenu', () => ({ContextMenu: () => null}));
vi.mock('@/components/ui/SqlEditorWrapper', () => ({
    SqlEditorWrapper: ({
        editorKey,
        onChange,
    }: {
        editorKey: string;
        onChange: (value: string) => void;
    }) => {
        mocks.sqlOnChange.set(editorKey, onChange);
        return null;
    },
}));
vi.mock('@/components/ui/RelatedRecordsPanel', () => ({RelatedRecordsPanel: () => null}));
vi.mock('@/components/notebook/NotebookView', () => ({NotebookView: () => null}));
vi.mock('@/components/users/UserManagementView', () => ({UserManagementView: () => null}));
vi.mock('@/components/layout/CommandPaletteScopeBridge', () => ({
    CommandPaletteScopeBridge: () => null,
}));
vi.mock('@/components/ui/DataGrid', () => ({
    DataGrid: ({
        selectedRows,
        pendingChanges,
    }: {
        selectedRows: Set<number>;
        pendingChanges?: Record<string, unknown>;
    }) => (
        <div data-testid="grid">
            <span data-testid="grid-selection">{JSON.stringify([...selectedRows])}</span>
            <span data-testid="grid-pending">{JSON.stringify(pendingChanges ?? {})}</span>
        </div>
    ),
}));
vi.mock('@/hooks/useChartPalette', () => ({
    useChartPalette: () => ({
        series: ['var(--a)', 'var(--b)'],
        categorical: ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'],
        grid: 'var(--grid)',
        tick: 'var(--tick)',
        axis: 'var(--axis)',
        surface: 'var(--surface)',
        cursor: 'var(--cursor)',
        tooltipBackground: 'var(--tooltip)',
        tooltipBorder: 'var(--border)',
        tooltipText: 'var(--text)',
        radius: '4px',
        barRadius: 4,
    }),
    chartTooltipStyle: () => ({}),
}));
vi.mock('@/components/ui/ResultChartPlot', () => ({
    ResultChartPlot: ({type}: {type: string}) => <div data-testid={`${type}-chart`} />,
}));

const salesResult: QueryResult = {
    columns: ['region', 'revenue'],
    rows: [
        ['North', 100],
        ['South', 200],
    ],
    affected_rows: 0,
    pagination: {page: 1, page_size: 100, total_rows: null, has_more: false},
};
const consoleTab = (id = 'console-1'): Tab => ({
    id,
    connectionId: 'connection-1',
    title: id,
    type: 'console',
    query: 'SELECT region, revenue FROM sales',
    result: salesResult,
    error: '',
    executionTime: 3,
    page: 1,
    activeTable: 'sales',
    pkColumns: ['region'],
    selectedRows: [1],
    pendingChanges: {'0': {pkOriginalValue: 'North', changes: {revenue: 150}}},
});
const tableTab = (id = 'table-1'): Tab => ({
    ...consoleTab(id),
    type: 'table',
    query: 'SELECT * FROM "sales"',
});

function Harness({initialTabs}: {initialTabs: Tab[]}) {
    const [tabs, setTabs] = useState(initialTabs);
    const [activeTabId, setActiveTabId] = useState(initialTabs[0].id);
    const getAutoRefreshSchedule = useCallback(() => createAutoRefreshSchedule(), []);
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
        getRecentTabIds: () => [],
    } as EditorContextType;
    useLayoutEffect(() => {
        switchTab = setActiveTabId;
    });
    return (
        <EditorContext.Provider value={value}>
            <Editor />
        </EditorContext.Provider>
    );
}
let switchTab: (id: string) => void = () => {};

const cleanTab = (id = 'console-1'): Tab => ({...consoleTab(id), pendingChanges: undefined});

const gridOnlyActions = [
    'editor.newRow',
    'dataGrid.deleteRow',
    'settings.copyFormat',
    'settings.csvDelimiter',
    'settings.csvIncludeHeaders',
];
const expectGridOnlyActions = (present: boolean) => {
    for (const title of gridOnlyActions) {
        if (present) expect(screen.getByTitle(title)).toBeInTheDocument();
        else expect(screen.queryByTitle(title)).not.toBeInTheDocument();
    }
};

const chartButton = () => screen.getByRole('button', {name: 'editor.resultChart.viewChart'});
const gridButton = () => screen.getByRole('button', {name: 'editor.resultChart.viewGrid'});

describe('Editor result grid/chart toggle', () => {
    beforeEach(() => {
        resetResultChartStates();
    });

    it("switches a query tab's result to a chart and back without losing selection or pending edits", async () => {
        render(<Harness initialTabs={[consoleTab()]} />);
        expect(gridButton()).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('grid-selection')).toHaveTextContent('[1]');

        fireEvent.click(chartButton());
        expect(screen.queryByTestId('grid')).not.toBeInTheDocument();
        expect(await screen.findByTestId('bar-chart')).toBeInTheDocument();
        expect(screen.getByLabelText('editor.resultChart.xAxis')).toHaveDisplayValue('region');

        fireEvent.click(gridButton());
        expect(screen.getByTestId('grid-selection')).toHaveTextContent('[1]');
        expect(screen.getByTestId('grid-pending')).toHaveTextContent('revenue');
    });

    it('keeps the chart choice per tab', async () => {
        render(<Harness initialTabs={[consoleTab('a'), consoleTab('b')]} />);
        fireEvent.click(chartButton());
        expect(await screen.findByTestId('bar-chart')).toBeInTheDocument();

        act(() => switchTab('b'));
        expect(screen.getByTestId('grid')).toBeInTheDocument();

        act(() => switchTab('a'));
        expect(await screen.findByTestId('bar-chart')).toBeInTheDocument();
    });

    it('does not offer the toggle on table tabs', () => {
        render(<Harness initialTabs={[tableTab()]} />);
        expect(screen.getByTestId('grid')).toBeInTheDocument();
        expect(
            screen.queryByRole('group', {name: 'editor.resultChart.viewLabel'}),
        ).not.toBeInTheDocument();
    });
});

describe('Editor data toolbar in chart view', () => {
    beforeEach(() => {
        resetResultChartStates();
    });

    it('shows the row and copy actions in grid view', () => {
        render(<Harness initialTabs={[consoleTab()]} />);
        expectGridOnlyActions(true);
        expect(screen.getByTitle('editor.newRow')).toBeEnabled();
        expect(screen.getByTitle('editor.submitChanges')).toBeInTheDocument();
        expect(screen.getByTitle('editor.rollbackChanges')).toBeInTheDocument();
    });

    it('keeps the toolbar in grid view when nothing is pending', () => {
        render(<Harness initialTabs={[cleanTab()]} />);
        expectGridOnlyActions(true);
        expect(screen.queryByTitle('editor.submitChanges')).not.toBeInTheDocument();
    });

    it('drops the row and copy actions in chart view but keeps the pending bar', async () => {
        render(<Harness initialTabs={[consoleTab()]} />);
        fireEvent.click(chartButton());

        expect(await screen.findByTestId('bar-chart')).toBeInTheDocument();
        expectGridOnlyActions(false);
        expect(screen.getByTitle('editor.submitChanges')).toBeInTheDocument();
        expect(screen.getByTitle('editor.rollbackChanges')).toBeInTheDocument();
        expect(screen.getByText('editor.pendingCount')).toBeInTheDocument();
    });

    it('can roll back pending edits from chart view, then hides the toolbar', () => {
        render(<Harness initialTabs={[consoleTab()]} />);
        fireEvent.click(chartButton());

        fireEvent.click(screen.getByRole('checkbox', {name: 'editor.applyToAll'}));
        fireEvent.click(screen.getByTitle('editor.rollbackChanges'));

        expect(screen.queryByTitle('editor.rollbackChanges')).not.toBeInTheDocument();
        expect(screen.queryByTitle('editor.undoGridEdit')).not.toBeInTheDocument();
        expectGridOnlyActions(false);

        fireEvent.click(gridButton());
        expect(screen.getByTestId('grid-pending')).toHaveTextContent('{}');
        expectGridOnlyActions(true);
        expect(screen.getByTitle('editor.undoGridEdit')).toBeEnabled();
    });

    it('shows no toolbar in chart view when nothing is pending', () => {
        render(<Harness initialTabs={[cleanTab()]} />);
        fireEvent.click(chartButton());

        expectGridOnlyActions(false);
        expect(screen.queryByTitle('editor.submitChanges')).not.toBeInTheDocument();
        expect(screen.queryByTitle('editor.undoGridEdit')).not.toBeInTheDocument();
    });
});
