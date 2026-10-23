import {useCallback, useRef, useState} from 'react';
import {act, render} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {invoke} from '@tauri-apps/api/core';
import {Editor} from '@/pages/Editor';
import {EditorContext, type EditorContextType} from '@/contexts/EditorContext';
import {createAutoRefreshSchedule, type AutoRefreshSchedule} from '@/utils/autoRefresh';
import type {Tab} from '@/types/editor';

// Issue #1211: the editor's "Copy SQL Without Comments" action gave no
// feedback (and left a failed clipboard write as an unhandled rejection), and
// it was offered on connections that declare only the `generic` dialect.
// Drives the real Monaco action registered by the Editor's onMount.

type MountHandler = (editor: unknown, monaco: unknown) => void;
interface CapturedAction {
    id: string;
    precondition?: string;
    run: (editor: unknown) => unknown;
}

const mocks = vi.hoisted(() => ({
    noop: vi.fn(),
    guard: vi.fn().mockResolvedValue(true),
    showAlert: vi.fn(),
    showToast: vi.fn(),
    onMount: undefined as ((editor: unknown, monaco: unknown) => void) | undefined,
    location: {state: null, pathname: '/editor', key: 'test'},
    settings: {resultPageSize: 100, csvIncludeHeaders: true},
    capabilities: {schemas: true, sql_dialect: 'postgres', identifier_quote: '"'} as Record<
        string,
        unknown
    >,
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
    useQueryHistory: () => ({addEntry: mocks.noop}),
}));
vi.mock('@/hooks/useKeybindings', () => ({
    useKeybindings: () => ({matchesShortcut: mocks.noop, isMac: false}),
}));
vi.mock('@/hooks/useAlert', () => ({useAlert: () => ({showAlert: mocks.showAlert})}));
vi.mock('@/hooks/useToast', () => ({useToast: () => ({showToast: mocks.showToast})}));
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
vi.mock('@/components/ui/SqlEditorWrapper', () => ({
    SqlEditorWrapper: ({onMount}: {onMount?: MountHandler}) => {
        mocks.onMount = onMount;
        return null;
    },
}));
vi.mock('@/components/ui/DataGrid', () => ({DataGrid: () => null}));
vi.mock('@/components/ui/RelatedRecordsPanel', () => ({RelatedRecordsPanel: () => null}));
vi.mock('@/components/notebook/NotebookView', () => ({NotebookView: () => null}));
vi.mock('@/components/users/UserManagementView', () => ({UserManagementView: () => null}));
vi.mock('@/components/layout/CommandPaletteScopeBridge', () => ({
    CommandPaletteScopeBridge: () => null,
}));

const consoleTab: Tab = {
    id: 'console-1',
    connectionId: 'connection-1',
    title: 'console-1',
    type: 'console',
    query: '',
    result: null,
    error: '',
    executionTime: null,
    page: 1,
    activeTable: null,
    pkColumns: null,
    isEditorOpen: true,
};

function Harness() {
    const [tabs, setTabs] = useState([consoleTab]);
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
        activeTabId: consoleTab.id,
        activeTab: tabs[0],
        getAutoRefreshSchedule,
        updateTab,
        setActiveTabId: mocks.noop,
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

/** Renders the Editor and mounts a fake Monaco editor holding `sql`. */
function mountEditor(sql: string) {
    render(<Harness />);
    const actions = new Map<string, CapturedAction>();
    const contextKeys = new Map<string, unknown>();
    const editor = {
        focus: vi.fn(),
        addAction: (action: CapturedAction) => actions.set(action.id, action),
        createContextKey: (key: string, value: unknown) => {
            contextKeys.set(key, value);
            return {set: (next: unknown) => contextKeys.set(key, next)};
        },
        onDidDispose: vi.fn(),
        getSelection: () => null,
        getModel: () => ({getValue: () => sql, getValueInRange: () => ''}),
        getValue: () => sql,
    };
    expect(mocks.onMount).toBeDefined();
    act(() => mocks.onMount?.(editor, {}));
    const action = actions.get('copy-sql-without-comments');
    expect(action).toBeDefined();
    return {action: action!, editor, contextKeys};
}

describe('Copy SQL Without Comments', () => {
    const writeText = vi.fn<(text: string) => Promise<void>>();

    beforeEach(() => {
        mocks.onMount = undefined;
        mocks.capabilities = {schemas: true, sql_dialect: 'postgres', identifier_quote: '"'};
        mocks.showAlert.mockClear();
        mocks.showToast.mockClear();
        writeText.mockReset();
        Object.assign(navigator, {clipboard: {writeText}});
        vi.mocked(invoke).mockReset();
        vi.mocked(invoke).mockResolvedValue([]);
    });
    afterEach(() => vi.restoreAllMocks());

    it('copies the stripped SQL and confirms it with a toast', async () => {
        writeText.mockResolvedValue(undefined);
        const {action, editor} = mountEditor('SELECT 1 -- note\n');

        await act(async () => {
            await action.run(editor);
        });

        expect(writeText).toHaveBeenCalledWith('SELECT 1 \n');
        expect(mocks.showToast).toHaveBeenCalledWith('common.copied', {kind: 'success'});
        expect(mocks.showAlert).not.toHaveBeenCalled();
    });

    it('shows and logs an error when the clipboard write fails', async () => {
        const error = new Error('clipboard denied');
        writeText.mockRejectedValue(error);
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const {action, editor} = mountEditor('SELECT 1 -- note\n');

        await act(async () => {
            await expect(Promise.resolve(action.run(editor))).resolves.toBeUndefined();
        });

        expect(mocks.showAlert).toHaveBeenCalledWith('common.error: Error: clipboard denied', {
            title: 'common.error',
            kind: 'error',
        });
        expect(consoleError).toHaveBeenCalledWith('Copy failed:', error);
        expect(mocks.showToast).not.toHaveBeenCalled();
    });

    it('offers the action on a connection with a concrete dialect', () => {
        const {action, contextKeys} = mountEditor('SELECT 1');
        expect(action.precondition).toBe('tabularisCanStripSqlComments');
        expect(contextKeys.get('tabularisCanStripSqlComments')).toBe(true);
    });

    it('hides the action on a plugin that declares only the generic dialect', () => {
        mocks.capabilities = {schemas: true, sql_dialect: 'generic', identifier_quote: '"'};
        const {action, contextKeys} = mountEditor('SELECT 1');
        expect(action.precondition).toBe('tabularisCanStripSqlComments');
        expect(contextKeys.get('tabularisCanStripSqlComments')).toBe(false);
    });

    it('keeps the action on a generic plugin that declares sql_syntax', () => {
        mocks.capabilities = {
            schemas: true,
            sql_dialect: 'generic',
            identifier_quote: '"',
            sql_syntax: {quotes: [{open: "'", kind: 'string', escape: 'backslash'}]},
        };
        const {contextKeys} = mountEditor('SELECT 1');
        expect(contextKeys.get('tabularisCanStripSqlComments')).toBe(true);
    });
});
