import {useCallback, useRef, useState} from 'react';
import {render, screen} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {invoke} from '@tauri-apps/api/core';
import {Editor} from '@/pages/Editor';
import {EditorContext, type EditorContextType} from '@/contexts/EditorContext';
import {createAutoRefreshSchedule, type AutoRefreshSchedule} from '@/utils/autoRefresh';
import type {Tab} from '@/types/editor';

// Issue #1132: long tab titles are truncated with an ellipsis, so tabs that
// share a prefix ("global-mae_fi…", "global-mae_af…") cannot be told apart.
// Drives the real Editor tab strip and checks each tab exposes its full,
// qualified name as a tooltip and as its accessible name.

const mocks = vi.hoisted(() => ({
    noop: vi.fn(),
    guard: vi.fn().mockResolvedValue(true),
    location: {state: null, pathname: '/editor', key: 'test'},
    settings: {resultPageSize: 100, csvIncludeHeaders: true},
    capabilities: {schemas: true, sql_dialect: 'postgres', identifier_quote: '"'} as Record<
        string,
        unknown
    >,
    selectedDatabases: [] as string[],
    t: (key: string) => key,
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
        activeConnectionId: 'connection-1',
        activeDriver: 'postgres',
        activeSchema: 'public',
        activeCapabilities: mocks.capabilities,
        activeDatabaseName: 'testdb',
        activeConnectionName: 'Test',
        connections: [],
        tables: [],
        views: [],
        materializedViews: [],
        selectedDatabases: mocks.selectedDatabases,
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
    useQueryHistory: () => ({addEntry: mocks.noop}),
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
vi.mock('@/components/ui/TableToolbar', () => ({TableToolbar: () => null}));
vi.mock('@/components/ui/RelatedRecordsPanel', () => ({RelatedRecordsPanel: () => null}));
vi.mock('@/components/ui/DataGrid', () => ({DataGrid: () => null}));
vi.mock('@/components/notebook/NotebookView', () => ({NotebookView: () => null}));
vi.mock('@/components/users/UserManagementView', () => ({UserManagementView: () => null}));
vi.mock('@/components/layout/CommandPaletteScopeBridge', () => ({
    CommandPaletteScopeBridge: () => null,
}));

const baseTab = (overrides: Partial<Tab>): Tab => ({
    id: 'tab',
    connectionId: 'connection-1',
    title: 'tab',
    type: 'console',
    query: '',
    result: null,
    error: '',
    executionTime: null,
    page: 1,
    activeTable: null,
    pkColumns: null,
    isEditorOpen: false,
    ...overrides,
});
const tableTab = (id: string, table: string, extra: Partial<Tab> = {}): Tab =>
    baseTab({id, title: table, type: 'table', activeTable: table, ...extra});

function Harness({initialTabs}: {initialTabs: Tab[]}) {
    const [tabs] = useState(initialTabs);
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
    const value = {
        tabs,
        activeTabId,
        activeTab: tabs.find((tab) => tab.id === activeTabId) ?? null,
        getAutoRefreshSchedule,
        updateTab: mocks.noop,
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
    return (
        <EditorContext.Provider value={value}>
            <Editor />
        </EditorContext.Provider>
    );
}

describe('Editor tab strip full titles (#1132)', () => {
    beforeEach(() => {
        mocks.capabilities = {schemas: true, sql_dialect: 'postgres', identifier_quote: '"'};
        mocks.selectedDatabases = [];
        vi.mocked(invoke).mockReset();
        vi.mocked(invoke).mockResolvedValue([]);
    });

    it('gives tabs sharing a long prefix their full, schema-qualified name as tooltip and accessible name', () => {
        render(
            <Harness
                initialTabs={[
                    baseTab({id: 'console-1', title: 'Console'}),
                    tableTab('t1', 'global-mae_firewall_events', {schema: 'public'}),
                    tableTab('t2', 'global-mae_affiliate_payouts', {schema: 'public'}),
                ]}
            />,
        );

        const firewall = screen.getByRole('button', {name: 'public.global-mae_firewall_events'});
        const payouts = screen.getByRole('button', {name: 'public.global-mae_affiliate_payouts'});
        expect(firewall).toHaveAttribute('title', 'public.global-mae_firewall_events');
        expect(payouts).toHaveAttribute('title', 'public.global-mae_affiliate_payouts');
        // The visible (truncated) label is still part of the accessible name.
        expect(firewall).toHaveTextContent('global-mae_firewall_events');
    });

    it('includes the database for tabs of a multi-database driver', () => {
        render(
            <Harness
                initialTabs={[
                    baseTab({id: 'console-1', title: 'Console'}),
                    tableTab('t1', 'global-mae_zones', {schema: 'public', database: 'analytics'}),
                ]}
            />,
        );

        const tab = screen.getByRole('button', {name: 'analytics.public.global-mae_zones'});
        expect(tab).toHaveAttribute('title', 'analytics.public.global-mae_zones');
    });

    it('names a console tab with the database it runs against in a multi-database layout', () => {
        mocks.capabilities = {schemas: false, file_based: false, sql_dialect: 'mysql'};
        mocks.selectedDatabases = ['sales', 'hr'];
        render(
            <Harness initialTabs={[baseTab({id: 'console-1', title: 'Console', schema: 'hr'})]} />,
        );

        const tab = screen.getByRole('button', {name: 'Console (hr)'});
        expect(tab).toHaveAttribute('title', 'Console (hr)');
    });

    it("still announces a SQL file's unsaved marker, as the tab's description", () => {
        render(
            <Harness
                initialTabs={[
                    baseTab({
                        id: 'file-1',
                        title: 'report.sql',
                        sourceFilePath: '/tmp/report.sql',
                        sourceFileDirty: true,
                    }),
                    baseTab({id: 'file-2', title: 'clean.sql', sourceFilePath: '/tmp/clean.sql'}),
                ]}
            />,
        );

        const dirty = screen.getByRole('button', {name: 'report.sql'});
        expect(dirty).toHaveAccessibleDescription('editor.sqlFileUnsavedChanges');
        // The visible dot stays, but is not read out as "bullet".
        expect(dirty).toHaveTextContent('report.sql •');
        const clean = screen.getByRole('button', {name: 'clean.sql'});
        expect(clean).not.toHaveAttribute('aria-describedby');
    });
});
