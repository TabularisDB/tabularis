import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Connections} from '@/pages/Connections';
import {invoke} from '@tauri-apps/api/core';
import type {ConnectionGroup, SavedConnection} from '@/contexts/DatabaseContext';
import {STANDALONE_CONNECTION_CAPABILITIES, type ConnectionCapabilities} from '@/api/session';

const mocks = vi.hoisted(() => ({
    connect: vi.fn(),
    connectionGroups: [] as ConnectionGroup[],
    moveGroupToParent: vi.fn(),
    reorderGroups: vi.fn(),
    moveConnectionToGroup: vi.fn(),
    connections: [] as SavedConnection[],
    createSqliteDatabase: vi.fn(),
    drivers: [],
    loadConnections: vi.fn(),
    navigate: vi.fn(),
    openConnectionInNewWindow: vi.fn(),
    reorderConnectionsInGroup: vi.fn(),
    settings: {autoConnectLastConnection: false},
    isSettingsLoading: false,
    locationState: null as unknown,
    capabilities: null as unknown as ConnectionCapabilities,
    toggleGroupCollapsed: vi.fn(),
}));

mocks.capabilities = STANDALONE_CONNECTION_CAPABILITIES;

vi.mock('lucide-react', async (importOriginal) => ({
    ...(await importOriginal<typeof import('lucide-react')>()),
    AlertCircle: () => null,
    AppWindow: () => null,
    ChevronDown: () => null,
    ChevronRight: () => null,
    Check: () => null,
    Database: () => null,
    Download: () => null,
    Edit: () => null,
    Folder: () => null,
    FolderInput: () => null,
    FolderPlus: () => null,
    FolderTree: () => null,
    LayoutGrid: () => null,
    List: () => null,
    Loader2: () => null,
    Plus: () => null,
    Search: () => null,
    Trash2: () => null,
    X: () => null,
}));

vi.mock('react-router-dom', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-router-dom')>()),
    useLocation: () => ({state: mocks.locationState}),
    useNavigate: () => mocks.navigate,
}));

vi.mock('@/hooks/useDatabase', () => ({
    useDatabase: () => ({
        connect: mocks.connect,
        disconnect: vi.fn(),
        isConnectionOpen: () => false,
        isConnectionOpenAnywhere: () => false,
        switchConnection: vi.fn(),
        connectionGroups: mocks.connectionGroups,
        createGroupPath: vi.fn(),
        updateGroup: vi.fn(),
        moveGroupToParent: mocks.moveGroupToParent,
        deleteGroup: vi.fn(),
        moveConnectionToGroup: mocks.moveConnectionToGroup,
        reorderConnectionsInGroup: mocks.reorderConnectionsInGroup,
        reorderGroups: mocks.reorderGroups,
        toggleGroupCollapsed: mocks.toggleGroupCollapsed,
        loadConnections: mocks.loadConnections,
        connections: mocks.connections,
    }),
}));

vi.mock('@/hooks/useTabularisClient', () => ({
    useTabularisClient: () => ({call: invoke}),
}));

const platformMock = vi.hoisted(() => ({
    negotiation: {environment: 'tauri'},
    downloadFile: vi.fn(),
    currentWindowLabel: vi.fn(() => 'main'),
}));
vi.mock('@/hooks/usePlatformCapabilities', () => ({
    usePlatformCapabilities: () => platformMock,
}));

vi.mock('@/hooks/useDrivers', () => ({
    useDrivers: () => ({drivers: mocks.drivers, allDrivers: mocks.drivers, installedPlugins: []}),
}));

vi.mock('@/hooks/usePluginRegistry', () => ({
    usePluginRegistry: () => ({
        plugins: [],
        updates: [],
        loading: false,
        error: null,
        refresh: vi.fn(),
    }),
}));

vi.mock('@/hooks/useSettings', () => ({
    useSettings: () => ({settings: mocks.settings, isLoading: mocks.isSettingsLoading}),
}));

vi.mock('@/hooks/useConnectionCapabilities', () => ({
    useConnectionCapabilities: () => mocks.capabilities,
}));

vi.mock('@/hooks/useConnectionTags', () => ({
    useConnectionTags: () => ({
        tags: [],
        refresh: vi.fn().mockResolvedValue(undefined),
        createTag: vi.fn(),
        updateTag: vi.fn(),
        deleteTag: vi.fn(),
    }),
}));

vi.mock('@/hooks/useOpenConnectionInNewWindow', () => ({
    useOpenConnectionInNewWindow: () => mocks.openConnectionInNewWindow,
}));

vi.mock('@/hooks/useCreateSqliteDatabase', () => ({
    useCreateSqliteDatabase: () => ({
        createSqliteDatabase: mocks.createSqliteDatabase,
        isCreating: false,
    }),
}));

// The migration banner hook pulls in useConnectionCatalogue and others the
// SQLite-creation tests don't otherwise need. Mock it to a hidden-banner
// no-op so the tests stay focused on the SQLite action.
vi.mock('@/hooks/useBuiltinDriverMigration', () => ({
    useBuiltinPostgresMigration: () => ({
        builtinId: 'postgres',
        pluginId: 'postgresql',
        builtinConnections: [],
        needsMigration: false,
        pluginReady: false,
        registryOffline: false,
        banner: null,
        dismissBanner: vi.fn(),
        migrateConnection: vi.fn(),
        undoMigration: vi.fn(),
    }),
}));

// Connections.tsx also calls useConnectionCatalogue directly (for the
// migration outcome toast's repo_url lookup) — mock it the same way.
vi.mock('@/hooks/useConnectionCatalogue', () => ({
    useConnectionCatalogue: () => ({
        groups: [],
        facets: [],
        loading: false,
        registryOffline: false,
        registry: [],
        refresh: vi.fn(),
    }),
}));

vi.mock('@/components/modals/NewConnectionModal', () => ({
    NewConnectionModal: () => null,
}));

vi.mock('@/components/modals/ConfirmModal', () => ({
    ConfirmModal: ({isOpen, onConfirm}: {isOpen: boolean; onConfirm: () => void}) =>
        isOpen ? <button onClick={onConfirm}>confirm-modal-confirm</button> : null,
}));

vi.mock('@/components/modals/ExportConnectionsModal', () => ({
    ExportConnectionsModal: () => null,
}));

vi.mock('@/components/modals/ImportFromAppModal', () => ({
    ImportFromAppModal: () => null,
}));

const sqliteConnection = {
    id: 'sqlite-1',
    name: 'customers',
    params: {
        driver: 'sqlite',
        database: '/tmp/customers.db',
    },
};

describe('Connections SQLite database action', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.connections = [];
        mocks.isSettingsLoading = false;
        mocks.settings.autoConnectLastConnection = false;
        mocks.connect.mockResolvedValue(undefined);
        mocks.createSqliteDatabase.mockResolvedValue(sqliteConnection);
        mocks.loadConnections.mockResolvedValue(undefined);
    });

    it('creates, refreshes, and opens a database from the empty state', async () => {
        render(<Connections />);

        fireEvent.click(screen.getByText('connections.newSqliteDatabase.menuLabel'));

        await waitFor(() => {
            expect(mocks.createSqliteDatabase).toHaveBeenCalledTimes(1);
            expect(mocks.loadConnections).toHaveBeenCalledTimes(2);
            expect(mocks.connect).toHaveBeenCalledWith('sqlite-1');
            expect(mocks.navigate).toHaveBeenCalledWith('/connections/sqlite-1/editor');
        });
    });

    it('also exposes the action in the add-connection menu', () => {
        render(<Connections />);

        fireEvent.click(screen.getByTitle('connections.addConnection'));

        expect(screen.getAllByText('connections.newSqliteDatabase.menuLabel')).toHaveLength(2);
    });

    it('shows a creation error without attempting to connect', async () => {
        mocks.createSqliteDatabase.mockRejectedValue(new Error('permission denied'));
        render(<Connections />);

        fireEvent.click(screen.getByText('connections.newSqliteDatabase.menuLabel'));

        expect(await screen.findByText('connections.newSqliteDatabase.error')).toBeInTheDocument();
        expect(mocks.connect).not.toHaveBeenCalled();
    });

    it('waits for persisted settings before deciding whether to restore a session', async () => {
        mocks.connections = [sqliteConnection];
        mocks.settings.autoConnectLastConnection = true;
        mocks.isSettingsLoading = true;
        const {rerender} = render(<Connections />);
        expect(invoke).not.toHaveBeenCalledWith('get_last_open_connections');
        // The actual setting disables restore; the default must never win the race.
        mocks.settings.autoConnectLastConnection = false;
        mocks.isSettingsLoading = false;
        rerender(<Connections />);
        expect(invoke).not.toHaveBeenCalledWith('get_last_open_connections');
        expect(mocks.connect).not.toHaveBeenCalled();
    });
});

describe('Connections ordering', () => {
    const conn = (id: string, sort_order?: number) =>
        ({
            id,
            name: id,
            params: {driver: 'sqlite', database: `/tmp/${id}.db`},
            sort_order,
        }) as SavedConnection;
    const card = (id: string) =>
        document.querySelector(`[data-connection-id="${id}"]`) as HTMLElement;
    const renderedIds = () =>
        [...document.querySelectorAll('[data-connection-id]')].map((el) =>
            el.getAttribute('data-connection-id'),
        );
    const originalElementFromPoint = document.elementFromPoint;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.settings.autoConnectLastConnection = false;
        mocks.isSettingsLoading = false;
        mocks.reorderConnectionsInGroup.mockResolvedValue(undefined);
    });

    afterEach(() => {
        document.elementFromPoint = originalElementFromPoint;
    });

    it('lists connections without a sort order after ordered ones', () => {
        mocks.connections = [conn('fresh'), conn('b', 1), conn('a', 0)];
        render(<Connections />);
        expect(renderedIds()).toEqual(['a', 'b', 'fresh']);
    });

    const atRect = (el: HTMLElement) => {
        el.getBoundingClientRect = () =>
            ({top: 0, bottom: 80, left: 0, right: 60, height: 80, width: 60}) as DOMRect;
        return el;
    };

    afterEach(() => {
        mocks.connectionGroups = [];
    });

    it('places a connection after the card when dropped on its right half', async () => {
        mocks.connections = [conn('a', 0), conn('b', 1), conn('c', 2)];
        render(<Connections />);
        document.elementFromPoint = vi.fn(() => atRect(card('c')));

        fireEvent.mouseDown(card('a'), {button: 0, clientX: 0, clientY: 0});
        fireEvent.mouseMove(document, {clientX: 40, clientY: 40});
        expect(screen.getByTestId('connection-drop-after')).toBeInTheDocument();
        fireEvent.mouseUp(document, {clientX: 40, clientY: 40});

        await waitFor(() =>
            expect(mocks.reorderConnectionsInGroup).toHaveBeenCalledWith([
                ['b', 0],
                ['c', 1],
                ['a', 2],
            ]),
        );
    });
});

describe('Connections delete', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.settings.autoConnectLastConnection = false;
        mocks.isSettingsLoading = false;
        mocks.connections = [sqliteConnection as SavedConnection];
    });

    it('shows the backend error when a delete fails instead of failing silently', async () => {
        vi.mocked(invoke).mockImplementation(async (cmd: string) => {
            if (cmd === 'delete_connection') {
                throw 'Failed to read the stored connection URI from the OS keychain';
            }
            return undefined;
        });
        render(<Connections />);

        fireEvent.click(screen.getAllByTitle('connections.delete')[0]);
        fireEvent.click(screen.getByText('confirm-modal-confirm'));

        expect(await screen.findByText(/connections\.failDelete/)).toBeInTheDocument();
    });
});

describe('Connections drop next to a card in another folder', () => {
    const originalElementFromPoint = document.elementFromPoint;

    afterEach(() => {
        document.elementFromPoint = originalElementFromPoint;
        mocks.connectionGroups = [];
    });

    it('moves the connection into that folder at the marked position', async () => {
        vi.clearAllMocks();
        mocks.settings.autoConnectLastConnection = false;
        mocks.isSettingsLoading = false;
        mocks.connectionGroups = [{id: 'g', name: 'G', collapsed: false, sort_order: 0}];
        mocks.connections = [
            {id: 'a', name: 'a', params: {driver: 'sqlite', database: '/tmp/a.db'}},
            {
                id: 'b',
                name: 'b',
                params: {driver: 'sqlite', database: '/tmp/b.db'},
                group_id: 'g',
                sort_order: 0,
            },
        ] as SavedConnection[];
        mocks.moveConnectionToGroup.mockResolvedValue(undefined);
        mocks.reorderConnectionsInGroup.mockResolvedValue(undefined);
        render(<Connections />);
        const target = document.querySelector('[data-connection-id="b"]') as HTMLElement;
        target.getBoundingClientRect = () =>
            ({top: 0, bottom: 80, left: 0, right: 60, height: 80, width: 60}) as DOMRect;
        document.elementFromPoint = vi.fn(() => target);

        const source = document.querySelector('[data-connection-id="a"]') as HTMLElement;
        fireEvent.mouseDown(source, {button: 0, clientX: 0, clientY: 0});
        fireEvent.mouseMove(document, {clientX: 50, clientY: 40});
        fireEvent.mouseUp(document, {clientX: 50, clientY: 40});

        await waitFor(() => {
            expect(mocks.moveConnectionToGroup).toHaveBeenCalledWith('a', 'g', 1);
            expect(mocks.reorderConnectionsInGroup).toHaveBeenCalledWith([
                ['b', 0],
                ['a', 1],
            ]);
        });
    });
});

describe('Connections folder drag', () => {
    const originalElementFromPoint = document.elementFromPoint;
    const header = (id: string) =>
        document.querySelector(`[data-group-header-id="${id}"]`) as HTMLElement;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.connections = [sqliteConnection as SavedConnection];
        mocks.settings.autoConnectLastConnection = false;
        mocks.isSettingsLoading = false;
        mocks.connectionGroups = [
            {id: 'pg', name: 'PG', collapsed: false, sort_order: 0},
            {id: 'ch', name: 'CH', collapsed: false, sort_order: 1},
            {id: 'pg-in-ch', name: 'PG2', collapsed: false, sort_order: 0, parent_id: 'ch'},
        ];
        mocks.moveGroupToParent.mockResolvedValue(undefined);
        mocks.reorderGroups.mockResolvedValue(undefined);
    });

    afterEach(() => {
        document.elementFromPoint = originalElementFromPoint;
        mocks.connectionGroups = [];
    });

    it('moves a nested folder back to the top level when dropped above a root folder', async () => {
        render(<Connections />);
        const target = header('pg');
        target.getBoundingClientRect = () =>
            ({top: 100, bottom: 130, left: 0, right: 500, height: 30, width: 500}) as DOMRect;
        document.elementFromPoint = vi.fn(() => target);

        const grip = header('pg-in-ch').querySelector('[data-group-grip]') as HTMLElement;
        fireEvent.mouseDown(grip, {clientX: 0, clientY: 0});
        fireEvent.mouseMove(document, {clientX: 50, clientY: 102});
        expect(screen.getByTestId('group-drop-before')).toBeInTheDocument();
        fireEvent.mouseUp(document, {clientX: 50, clientY: 102});

        await waitFor(() => {
            expect(mocks.moveGroupToParent).toHaveBeenCalledWith('pg-in-ch', null);
            expect(mocks.reorderGroups).toHaveBeenCalledWith([
                ['pg-in-ch', 0],
                ['pg', 1],
                ['ch', 2],
            ]);
        });
    });
});

describe('Connections link errors', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.connections = [];
        mocks.loadConnections.mockResolvedValue(undefined);
    });

    afterEach(() => {
        mocks.locationState = null;
    });

    it('explains why a connection link did not open', () => {
        mocks.locationState = {connectionLinkError: 'Connection not found'};

        render(<Connections />);

        expect(screen.getByText('connections.linkUnavailable')).toBeInTheDocument();
    });

    it('shows no banner on a normal visit', () => {
        render(<Connections />);

        expect(screen.queryByText('connections.linkUnavailable')).not.toBeInTheDocument();
    });
});

describe('Connections in managed mode', () => {
    const card = (id: string) =>
        document.querySelector(`[data-connection-id="${id}"]`) as HTMLElement | null;
    const managedConnection = (id: string, group_id?: string) =>
        ({
            id,
            name: id,
            group_id,
            params: {driver: 'sqlite', database: `/tmp/${id}.db`},
        }) as SavedConnection;
    const managed: ConnectionCapabilities = {
        ...STANDALONE_CONNECTION_CAPABILITIES,
        managed: true,
        canCreate: false,
        canUpdate: false,
        canDelete: false,
        canDuplicate: false,
        canImport: false,
        canExport: false,
        canTest: false,
        canEditBranding: false,
        canEditOrganization: false,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.settings.autoConnectLastConnection = false;
        mocks.isSettingsLoading = false;
        mocks.connections = [managedConnection('a'), managedConnection('b', 'g1')];
        mocks.connectionGroups = [
            {id: 'g1', name: 'Group', collapsed: false, sort_order: 0, parent_id: null},
        ] as ConnectionGroup[];
        mocks.capabilities = managed;
        mocks.drivers = [
            {
                id: 'sqlite',
                name: 'SQLite',
                capabilities: {
                    schemas: false,
                    views: true,
                    routines: false,
                    file_based: true,
                    folder_based: false,
                    identifier_quote: '"',
                    alter_primary_key: false,
                },
            },
        ] as unknown as never[];
    });

    afterEach(() => {
        mocks.capabilities = STANDALONE_CONNECTION_CAPABILITIES;
        mocks.connections = [];
        mocks.connectionGroups = [];
        mocks.drivers = [];
    });

    it('explains that the connections are managed and hides every management action', () => {
        render(<Connections />);

        expect(screen.getByTestId('managed-connections-notice')).toBeInTheDocument();
        expect(screen.queryByText('connections.addConnection')).not.toBeInTheDocument();
        expect(screen.queryByTitle('connections.addConnection')).not.toBeInTheDocument();
        expect(screen.queryByTitle('groups.newGroup')).not.toBeInTheDocument();
        expect(screen.queryByTitle('connections.export')).not.toBeInTheDocument();
        for (const title of ['connections.edit', 'connections.clone', 'connections.delete']) {
            expect(screen.queryByTitle(title)).not.toBeInTheDocument();
        }
    });

    it('keeps the connections usable', () => {
        render(<Connections />);

        expect(card('a')).toBeInTheDocument();
        expect(card('b')).toBeInTheDocument();
        expect(screen.getAllByTitle('connections.connect')).toHaveLength(2);
    });

    it('offers no bulk selection when nothing can be done with a selection', () => {
        render(<Connections />);

        expect(card('a')?.querySelector('[aria-pressed]')).toBeNull();
    });

    it('offers bulk selection when a selection can be exported, moved or deleted', () => {
        mocks.capabilities = {...managed, canExport: true};
        render(<Connections />);

        expect(card('a')?.querySelector('[aria-pressed]')).not.toBeNull();
    });

    describe('dragging a connection onto another', () => {
        const originalElementFromPoint = document.elementFromPoint;
        const drag = () => {
            const target = card('b')!;
            target.getBoundingClientRect = () =>
                ({top: 0, bottom: 80, left: 0, right: 60, height: 80, width: 60}) as DOMRect;
            document.elementFromPoint = vi.fn(() => target);
            fireEvent.mouseDown(card('a')!, {button: 0, clientX: 0, clientY: 0});
            fireEvent.mouseMove(document, {clientX: 40, clientY: 40});
            fireEvent.mouseUp(document, {clientX: 40, clientY: 40});
        };

        afterEach(() => {
            document.elementFromPoint = originalElementFromPoint;
        });

        it('does nothing when the session cannot change groups', () => {
            render(<Connections />);

            drag();

            expect(screen.queryByTestId('connection-drop-after')).not.toBeInTheDocument();
            expect(mocks.moveConnectionToGroup).not.toHaveBeenCalled();
            expect(mocks.reorderConnectionsInGroup).not.toHaveBeenCalled();
        });

        it('moves it when the session may change groups', async () => {
            mocks.capabilities = {...managed, canEditOrganization: true};
            render(<Connections />);

            drag();

            await waitFor(() =>
                expect(
                    mocks.moveConnectionToGroup.mock.calls.length +
                        mocks.reorderConnectionsInGroup.mock.calls.length,
                ).toBeGreaterThan(0),
            );
        });
    });

    it('shows the group without rename, subfolder or menu actions', () => {
        render(<Connections />);

        expect(screen.getByText('Group')).toBeInTheDocument();
        expect(screen.queryByTitle('Add subfolder')).not.toBeInTheDocument();
        fireEvent.contextMenu(screen.getByText('Group'));
        expect(screen.queryByText('groups.rename')).not.toBeInTheDocument();
        expect(screen.queryByText('groups.delete')).not.toBeInTheDocument();
    });

    it('collapses a group in this view without saving it to the shared groups', () => {
        render(<Connections />);
        expect(card('b')).not.toBeNull();

        fireEvent.click(screen.getByText('Group'));

        expect(card('b')).toBeNull();
        expect(mocks.toggleGroupCollapsed).not.toHaveBeenCalled();
    });

    it('saves a collapsed group when the session may change groups', async () => {
        mocks.capabilities = {...managed, canEditOrganization: true};
        render(<Connections />);

        fireEvent.click(screen.getByText('Group'));

        await waitFor(() => expect(mocks.toggleGroupCollapsed).toHaveBeenCalledWith('g1'));
    });

    it('shows a managed empty state without a way to create a connection', () => {
        mocks.connections = [];
        render(<Connections />);

        expect(screen.getByText('managed.noConnections')).toBeInTheDocument();
        expect(screen.queryByText('connections.createFirst')).not.toBeInTheDocument();
        expect(screen.queryByText('connections.importFromApp.menuLabel')).not.toBeInTheDocument();
        expect(
            screen.queryByText('connections.newSqliteDatabase.menuLabel'),
        ).not.toBeInTheDocument();
    });

    it('lets an operator allow organization on its own', () => {
        mocks.capabilities = {...managed, canEditOrganization: true};
        render(<Connections />);

        expect(screen.getByTitle('groups.newGroup')).toBeInTheDocument();
        expect(screen.queryByTitle('connections.export')).not.toBeInTheDocument();
        expect(screen.queryByTitle('connections.addConnection')).not.toBeInTheDocument();
        expect(screen.queryByTitle('connections.delete')).not.toBeInTheDocument();
    });

    it('is unchanged outside managed mode', () => {
        mocks.capabilities = STANDALONE_CONNECTION_CAPABILITIES;
        render(<Connections />);

        expect(screen.queryByTestId('managed-connections-notice')).not.toBeInTheDocument();
        expect(screen.getByTitle('connections.addConnection')).toBeInTheDocument();
        expect(screen.getByTitle('groups.newGroup')).toBeInTheDocument();
        expect(screen.getByTitle('connections.export')).toBeInTheDocument();
        expect(card('a')?.querySelector('[aria-pressed]')).not.toBeNull();
        expect(screen.getAllByTitle('connections.edit')).toHaveLength(2);
        expect(screen.getAllByTitle('connections.delete')).toHaveLength(2);
    });
});
