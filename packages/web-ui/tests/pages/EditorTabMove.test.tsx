import {useCallback, useRef, useState} from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {invoke} from '@tauri-apps/api/core';
import {Editor} from '@/pages/Editor';
import {EditorContext, type EditorContextType} from '@/contexts/EditorContext';
import {createAutoRefreshSchedule, type AutoRefreshSchedule} from '@/utils/autoRefresh';
import type {Tab} from '@/types/editor';

const mocks = vi.hoisted(() => ({
    noop: vi.fn(),
    reorderTab: vi.fn(),
    setTabPinned: vi.fn(),
    closeOtherTabs: vi.fn(),
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
vi.mock('@/hooks/useTabularisClient', () => import('../support/tauriBackedHooks'));
vi.mock('@/hooks/usePlatformCapabilities', () => import('../support/tauriBackedHooks'));
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
        closeOtherTabs: mocks.closeOtherTabs,
        closeTabsToLeft: mocks.noop,
        closeTabsToRight: mocks.noop,
        reorderTab: mocks.reorderTab,
        setTabPinned: mocks.setTabPinned,
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

const tabs = [
    baseTab({id: 'first', title: 'First'}),
    baseTab({id: 'middle', title: 'Middle'}),
    baseTab({id: 'last', title: 'Last'}),
];

const openTabMenu = (title: string) => {
    fireEvent.contextMenu(screen.getByRole('button', {name: title}));
    return {
        moveLeft: screen.getByRole('button', {name: 'editor.moveTabLeft'}),
        moveRight: screen.getByRole('button', {name: 'editor.moveTabRight'}),
    };
};

describe('Editor tab context menu move actions (#1160)', () => {
    beforeEach(() => {
        mocks.reorderTab.mockReset();
        vi.mocked(invoke).mockReset();
        vi.mocked(invoke).mockResolvedValue([]);
    });

    it('disables Move Left on the first tab and moves it one gap right', () => {
        render(<Harness initialTabs={tabs} />);
        const {moveLeft, moveRight} = openTabMenu('First');

        expect(moveLeft).toBeDisabled();
        expect(moveRight).toBeEnabled();
        fireEvent.click(moveLeft);
        expect(mocks.reorderTab).not.toHaveBeenCalled();

        fireEvent.click(moveRight);
        expect(mocks.reorderTab).toHaveBeenCalledExactlyOnceWith('first', 2);
    });

    it('disables Move Right on the last tab and moves it one gap left', () => {
        render(<Harness initialTabs={tabs} />);
        const {moveLeft, moveRight} = openTabMenu('Last');

        expect(moveRight).toBeDisabled();
        fireEvent.click(moveLeft);
        expect(mocks.reorderTab).toHaveBeenCalledExactlyOnceWith('last', 1);
    });

    it('activates a move action from the keyboard', async () => {
        const user = userEvent.setup();
        render(<Harness initialTabs={tabs} />);
        const {moveLeft} = openTabMenu('Middle');

        moveLeft.focus();
        await user.keyboard('{Enter}');
        expect(mocks.reorderTab).toHaveBeenCalledExactlyOnceWith('middle', 0);
    });
});

describe('Editor tab pinning (#1304)', () => {
    // The pinned tab comes first, like in the tab bar, and has unsaved file changes.
    const pinnedTabs = [
        baseTab({
            id: 'sessions',
            title: 'Sessions',
            pinned: true,
            sourceFilePath: '/queries/sessions.sql',
            sourceFileDirty: true,
        }),
        baseTab({id: 'scratch', title: 'Scratch'}),
        baseTab({id: 'report', title: 'Report'}),
    ];

    beforeEach(() => {
        mocks.setTabPinned.mockReset();
        mocks.closeOtherTabs.mockReset();
        vi.mocked(invoke).mockReset();
        vi.mocked(invoke).mockResolvedValue([]);
    });

    it('pins and unpins a tab from its context menu', () => {
        render(<Harness initialTabs={pinnedTabs} />);

        fireEvent.contextMenu(screen.getByRole('button', {name: 'Scratch'}));
        fireEvent.click(screen.getByRole('button', {name: 'editor.pinTab'}));
        expect(mocks.setTabPinned).toHaveBeenCalledExactlyOnceWith('scratch', true);

        fireEvent.contextMenu(screen.getByRole('button', {name: 'Sessions'}));
        fireEvent.click(screen.getByRole('button', {name: 'editor.unpinTab'}));
        expect(mocks.setTabPinned).toHaveBeenLastCalledWith('sessions', false);
    });

    it('describes a pinned tab as pinned to screen readers', () => {
        render(<Harness initialTabs={pinnedTabs} />);

        expect(screen.getByRole('button', {name: 'Sessions'})).toHaveAccessibleDescription(
            expect.stringContaining('editor.pinnedTab'),
        );
        expect(screen.getByRole('button', {name: 'Scratch'})).not.toHaveAttribute(
            'aria-describedby',
        );
    });

    it('does not move the first unpinned tab in front of a pinned tab', () => {
        render(<Harness initialTabs={pinnedTabs} />);
        const {moveLeft, moveRight} = openTabMenu('Scratch');

        expect(moveLeft).toBeDisabled();
        expect(moveRight).toBeEnabled();
    });

    it("closes other tabs without asking about a pinned tab's unsaved file, which stays open", () => {
        render(<Harness initialTabs={pinnedTabs} />);

        fireEvent.contextMenu(screen.getByRole('button', {name: 'Report'}));
        fireEvent.click(screen.getByRole('button', {name: 'editor.closeOthers'}));

        expect(mocks.closeOtherTabs).toHaveBeenCalledExactlyOnceWith('report');
    });
});
