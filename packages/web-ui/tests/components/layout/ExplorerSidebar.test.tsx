import {describe, it, expect, vi, beforeEach} from 'vitest';
import {render, screen, fireEvent, waitFor, act} from '@testing-library/react';
import {invoke} from '@tauri-apps/api/core';
import {ExplorerSidebar} from '@/components/layout/ExplorerSidebar';
import {useDatabase} from '@/hooks/useDatabase';
import {useSavedQueries} from '@/hooks/useSavedQueries';
import {useQueryHistory} from '@/hooks/useQueryHistory';
import {useAlert} from '@/hooks/useAlert';
import {useConnectionLayoutContext} from '@/hooks/useConnectionLayoutContext';
import {useDrivers} from '@/hooks/useDrivers';
import {useEditor} from '@/hooks/useEditor';
import {useSettings} from '@/hooks/useSettings';
import {useDatabaseObjectNavigation} from '@/hooks/useDatabaseObjectNavigation';
import {openEditor} from '@/utils/editorNavigation';
import {FOLDERS_FILE_UNREADABLE} from '@/utils/savedQueryFolders';

const translateMock = vi.hoisted(() => (key: string) => key);
const toastSpy = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
    useTranslation: () => ({t: translateMock}),
}));

vi.mock('@/hooks/useDatabase', () => ({useDatabase: vi.fn()}));
vi.mock('@/hooks/useSavedQueries', () => ({useSavedQueries: vi.fn()}));
vi.mock('@/hooks/useQueryHistory', () => ({useQueryHistory: vi.fn()}));
vi.mock('@/hooks/useAlert', () => ({useAlert: vi.fn()}));
vi.mock('@/hooks/useToast', () => ({
    useToast: () => ({showToast: toastSpy}),
}));
vi.mock('@/hooks/useConnectionLayoutContext', () => ({
    useConnectionLayoutContext: vi.fn(),
}));
vi.mock('@/hooks/useDrivers', () => ({useDrivers: vi.fn()}));
vi.mock('@/hooks/useEditor', () => ({useEditor: vi.fn()}));
vi.mock('@/hooks/useSettings', () => ({useSettings: vi.fn()}));
vi.mock('@/hooks/useDatabaseObjectNavigation', () => ({
    useDatabaseObjectNavigation: vi.fn(),
}));
vi.mock('@/hooks/useSecondaryWindows', () => ({
    useSecondaryWindows: () => ({openSchemaDiagram: vi.fn()}),
}));
vi.mock('@/hooks/usePlatformCapabilities', () => ({
    usePlatformCapabilities: () => ({chooseInputFile: vi.fn()}),
}));
const sidebarClient = {call: (command: string, request: unknown) => invoke(command, request)};
vi.mock('@/hooks/useTabularisClient', () => ({useTabularisClient: () => sidebarClient}));
vi.mock('react-router-dom', () => ({useNavigate: () => vi.fn()}));
vi.mock('@/utils/notebookStore', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/utils/notebookStore')>();
    return {
        ...actual,
        listNotebooks: vi.fn(() => new Promise<never[]>(() => undefined)),
    };
});
vi.mock('@/utils/editorNavigation', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/utils/editorNavigation')>();
    return {...actual, openEditor: vi.fn()};
});

// Stand-in for the parameter dialog: submitting hands the generated SQL to the sidebar's onRun.
vi.mock('@/components/modals/RunRoutineModal', () => ({
    RunRoutineModal: ({onRun}: {onRun: (sql: string) => void}) => (
        <button onClick={() => onRun('SELECT refresh_orders()')}>run-routine-modal</button>
    ),
}));

// Stand-in for the import dialog: it shows the schema it targets, one button reports a
// finished import and the other closes the dialog.
vi.mock('@/components/modals/ClipboardImportModal', () => ({
    ClipboardImportModal: ({
        schema,
        onSuccess,
        onClose,
    }: {
        schema?: string;
        onSuccess: () => void;
        onClose: () => void;
    }) => (
        <>
            <span>{`clipboard-import-schema:${schema ?? 'active'}`}</span>
            <button onClick={onSuccess}>clipboard-import-success</button>
            <button onClick={onClose}>clipboard-import-close</button>
        </>
    ),
}));

// ExplorerSidebar pulls in many lucide icons; use the real module so every icon resolves
// (the global setup mock only stubs a fixed subset).
vi.mock('lucide-react', async (importOriginal) => await importOriginal());

const sidebarItemMocks = vi.hoisted(() => ({
    sidebarTableItemProps: [] as Array<Record<string, unknown>>,
    sidebarViewItemProps: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/components/layout/sidebar/SidebarTableItem', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('@/components/layout/sidebar/SidebarTableItem')>();
    return {
        ...actual,
        SidebarTableItem: (props: Record<string, unknown>) => {
            sidebarItemMocks.sidebarTableItemProps.push(props);
            return (
                <actual.SidebarTableItem
                    {...(props as Parameters<typeof actual.SidebarTableItem>[0])}
                />
            );
        },
    };
});

vi.mock('@/components/layout/sidebar/SidebarViewItem', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('@/components/layout/sidebar/SidebarViewItem')>();
    return {
        ...actual,
        SidebarViewItem: (props: Record<string, unknown>) => {
            sidebarItemMocks.sidebarViewItemProps.push(props);
            return (
                <actual.SidebarViewItem
                    {...(props as Parameters<typeof actual.SidebarViewItem>[0])}
                />
            );
        },
    };
});

const DISPLAY = 'could not connect: TLS handshake failed';
const DEBUG = 'InvalidCertificate(UnknownIssuer)\n  caused by: certificate verify failed';
const RAW_ERROR = `${DISPLAY}\n\n${DEBUG}`;

const renderSidebar = () =>
    render(
        <ExplorerSidebar
            sidebarWidth={280}
            startResize={vi.fn()}
            onCollapse={vi.fn()}
            sidebarTab="structure"
            onSidebarTabChange={vi.fn()}
        />,
    );

describe('ExplorerSidebar — schema load error block', () => {
    const connect = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);

    beforeEach(() => {
        vi.clearAllMocks();
        Object.defineProperty(navigator, 'clipboard', {value: {writeText}, configurable: true});

        vi.mocked(useDatabase).mockReturnValue({
            activeConnectionId: 'c1',
            activeCapabilities: {schemas: true},
            schemas: [],
            connectionDataMap: {c1: {error: RAW_ERROR}},
            isLoadingTables: false,
            isLoadingSchemas: false,
            connect,
        } as unknown as ReturnType<typeof useDatabase>);

        vi.mocked(useSavedQueries).mockReturnValue({
            queries: [],
            folders: [],
            deleteQuery: vi.fn(),
            updateQuery: vi.fn(),
            saveQuery: vi.fn(),
        } as unknown as ReturnType<typeof useSavedQueries>);

        vi.mocked(useQueryHistory).mockReturnValue({
            entries: [],
            isLoading: false,
            deleteEntry: vi.fn(),
            clearHistory: vi.fn(),
            recoveryNotice: null,
            dismissRecoveryNotice: vi.fn(),
        } as unknown as ReturnType<typeof useQueryHistory>);

        vi.mocked(useAlert).mockReturnValue({showAlert: vi.fn()} as unknown as ReturnType<
            typeof useAlert
        >);

        vi.mocked(useDrivers).mockReturnValue({
            allDrivers: [],
        } as unknown as ReturnType<typeof useDrivers>);

        vi.mocked(useEditor).mockReturnValue({
            tabs: [],
            openNotebook: vi.fn(),
            updateTab: vi.fn(),
            closeTab: vi.fn(),
        } as unknown as ReturnType<typeof useEditor>);

        vi.mocked(useSettings).mockReturnValue({
            settings: {displayTimezone: 'auto'},
        } as unknown as ReturnType<typeof useSettings>);

        vi.mocked(useConnectionLayoutContext).mockReturnValue({
            splitView: {connectionIds: []},
            isSplitVisible: false,
            explorerConnectionId: null,
            setExplorerConnectionId: vi.fn(),
        } as unknown as ReturnType<typeof useConnectionLayoutContext>);
    });

    it('shows the error title and retry button instead of an empty tree', () => {
        renderSidebar();
        expect(screen.getByText('sidebar.schemaLoadError')).toBeInTheDocument();
        expect(screen.getByText('sidebar.retry')).toBeInTheDocument();
    });

    it('preview shows only the Display part (before the \\n\\n separator)', () => {
        renderSidebar();
        expect(screen.getByText(DISPLAY)).toBeInTheDocument();
        expect(screen.queryByText(RAW_ERROR)).not.toBeInTheDocument();
    });

    it('expanding the chevron reveals the full raw error (debug part) in a <pre>', () => {
        const {container} = renderSidebar();
        expect(container.querySelector('pre')).toBeNull();
        expect(screen.queryByText(/InvalidCertificate/)).not.toBeInTheDocument();

        fireEvent.click(screen.getByText('sidebar.errorDetails'));

        const pre = container.querySelector('pre');
        expect(pre).not.toBeNull();
        expect(pre?.textContent).toContain(DEBUG);
    });

    it('copy button writes the full raw error to the clipboard', () => {
        renderSidebar();
        fireEvent.click(screen.getByText('sidebar.errorDetails'));
        fireEvent.click(screen.getByTitle('sidebar.copyError'));
        expect(writeText).toHaveBeenCalledWith(RAW_ERROR);
    });

    it('retry reconnects the active connection', () => {
        renderSidebar();
        fireEvent.click(screen.getByText('sidebar.retry'));
        expect(connect).toHaveBeenCalledWith('c1');
    });
});

describe('ExplorerSidebar — database object navigation', () => {
    const objectNavigation = {
        open: vi.fn(),
        count: vi.fn(),
        newConsole: vi.fn(),
        openRoutineDefinition: vi.fn(),
        openTriggerDefinition: vi.fn(),
        openDefinition: vi.fn(),
    };

    const routine = {name: 'refresh_orders', routine_type: 'FUNCTION'};
    const trigger = {
        name: 'audit_orders',
        table_name: 'orders',
        event: 'INSERT',
        timing: 'AFTER',
    };
    const databaseState = {
        activeConnectionId: 'c1' as string | null,
        activeDriver: 'postgres',
        activeCapabilities: {routines: true, triggers: true},
        activeTable: null,
        setActiveTable: vi.fn(),
        tables: [{name: 'orders'}],
        views: [{name: 'active_orders'}],
        routines: [routine],
        triggers: [trigger] as Array<typeof trigger>,
        schemas: [] as string[],
        connectionDataMap: {c1: {}},
        schemaDataMap: {},
        databaseDataMap: {},
        selectedSchemas: [] as string[],
        selectedDatabases: [] as string[],
        connections: [],
        isLoadingTables: false,
        isLoadingSchemas: false,
        connect: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();

        databaseState.activeConnectionId = 'c1';
        databaseState.triggers = [trigger];

        vi.mocked(useDatabaseObjectNavigation).mockReturnValue(
            objectNavigation as unknown as ReturnType<typeof useDatabaseObjectNavigation>,
        );

        // No `schemas` capability keeps the sidebar in its flat layout, where tables,
        // views, routines and triggers all render off the connection root.
        vi.mocked(useDatabase).mockReturnValue(
            databaseState as unknown as ReturnType<typeof useDatabase>,
        );

        vi.mocked(useSavedQueries).mockReturnValue({
            queries: [],
            folders: [],
            deleteQuery: vi.fn(),
            updateQuery: vi.fn(),
            saveQuery: vi.fn(),
        } as unknown as ReturnType<typeof useSavedQueries>);

        vi.mocked(useQueryHistory).mockReturnValue({
            entries: [],
            isLoading: false,
            deleteEntry: vi.fn(),
            clearHistory: vi.fn(),
            recoveryNotice: null,
            dismissRecoveryNotice: vi.fn(),
        } as unknown as ReturnType<typeof useQueryHistory>);

        vi.mocked(useAlert).mockReturnValue({
            showAlert: vi.fn(),
        } as unknown as ReturnType<typeof useAlert>);

        vi.mocked(useDrivers).mockReturnValue({
            allDrivers: [],
        } as unknown as ReturnType<typeof useDrivers>);

        vi.mocked(useEditor).mockReturnValue({
            tabs: [],
            openNotebook: vi.fn(),
            updateTab: vi.fn(),
            closeTab: vi.fn(),
        } as unknown as ReturnType<typeof useEditor>);

        vi.mocked(useSettings).mockReturnValue({
            settings: {displayTimezone: 'auto'},
        } as unknown as ReturnType<typeof useSettings>);

        vi.mocked(useConnectionLayoutContext).mockReturnValue({
            splitView: {connectionIds: []},
            isSplitVisible: false,
            explorerConnectionId: null,
            setExplorerConnectionId: vi.fn(),
        } as unknown as ReturnType<typeof useConnectionLayoutContext>);
    });

    const openContextMenuOn = (name: string) => {
        renderSidebar();
        fireEvent.contextMenu(screen.getByText(name));
    };

    it('double-clicking a table opens it', () => {
        renderSidebar();
        fireEvent.doubleClick(screen.getByText('orders'));
        expect(objectNavigation.open).toHaveBeenCalledWith('orders', undefined);
    });

    it('double-clicking a view opens it as a non-materialized view', () => {
        renderSidebar();
        fireEvent.doubleClick(screen.getByText('active_orders'));
        expect(objectNavigation.open).toHaveBeenCalledWith('active_orders', undefined, {
            materialized: false,
        });
    });

    it('double-clicking a routine loads its definition', () => {
        renderSidebar();
        fireEvent.click(screen.getByText('sidebar.routines (1)'));
        fireEvent.doubleClick(screen.getByText('refresh_orders'));
        expect(objectNavigation.openRoutineDefinition).toHaveBeenCalledWith(routine, undefined);
    });

    it('double-clicking a trigger loads its definition', () => {
        renderSidebar();
        fireEvent.click(screen.getByText('sidebar.triggers (1)'));
        fireEvent.doubleClick(screen.getByText('audit_orders'));
        expect(objectNavigation.openTriggerDefinition).toHaveBeenCalledWith(trigger, undefined);
    });

    it('context menu — show data opens the table', () => {
        openContextMenuOn('orders');
        fireEvent.click(screen.getByText('sidebar.showData'));
        expect(objectNavigation.open).toHaveBeenCalledWith(
            'orders',
            undefined,
            undefined,
            undefined,
        );
    });

    it('context menu — new console opens a console for the table', () => {
        openContextMenuOn('orders');
        fireEvent.click(screen.getByText('sidebar.newConsole'));
        expect(objectNavigation.newConsole).toHaveBeenCalledWith('orders', undefined, undefined);
    });

    it('context menu — count rows counts the table', () => {
        openContextMenuOn('orders');
        fireEvent.click(screen.getByText('sidebar.countRows'));
        expect(objectNavigation.count).toHaveBeenCalledWith(
            'orders',
            undefined,
            undefined,
            undefined,
        );
    });

    it('context menu — show definition opens the view DDL in a read-only tab', async () => {
        const ddl = 'CREATE OR REPLACE VIEW active_orders AS SELECT 1';
        vi.mocked(invoke).mockResolvedValue(ddl);
        openContextMenuOn('active_orders');
        fireEvent.click(screen.getByText('sidebar.showDefinition'));
        await waitFor(() => {
            expect(invoke).toHaveBeenCalledWith('get_view_definition', {
                connectionId: 'c1',
                viewName: 'active_orders',
            });
        });
        expect(objectNavigation.openDefinition).toHaveBeenCalledWith(
            ddl,
            'active_orders Definition',
            undefined,
            true,
        );
    });

    it('context menu — copy DDL copies the view definition and shows feedback', async () => {
        const showAlert = vi.fn();
        vi.mocked(useAlert).mockReturnValue({
            showAlert,
        } as unknown as ReturnType<typeof useAlert>);
        const ddl = 'CREATE VIEW active_orders AS SELECT 1';
        vi.mocked(invoke).mockResolvedValue(ddl);
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            value: {writeText},
            configurable: true,
        });

        openContextMenuOn('active_orders');
        await act(async () => {
            fireEvent.click(screen.getByText('sidebar.copyDdl'));
        });
        await waitFor(() => {
            expect(writeText).toHaveBeenCalledWith(ddl);
        });
        expect(showAlert).toHaveBeenCalledWith('common.copied', {kind: 'info'});
    });

    it('does not list views when the driver does not support them', () => {
        vi.mocked(useDatabase).mockReturnValue({
            ...databaseState,
            activeCapabilities: {views: false, routines: true, triggers: true},
            views: [{name: 'active_orders'}],
        } as unknown as ReturnType<typeof useDatabase>);
        renderSidebar();
        expect(screen.queryByText('active_orders')).not.toBeInTheDocument();
    });

    const renderMaterializedView = (capabilities: Record<string, unknown>) => {
        vi.mocked(useDatabase).mockReturnValue({
            ...databaseState,
            activeCapabilities: {schemas: true, ...capabilities},
            activeSchema: 'public',
            schemas: ['public', 'sales'],
            selectedSchemas: ['sales'],
            schemaDataMap: {
                sales: {
                    tables: [],
                    views: [],
                    materializedViews: [{name: 'daily_totals'}],
                    routines: [],
                    triggers: [],
                    isLoaded: true,
                    isLoading: false,
                },
            },
        } as unknown as ReturnType<typeof useDatabase>);
        renderSidebar();
        fireEvent.click(screen.getByText('sales'));
        fireEvent.click(screen.getByText('sidebar.materializedViews (1)'));
        fireEvent.contextMenu(screen.getByText('daily_totals'));
    };

    it('context menu — materialized view hides definition items when materialized_views is unset', () => {
        renderMaterializedView({});
        expect(screen.getByText('sidebar.refreshMaterializedView')).toBeInTheDocument();
        expect(screen.queryByText('sidebar.showDefinition')).not.toBeInTheDocument();
        expect(screen.queryByText('sidebar.copyDdl')).not.toBeInTheDocument();
    });

    it('context menu — copy DDL on a materialized view fetches its definition with the schema', async () => {
        const ddl = 'CREATE MATERIALIZED VIEW sales.daily_totals AS SELECT 1';
        vi.mocked(invoke).mockImplementation(async (command) =>
            command === 'get_materialized_view_definition' ? ddl : [],
        );
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            value: {writeText},
            configurable: true,
        });

        renderMaterializedView({materialized_views: true});
        await act(async () => {
            fireEvent.click(screen.getByText('sidebar.copyDdl'));
        });

        await waitFor(() => {
            expect(writeText).toHaveBeenCalledWith(ddl);
        });
        expect(invoke).toHaveBeenCalledWith('get_materialized_view_definition', {
            connectionId: 'c1',
            viewName: 'daily_totals',
            schema: 'sales',
        });
    });

    it('context menu — run routine opens the call for review without executing it', () => {
        vi.mocked(useDatabase).mockReturnValue({
            ...databaseState,
            activeCapabilities: {...databaseState.activeCapabilities, routine_management: true},
        } as unknown as ReturnType<typeof useDatabase>);
        renderSidebar();
        fireEvent.click(screen.getByText('sidebar.routines (1)'));
        fireEvent.contextMenu(screen.getByText('refresh_orders'));
        fireEvent.click(screen.getByText('routines.menuRun'));
        fireEvent.click(screen.getByText('run-routine-modal'));

        expect(openEditor).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                kind: 'console',
                initialQuery: 'SELECT refresh_orders()',
                preventAutoRun: true,
            }),
        );
    });

    it('schema layout — New routine targets the schema it was opened from, not the active one', async () => {
        vi.mocked(useDatabase).mockReturnValue({
            ...databaseState,
            activeCapabilities: {schemas: true, routines: true, routine_management: true},
            activeSchema: 'public',
            schemas: ['public', 'sales'],
            selectedSchemas: ['sales'],
            schemaDataMap: {
                sales: {
                    tables: [],
                    views: [],
                    routines: [],
                    triggers: [],
                    isLoaded: true,
                    isLoading: false,
                },
            },
        } as unknown as ReturnType<typeof useDatabase>);
        vi.mocked(invoke).mockImplementation(async (command) =>
            command === 'get_routine_create_template'
                ? 'CREATE PROCEDURE sales.my_procedure()'
                : undefined,
        );
        renderSidebar();

        fireEvent.click(screen.getByText('sales'));
        fireEvent.click(screen.getByTitle('routines.newRoutine'));
        fireEvent.click(screen.getByText('routines.newProcedure'));

        await waitFor(() =>
            expect(openEditor).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    initialQuery: 'CREATE PROCEDURE sales.my_procedure()',
                    schema: 'sales',
                }),
            ),
        );
        expect(invoke).toHaveBeenCalledWith('get_routine_create_template', {
            connectionId: 'c1',
            routineType: 'PROCEDURE',
            schema: 'sales',
        });
    });

    describe('Import from Clipboard', () => {
        const refreshTables = vi.fn();
        const refreshSchemaData = vi.fn();
        const refreshDatabaseData = vi.fn();

        const importFromClipboard = (state: Record<string, unknown>) => {
            vi.mocked(useDatabase).mockReturnValue({
                ...databaseState,
                refreshTables,
                refreshSchemaData,
                refreshDatabaseData,
                ...state,
            } as unknown as ReturnType<typeof useDatabase>);
            renderSidebar();
            act(() => {
                window.dispatchEvent(new Event('tabularis:paste-import'));
            });
            // Count only the refreshes the finished import triggers.
            for (const refresh of [refreshTables, refreshSchemaData, refreshDatabaseData])
                refresh.mockClear();
            fireEvent.click(screen.getByText('clipboard-import-success'));
        };

        it('refreshes the active schema in the schema layout', async () => {
            importFromClipboard({
                activeCapabilities: {schemas: true},
                activeSchema: 'public',
                schemas: ['public', 'sales'],
            });

            expect(screen.getByText('clipboard-import-schema:active')).toBeInTheDocument();
            await waitFor(() => expect(refreshSchemaData).toHaveBeenCalledWith('public'));
            expect(refreshTables).not.toHaveBeenCalled();
        });

        it('imports into the schema of the table it was opened from', async () => {
            vi.mocked(useDatabase).mockReturnValue({
                ...databaseState,
                refreshTables,
                refreshSchemaData,
                refreshDatabaseData,
                activeCapabilities: {schemas: true},
                activeSchema: 'public',
                schemas: ['public', 'sales'],
                selectedSchemas: ['sales'],
                schemaDataMap: {
                    sales: {
                        tables: [{name: 'sales_orders'}],
                        views: [],
                        routines: [],
                        triggers: [],
                        isLoaded: true,
                        isLoading: false,
                    },
                },
            } as unknown as ReturnType<typeof useDatabase>);
            renderSidebar();

            fireEvent.click(screen.getByText('sales'));
            fireEvent.contextMenu(screen.getByText('sales_orders'));
            fireEvent.click(screen.getByText('clipboardImport.contextMenuLabel'));
            expect(screen.getByText('clipboard-import-schema:sales')).toBeInTheDocument();

            for (const refresh of [refreshTables, refreshSchemaData, refreshDatabaseData])
                refresh.mockClear();
            fireEvent.click(screen.getByText('clipboard-import-success'));
            await waitFor(() => expect(refreshSchemaData).toHaveBeenCalledWith('sales'));
            expect(refreshSchemaData).not.toHaveBeenCalledWith('public');
        });

        it('refreshes the active database in the multi-database layout', async () => {
            importFromClipboard({
                activeDriver: 'mysql',
                activeCapabilities: {schemas: false, file_based: false},
                activeSchema: 'tabularis_demo',
                selectedDatabases: ['tabularis_demo', 'analytics'],
                loadDatabaseData: vi.fn(),
            });

            await waitFor(() => expect(refreshDatabaseData).toHaveBeenCalledWith('tabularis_demo'));
            expect(refreshTables).not.toHaveBeenCalled();
        });

        it('refreshes the table list in the flat layout', async () => {
            importFromClipboard({});

            await waitFor(() => expect(refreshTables).toHaveBeenCalledTimes(1));
        });

        it('keeps the dialog on its success message until it is closed', () => {
            importFromClipboard({});

            expect(screen.getByText('clipboard-import-success')).toBeInTheDocument();
            fireEvent.click(screen.getByText('clipboard-import-close'));
            expect(screen.queryByText('clipboard-import-success')).not.toBeInTheDocument();
        });
    });

    it('disables table actions that require an active connection', () => {
        databaseState.activeConnectionId = null;

        openContextMenuOn('orders');

        expect(screen.getByRole('button', {name: 'sidebar.viewSchema'})).toBeDisabled();
        expect(screen.getByRole('button', {name: 'sidebar.generateSQL'})).toBeDisabled();
    });

    it('disables trigger definition without trigger metadata', () => {
        databaseState.triggers = [
            {
                name: 'orphan_trigger',
                event: 'INSERT',
                timing: 'AFTER',
            } as typeof trigger,
        ];
        renderSidebar();
        fireEvent.click(screen.getByText('sidebar.triggers (1)'));
        fireEvent.contextMenu(screen.getByText('orphan_trigger'));

        expect(
            screen.getByRole('button', {
                name: 'sidebar.viewTriggerDefinition',
            }),
        ).toBeDisabled();
    });
});

describe('ExplorerSidebar — capabilities threading (issue #614)', () => {
    const databaseState = {
        activeConnectionId: 'c1' as string | null,
        activeDriver: 'postgresql',
        activeCapabilities: {sql_dialect: 'postgres', identifier_quote: '"'},
        activeTable: null,
        setActiveTable: vi.fn(),
        tables: [{name: 'orders'}],
        views: [{name: 'active_orders'}],
        routines: [],
        triggers: [],
        schemas: [] as string[],
        connectionDataMap: {c1: {}},
        schemaDataMap: {},
        databaseDataMap: {},
        selectedSchemas: [] as string[],
        selectedDatabases: [] as string[],
        connections: [],
        isLoadingTables: false,
        isLoadingSchemas: false,
        connect: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        sidebarItemMocks.sidebarTableItemProps.length = 0;
        sidebarItemMocks.sidebarViewItemProps.length = 0;

        vi.mocked(useDatabaseObjectNavigation).mockReturnValue({
            open: vi.fn(),
            count: vi.fn(),
            newConsole: vi.fn(),
            openRoutineDefinition: vi.fn(),
            openTriggerDefinition: vi.fn(),
            openDefinition: vi.fn(),
        } as unknown as ReturnType<typeof useDatabaseObjectNavigation>);

        vi.mocked(useDatabase).mockReturnValue(
            databaseState as unknown as ReturnType<typeof useDatabase>,
        );

        vi.mocked(useSavedQueries).mockReturnValue({
            queries: [],
            folders: [],
            deleteQuery: vi.fn(),
            updateQuery: vi.fn(),
            saveQuery: vi.fn(),
        } as unknown as ReturnType<typeof useSavedQueries>);

        vi.mocked(useQueryHistory).mockReturnValue({
            entries: [],
            isLoading: false,
            deleteEntry: vi.fn(),
            clearHistory: vi.fn(),
            recoveryNotice: null,
            dismissRecoveryNotice: vi.fn(),
        } as unknown as ReturnType<typeof useQueryHistory>);

        vi.mocked(useAlert).mockReturnValue({
            showAlert: vi.fn(),
        } as unknown as ReturnType<typeof useAlert>);

        vi.mocked(useDrivers).mockReturnValue({
            allDrivers: [],
        } as unknown as ReturnType<typeof useDrivers>);

        vi.mocked(useEditor).mockReturnValue({
            tabs: [],
            openNotebook: vi.fn(),
            updateTab: vi.fn(),
            closeTab: vi.fn(),
        } as unknown as ReturnType<typeof useEditor>);

        vi.mocked(useSettings).mockReturnValue({
            settings: {displayTimezone: 'auto'},
        } as unknown as ReturnType<typeof useSettings>);

        vi.mocked(useConnectionLayoutContext).mockReturnValue({
            splitView: {connectionIds: []},
            isSplitVisible: false,
            explorerConnectionId: null,
            setExplorerConnectionId: vi.fn(),
        } as unknown as ReturnType<typeof useConnectionLayoutContext>);
    });

    it('passes activeCapabilities through to SidebarTableItem, not just the driver id', () => {
        renderSidebar();
        expect(sidebarItemMocks.sidebarTableItemProps).toHaveLength(1);
        expect(sidebarItemMocks.sidebarTableItemProps[0].capabilities).toBe(
            databaseState.activeCapabilities,
        );
    });

    it('passes activeCapabilities through to SidebarViewItem, not just the driver id', () => {
        renderSidebar();
        expect(sidebarItemMocks.sidebarViewItemProps).toHaveLength(1);
        expect(sidebarItemMocks.sidebarViewItemProps[0].capabilities).toBe(
            databaseState.activeCapabilities,
        );
    });
    it.each(['index', 'foreign_key'] as const)(
        'opens %s details from the menu for a read-only plugin using capabilities',
        async (kind) => {
            const capabilities = {
                ...databaseState.activeCapabilities,
                readonly: true,
                manage_tables: false,
            };
            vi.mocked(useDatabase).mockReturnValue({
                ...databaseState,
                activeCapabilities: capabilities,
            } as unknown as ReturnType<typeof useDatabase>);
            vi.mocked(invoke).mockImplementation(async (command) => {
                if (command === 'get_indexes')
                    return [
                        {
                            name: 'orders_idx',
                            column_name: 'customer_id',
                            is_unique: true,
                            is_primary: false,
                        },
                    ];
                if (command === 'get_foreign_keys')
                    return [
                        {
                            name: 'orders_fk',
                            column_name: 'customer_id',
                            ref_table: 'customers',
                            ref_column: 'id',
                            on_delete: 'CASCADE',
                        },
                    ];
                if (command === 'get_create_index_sql')
                    return ['CREATE UNIQUE INDEX "orders_idx" ON "orders" ("customer_id")'];
                if (command === 'get_create_foreign_key_sql')
                    return [
                        'ALTER TABLE "orders" ADD CONSTRAINT "orders_fk" FOREIGN KEY ("customer_id") REFERENCES "customers" ("id")',
                    ];
                return [];
            });
            renderSidebar();
            const table = screen.getByText('orders').closest('[data-table-name]')!;
            fireEvent.click(table.querySelector('button')!);
            await waitFor(() =>
                expect(invoke).toHaveBeenCalledWith(
                    'get_indexes',
                    expect.objectContaining({connectionId: 'c1', tableName: 'orders'}),
                ),
            );
            if (kind === 'index') {
                fireEvent.click(screen.getByText('sidebar.indexes'));
            } else {
                fireEvent.click(screen.getByText('sidebar.foreignKeys').parentElement!);
            }
            const name = kind === 'index' ? 'orders_idx' : 'orders_fk';
            fireEvent.contextMenu(await screen.findByText(name, {exact: false}));
            expect(
                screen.queryByText(kind === 'index' ? 'sidebar.deleteIndex' : 'sidebar.deleteFk'),
            ).not.toBeInTheDocument();
            fireEvent.click(screen.getByText('objectDetails.viewDetails'));
            expect(screen.getByRole('dialog')).toHaveTextContent(name);
            expect(screen.getByRole('dialog')).toHaveTextContent('1. customer_id');
            await screen.findByRole('button', {
                name: kind === 'index' ? 'objectDetails.copyCreate' : 'objectDetails.copyAlter',
            });
            expect(invoke).toHaveBeenCalledWith(
                kind === 'index' ? 'get_create_index_sql' : 'get_create_foreign_key_sql',
                expect.objectContaining({connectionId: 'c1', table: 'orders'}),
            );
            expect(
                invoke.mock.calls.every(
                    ([command]) =>
                        !String(command).includes('execute') && !String(command).includes('drop_'),
                ),
            ).toBe(true);
        },
    );
});

describe('ExplorerSidebar — saved query actions', () => {
    const sql = 'DELETE FROM audit_log WHERE archived = true';
    const savedQuery = {
        id: 'q1',
        name: 'Cleanup',
        sql,
        connection_id: 'c1',
        database: 'analytics',
        created_at: null,
        updated_at: null,
    };
    const saveQuery = vi.fn();
    const writeText = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        saveQuery.mockReset().mockResolvedValue(undefined);
        writeText.mockReset().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            value: {writeText},
            configurable: true,
        });

        vi.mocked(useDatabase).mockReturnValue({
            activeConnectionId: 'c1',
            activeDriver: 'postgres',
            activeCapabilities: {schemas: false},
            activeTable: null,
            tables: [],
            views: [],
            routines: [],
            triggers: [],
            schemas: [],
            connectionDataMap: {c1: {}},
            schemaDataMap: {},
            databaseDataMap: {},
            selectedSchemas: [],
            selectedDatabases: [],
            connections: [],
            isLoadingTables: false,
            isLoadingSchemas: false,
        } as unknown as ReturnType<typeof useDatabase>);
        vi.mocked(useSavedQueries).mockReturnValue({
            queries: [savedQuery],
            folders: [],
            saveQuery,
            deleteQuery: vi.fn(),
            updateQuery: vi.fn(),
        } as unknown as ReturnType<typeof useSavedQueries>);
        vi.mocked(useQueryHistory).mockReturnValue({
            entries: [],
            isLoading: false,
            deleteEntry: vi.fn(),
            clearHistory: vi.fn(),
            recoveryNotice: null,
            dismissRecoveryNotice: vi.fn(),
        } as unknown as ReturnType<typeof useQueryHistory>);
        vi.mocked(useAlert).mockReturnValue({
            showAlert: vi.fn(),
        } as unknown as ReturnType<typeof useAlert>);
        vi.mocked(useDrivers).mockReturnValue({
            allDrivers: [],
        } as unknown as ReturnType<typeof useDrivers>);
        vi.mocked(useEditor).mockReturnValue({
            tabs: [],
            openNotebook: vi.fn(),
            updateTab: vi.fn(),
            closeTab: vi.fn(),
            addTab: vi.fn(),
            setActiveTabId: vi.fn(),
        } as unknown as ReturnType<typeof useEditor>);
        vi.mocked(useSettings).mockReturnValue({
            settings: {displayTimezone: 'auto'},
        } as unknown as ReturnType<typeof useSettings>);
        vi.mocked(useConnectionLayoutContext).mockReturnValue({
            splitView: {connectionIds: []},
            isSplitVisible: false,
            explorerConnectionId: null,
            setExplorerConnectionId: vi.fn(),
        } as unknown as ReturnType<typeof useConnectionLayoutContext>);
        vi.mocked(useDatabaseObjectNavigation).mockReturnValue({
            open: vi.fn(),
            count: vi.fn(),
            newConsole: vi.fn(),
            openRoutineDefinition: vi.fn(),
            openTriggerDefinition: vi.fn(),
            openDefinition: vi.fn(),
        } as unknown as ReturnType<typeof useDatabaseObjectNavigation>);
    });

    const renderFavorites = () => {
        render(
            <ExplorerSidebar
                sidebarWidth={280}
                startResize={vi.fn()}
                onCollapse={vi.fn()}
                sidebarTab="favorites"
                onSidebarTabChange={vi.fn()}
            />,
        );
    };

    const openSavedQueryMenu = () => {
        renderFavorites();
        fireEvent.contextMenu(screen.getByText('Cleanup'));
    };

    it('opens saved SQL for editing without running it and keeps its database', () => {
        openSavedQueryMenu();
        fireEvent.click(screen.getByText('sidebar.openInEditor'));

        expect(openEditor).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                kind: 'console',
                initialQuery: sql,
                queryName: 'Cleanup',
                preventAutoRun: true,
                database: 'analytics',
                targetConnectionId: 'c1',
            }),
        );
        expect(saveQuery).not.toHaveBeenCalled();
    });

    it('copies the exact SQL and shows a success toast', async () => {
        openSavedQueryMenu();
        fireEvent.click(screen.getByText('sidebar.copyQuery'));

        await waitFor(() => expect(writeText).toHaveBeenCalledWith(sql));
        await waitFor(() =>
            expect(toastSpy).toHaveBeenCalledWith('common.copied', {kind: 'success'}),
        );
    });

    it('shows a failure toast when clipboard write fails', async () => {
        writeText.mockRejectedValueOnce(new Error('Clipboard blocked'));
        openSavedQueryMenu();
        fireEvent.click(screen.getByText('sidebar.copyQuery'));

        await waitFor(() =>
            expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining('Clipboard blocked'), {
                kind: 'error',
            }),
        );
    });

    it('duplicates saved SQL and its database without changing the original', async () => {
        openSavedQueryMenu();
        fireEvent.click(screen.getByText('connections.duplicate'));

        await waitFor(() =>
            expect(saveQuery).toHaveBeenCalledWith('Cleanup (copy)', sql, 'analytics'),
        );
        expect(openEditor).not.toHaveBeenCalled();
    });

    it('reports a failed duplicate without claiming success', async () => {
        saveQuery.mockRejectedValueOnce(new Error('Save failed'));
        openSavedQueryMenu();
        fireEvent.click(screen.getByText('connections.duplicate'));

        await waitFor(() =>
            expect(toastSpy).toHaveBeenCalledWith(expect.stringContaining('Save failed'), {
                kind: 'error',
            }),
        );
    });

    it('runs favorites from the saved database on double-click and Enter', () => {
        renderFavorites();
        const favorite = screen.getByText('Cleanup').closest('button');
        expect(favorite).not.toBeNull();

        fireEvent.doubleClick(favorite!);
        fireEvent.keyDown(favorite!, {key: 'Enter'});

        expect(openEditor).toHaveBeenCalledTimes(2);
        for (const [, request] of vi.mocked(openEditor).mock.calls) {
            expect(request).toMatchObject({
                kind: 'console',
                initialQuery: sql,
                queryName: 'Cleanup',
                preventAutoRun: false,
                database: 'analytics',
                targetConnectionId: 'c1',
            });
            expect(request.schema).toBeUndefined();
        }
    });

    describe('folders', () => {
        const folderRef = {id: 'f1', connection_id: 'c1', name: 'Reports', created_at: null};
        const filed = {
            ...savedQuery,
            id: 'q2',
            name: 'Monthly',
            sql: 'SELECT 1 AS monthly',
            folder_id: 'f1',
        };
        const createFolder = vi.fn();
        const deleteFolder = vi.fn();
        const renameFolder = vi.fn();
        const moveQuery = vi.fn();

        const renderWithFolders = (
            queries: unknown[] = [savedQuery, filed],
            folders: unknown[] = [folderRef],
        ) => {
            vi.mocked(useSavedQueries).mockReturnValue({
                queries,
                folders,
                saveQuery,
                deleteQuery: vi.fn(),
                updateQuery: vi.fn(),
                createFolder,
                renameFolder,
                deleteFolder,
                moveQuery,
            } as unknown as ReturnType<typeof useSavedQueries>);
            renderFavorites();
        };

        beforeEach(() => {
            createFolder.mockReset().mockResolvedValue(undefined);
            deleteFolder.mockReset().mockResolvedValue(undefined);
            renameFolder.mockReset().mockResolvedValue(undefined);
            moveQuery.mockReset().mockResolvedValue(undefined);
        });

        it('keeps the flat unfiled list when there are no folders', () => {
            renderWithFolders([savedQuery], []);
            expect(screen.getByText('Cleanup')).toBeTruthy();
            expect(screen.queryByText('sidebar.unfiled')).toBeNull();
            expect(screen.getByLabelText('sidebar.newFolder')).toBeTruthy();
        });

        it('groups queries under their folder and leaves the rest unfiled', () => {
            renderWithFolders();
            const header = screen.getByRole('button', {name: /^Reports/, expanded: true});
            expect(header.textContent).toContain('1');
            expect(screen.getByText('Monthly')).toBeTruthy();
            expect(screen.getByText('sidebar.unfiled')).toBeTruthy();
            expect(screen.getByText('Cleanup')).toBeTruthy();
        });

        it('collapses and expands a folder', () => {
            renderWithFolders();
            fireEvent.click(screen.getByRole('button', {name: /^Reports/, expanded: true}));
            expect(screen.queryByText('Monthly')).toBeNull();
            fireEvent.click(screen.getByRole('button', {name: /^Reports/, expanded: false}));
            expect(screen.getByText('Monthly')).toBeTruthy();
        });

        it('shows a folder that only exists as an empty folder', () => {
            renderWithFolders([], [folderRef]);
            expect(screen.getByRole('button', {name: /^Reports/})).toBeTruthy();
            expect(screen.queryByText('sidebar.noSavedQueries')).toBeNull();
        });

        it('treats a query pointing at a missing folder as unfiled', () => {
            renderWithFolders([{...savedQuery, folder_id: 'gone'}], [folderRef]);
            expect(screen.getByText('Cleanup')).toBeTruthy();
        });

        it("searches across folders and shows each result's location", () => {
            renderWithFolders();
            fireEvent.change(screen.getByPlaceholderText('sidebar.searchFavorites'), {
                target: {value: 'select 1'},
            });
            expect(screen.getByText('Monthly')).toBeTruthy();
            expect(screen.queryByText('Cleanup')).toBeNull();
            expect(screen.getAllByText('Reports').length).toBe(1);

            fireEvent.change(screen.getByPlaceholderText('sidebar.searchFavorites'), {
                target: {value: 'audit'},
            });
            expect(screen.getByText('Cleanup')).toBeTruthy();
            expect(screen.getByText('sidebar.unfiled')).toBeTruthy();
        });

        it('refuses to delete a non-empty folder and explains why', () => {
            renderWithFolders();
            fireEvent.click(screen.getByLabelText('sidebar.deleteFolder: Reports'));
            expect(toastSpy).toHaveBeenCalledWith('sidebar.folderNotEmpty', {kind: 'error'});
            expect(screen.queryByText('sidebar.confirmDeleteFolder')).toBeNull();
            expect(deleteFolder).not.toHaveBeenCalled();
        });

        it('deletes an empty folder after confirmation', async () => {
            renderWithFolders([savedQuery], [folderRef]);
            fireEvent.click(screen.getByLabelText('sidebar.deleteFolder: Reports'));
            expect(deleteFolder).not.toHaveBeenCalled();
            expect(screen.getByText('sidebar.confirmDeleteFolder')).toBeTruthy();
            fireEvent.click(screen.getByRole('button', {name: 'common.delete'}));
            await waitFor(() => expect(deleteFolder).toHaveBeenCalledWith('f1'));
        });

        it('creates a folder from the name dialog and validates the name first', async () => {
            renderWithFolders();
            fireEvent.click(screen.getByLabelText('sidebar.newFolder'));
            const input = screen.getByLabelText('sidebar.folderName');

            fireEvent.change(input, {target: {value: '   '}});
            fireEvent.click(screen.getByText('sidebar.createFolderAction'));
            expect(screen.getByRole('alert').textContent).toBe('sidebar.folderNameEmpty');
            expect(createFolder).not.toHaveBeenCalled();

            fireEvent.change(input, {target: {value: 'reports'}});
            fireEvent.click(screen.getByText('sidebar.createFolderAction'));
            expect(screen.getByRole('alert').textContent).toBe('sidebar.folderNameDuplicate');

            fireEvent.change(input, {target: {value: '  Ops  '}});
            fireEvent.click(screen.getByText('sidebar.createFolderAction'));
            await waitFor(() => expect(createFolder).toHaveBeenCalledWith('Ops'));
        });

        it('renames a folder, prefilling the dialog and showing backend errors', async () => {
            renameFolder.mockRejectedValueOnce(new Error('Folder not found'));
            renderWithFolders();
            fireEvent.click(screen.getByLabelText('sidebar.renameFolder: Reports'));
            const input = screen.getByLabelText('sidebar.folderName') as HTMLInputElement;
            expect(input.value).toBe('Reports');

            fireEvent.change(input, {target: {value: 'Ops'}});
            fireEvent.click(screen.getByText('sidebar.renameFolderAction'));
            await waitFor(() =>
                expect(screen.getByRole('alert').textContent).toContain('Folder not found'),
            );
            expect(renameFolder).toHaveBeenCalledWith('f1', 'Ops');

            fireEvent.click(screen.getByText('sidebar.renameFolderAction'));
            await waitFor(() => expect(renameFolder).toHaveBeenCalledTimes(2));
        });

        it('titles the delete-folder confirmation for folders, not queries', () => {
            renderWithFolders([savedQuery], [folderRef]);
            fireEvent.click(screen.getByLabelText('sidebar.deleteFolder: Reports'));
            expect(screen.getByText('sidebar.confirmDeleteFolderTitle')).toBeTruthy();
            expect(screen.queryByText('sidebar.confirmDeleteTitle')).toBeNull();
        });

        it('starts the folder dialog fresh each time it opens', () => {
            renderWithFolders();
            fireEvent.click(screen.getByLabelText('sidebar.newFolder'));
            fireEvent.change(screen.getByLabelText('sidebar.folderName'), {
                target: {value: 'Draft'},
            });
            fireEvent.click(screen.getByText('common.cancel'));

            fireEvent.click(screen.getByLabelText('sidebar.newFolder'));
            expect((screen.getByLabelText('sidebar.folderName') as HTMLInputElement).value).toBe(
                '',
            );
            expect(screen.queryByRole('alert')).toBeNull();
        });

        it("shows the backend's message when creating a folder fails", async () => {
            createFolder.mockRejectedValueOnce(
                new Error('The saved query folders file is unreadable.'),
            );
            renderWithFolders();
            fireEvent.click(screen.getByLabelText('sidebar.newFolder'));
            fireEvent.change(screen.getByLabelText('sidebar.folderName'), {target: {value: 'Ops'}});
            fireEvent.click(screen.getByText('sidebar.createFolderAction'));

            await waitFor(() =>
                expect(screen.getByRole('alert').textContent).toBe(
                    'The saved query folders file is unreadable.',
                ),
            );
        });

        it('shows a translated message when the folders file is unreadable', async () => {
            createFolder.mockRejectedValueOnce(FOLDERS_FILE_UNREADABLE);
            renderWithFolders();
            fireEvent.click(screen.getByLabelText('sidebar.newFolder'));
            fireEvent.change(screen.getByLabelText('sidebar.folderName'), {target: {value: 'Ops'}});
            fireEvent.click(screen.getByText('sidebar.createFolderAction'));

            await waitFor(() =>
                expect(screen.getByRole('alert').textContent).toBe('sidebar.foldersFileUnreadable'),
            );
        });

        it('shows a translated message when deleting fails on an unreadable folders file', async () => {
            deleteFolder.mockRejectedValueOnce(FOLDERS_FILE_UNREADABLE);
            renderWithFolders([savedQuery], [folderRef]);
            fireEvent.click(screen.getByLabelText('sidebar.deleteFolder: Reports'));
            fireEvent.click(screen.getByRole('button', {name: 'common.delete'}));

            await waitFor(() =>
                expect(toastSpy).toHaveBeenCalledWith(
                    'sidebar.folderActionFailed: sidebar.foldersFileUnreadable',
                    {kind: 'error'},
                ),
            );
        });

        it("preselects the query's current folder when the move dialog opens", () => {
            renderWithFolders();
            fireEvent.contextMenu(screen.getByText('Monthly'));
            fireEvent.click(screen.getByText('sidebar.moveToFolder'));
            expect(screen.getByText('sidebar.moveAction').closest('button')!.disabled).toBe(true);
            fireEvent.click(screen.getByText('common.cancel'));

            fireEvent.contextMenu(screen.getByText('Cleanup'));
            fireEvent.click(screen.getByText('sidebar.moveToFolder'));
            expect(screen.getByText('sidebar.unfiledFolderOption')).toBeTruthy();
        });

        it('moves a query from its context menu', async () => {
            renderWithFolders();
            fireEvent.contextMenu(screen.getByText('Cleanup'));
            fireEvent.click(screen.getByText('sidebar.moveToFolder'));

            fireEvent.click(screen.getByText('sidebar.unfiledFolderOption'));
            fireEvent.click(screen.getAllByText('Reports').at(-1)!);
            fireEvent.click(screen.getByText('sidebar.moveAction'));

            await waitFor(() => expect(moveQuery).toHaveBeenCalledWith('q1', 'f1'));
        });

        it('shows the SQL excerpt on rows that also show their folder location', () => {
            const deep = {
                ...filed,
                sql: "SELECT id\nFROM orders\nWHERE status = 'shipped'",
            };
            renderWithFolders([savedQuery, deep], [folderRef]);
            fireEvent.change(screen.getByPlaceholderText('sidebar.searchFavorites'), {
                target: {value: 'SHIPPED'},
            });

            const row = screen.getByText('Monthly').closest('button')!;
            expect(row.textContent).toContain('Reports');
            const mark = row.querySelector('mark');
            expect(mark?.textContent).toBe('shipped');
            expect(mark?.parentElement?.textContent).toBe("WHERE status = 'shipped'");

            const unfiledRow = screen.queryByText('Cleanup');
            expect(unfiledRow).toBeNull();
        });

        it('shows the excerpt on unfiled results next to their Unfiled label', () => {
            renderWithFolders();
            fireEvent.change(screen.getByPlaceholderText('sidebar.searchFavorites'), {
                target: {value: 'archived'},
            });
            const row = screen.getByText('Cleanup').closest('button')!;
            expect(row.textContent).toContain('sidebar.unfiled');
            expect(row.querySelector('mark')?.textContent).toBe('archived');
        });

        it('does not show an excerpt on folder rows when not searching', () => {
            renderWithFolders();
            expect(document.querySelector('mark')).toBeNull();
        });

        it('replays a filed query with its saved database', () => {
            renderWithFolders();
            fireEvent.doubleClick(screen.getByText('Monthly').closest('button')!);
            expect(openEditor).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    initialQuery: 'SELECT 1 AS monthly',
                    database: 'analytics',
                    preventAutoRun: false,
                }),
            );
        });
    });

    describe('favorites search excerpt', () => {
        const multiline = {
            ...savedQuery,
            id: 'q2',
            name: 'Report',
            sql: "SELECT id\nFROM orders\nWHERE note = '<img src=x onerror=alert(1)>'",
        };

        const renderWithQueries = () => {
            vi.mocked(useSavedQueries).mockReturnValue({
                queries: [savedQuery, multiline],
                folders: [],
                saveQuery,
                deleteQuery: vi.fn(),
                updateQuery: vi.fn(),
            } as unknown as ReturnType<typeof useSavedQueries>);
            renderFavorites();
        };

        const search = (value: string) =>
            fireEvent.change(screen.getByPlaceholderText('sidebar.searchFavorites'), {
                target: {value},
            });

        it('shows the matching line, highlighted and as plain text', () => {
            renderWithQueries();
            search('<IMG SRC');

            const mark = screen.getByText('<img src', {selector: 'mark'});
            expect(mark.tagName).toBe('MARK');
            expect(mark.parentElement?.textContent).toContain(
                "WHERE note = '<img src=x onerror=alert(1)>'",
            );
            expect(document.querySelector('img')).toBeNull();
            expect(screen.queryByText('Cleanup')).toBeNull();
        });

        it('keeps name-only matches with their default preview', () => {
            renderWithQueries();
            search('cleanup');

            expect(screen.getByText('Cleanup')).toBeTruthy();
            expect(document.querySelector('mark')).toBeNull();
        });

        it('restores the default list when the search is cleared', () => {
            renderWithQueries();
            search('orders');
            expect(document.querySelector('mark')).not.toBeNull();

            search('');
            expect(document.querySelector('mark')).toBeNull();
            expect(screen.getByText('Cleanup')).toBeTruthy();
            expect(screen.getByText('Report')).toBeTruthy();
        });
    });
});
