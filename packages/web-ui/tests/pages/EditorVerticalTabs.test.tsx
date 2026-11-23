import {useCallback, useRef, useState} from 'react';
import {createEvent, fireEvent, render, screen} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
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
    settings: {resultPageSize: 100, csvIncludeHeaders: true} as Record<string, unknown>,
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

const tabEl = (title: string) => screen.getByRole('button', {name: title});

// jsdom has no DragEvent, so pointer coordinates are attached by hand.
const dragOver = (el: HTMLElement, point: {clientX: number; clientY: number}) => {
    const event = createEvent.dragOver(el, {
        dataTransfer: {dropEffect: '', effectAllowed: '', setData: vi.fn()},
    });
    Object.defineProperty(event, 'clientX', {value: point.clientX});
    Object.defineProperty(event, 'clientY', {value: point.clientY});
    fireEvent(el, event);
};

// Drags "First" over the left part of the bottom half of "Last" (a 224x32
// tab) and drops it: vertically that is after "Last", horizontally before it.
const dragFirstOntoLast = () => {
    const dataTransfer = {dropEffect: '', effectAllowed: '', setData: vi.fn()};
    fireEvent.dragStart(tabEl('First'), {dataTransfer});
    const last = tabEl('Last');
    last.getBoundingClientRect = () =>
        ({top: 0, bottom: 32, left: 0, right: 224, width: 224, height: 32}) as DOMRect;
    dragOver(last, {clientX: 20, clientY: 28});
    fireEvent.drop(last, {dataTransfer});
};

describe('Editor vertical tab layout (#1646)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.settings = {resultPageSize: 100, csvIncludeHeaders: true};
    });

    it('keeps the horizontal tab bar by default', () => {
        const {container} = render(<Harness initialTabs={tabs} />);
        const scroller = tabEl('First').parentElement!;
        expect(scroller.className).toContain('overflow-x-auto');
        expect(scroller.className).not.toContain('flex-col');
        expect(container.querySelector('.pl-56')).toBeNull();
    });

    it('lists the tabs in a column on the left in vertical mode', () => {
        mocks.settings = {...mocks.settings, tabLayout: 'vertical'};
        const {container} = render(<Harness initialTabs={tabs} />);
        const scroller = tabEl('First').parentElement!;
        expect(scroller.className).toContain('flex-col');
        expect(scroller.className).toContain('overflow-y-auto');
        expect(container.querySelector('.pl-56')).not.toBeNull();
        expect(tabEl('First').className).toContain('w-full');
    });

    it('reorders along the vertical axis in vertical mode', () => {
        mocks.settings = {...mocks.settings, tabLayout: 'vertical'};
        render(<Harness initialTabs={tabs} />);
        dragFirstOntoLast();
        expect(mocks.reorderTab).toHaveBeenCalledWith('first', 3);
    });

    it('reorders along the horizontal axis by default', () => {
        render(<Harness initialTabs={tabs} />);
        dragFirstOntoLast();
        expect(mocks.reorderTab).toHaveBeenCalledWith('first', 2);
    });
});
