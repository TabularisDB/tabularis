import {act, renderHook} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
    call: vi.fn(),
    uploadFile: vi.fn(),
    chooseInputFile: vi.fn(),
    readInputBlob: vi.fn(),
    navigate: vi.fn(),
    connect: vi.fn(),
    loadConnections: vi.fn(),
    refreshViews: vi.fn(),
    switchConnection: vi.fn(),
    updateSetting: vi.fn(),
    refreshDrivers: vi.fn(),
    environment: 'tauri' as 'tauri' | 'browser',
    openConnectionIds: [] as string[],
}));

vi.mock('react-router-dom', () => ({useNavigate: () => mocks.navigate}));
vi.mock('@/hooks/useTabularisClient', () => ({
    useTabularisClient: () => ({call: mocks.call, uploadFile: mocks.uploadFile}),
}));
vi.mock('@/hooks/usePlatformCapabilities', () => ({
    usePlatformCapabilities: () => ({
        negotiation: {environment: mocks.environment},
        chooseInputFile: mocks.chooseInputFile,
        readInputBlob: mocks.readInputBlob,
    }),
}));
vi.mock('@/hooks/useDatabase', () => ({
    useDatabase: () => ({
        connect: mocks.connect,
        loadConnections: mocks.loadConnections,
        refreshViews: mocks.refreshViews,
        switchConnection: mocks.switchConnection,
        openConnectionIds: mocks.openConnectionIds,
    }),
}));
vi.mock('@/hooks/useSettings', () => ({
    useSettings: () => ({updateSetting: mocks.updateSetting}),
}));
vi.mock('@/hooks/useDrivers', () => ({
    useDrivers: () => ({refresh: mocks.refreshDrivers}),
}));

import {useOpenDataFile} from '@/hooks/useOpenDataFile';

const sqlite = {id: 'sqlite', name: 'SQLite', capabilities: {file_based: true}};
const duckdb = {
    id: 'duckdb',
    name: 'DuckDB',
    capabilities: {file_based: true, identifier_quote: '"', data_files: ['csv', 'parquet']},
};
const opened = {connectionId: 'files-1', driver: 'duckdb', table: 'orders', format: 'csv'};
const picked = {name: 'orders.csv', reference: '/data/orders.csv'};

/** Answers backend calls; `drivers` is read on every call so a test can change it. */
function backend(state: {drivers: unknown[]; install?: () => Promise<void>}) {
    mocks.call.mockImplementation(async (command: string) => {
        if (command === 'get_registered_drivers') return state.drivers;
        if (command === 'install_plugin') return state.install?.();
        if (command === 'open_data_file') return opened;
        throw new Error(`Unexpected command: ${command}`);
    });
}

const commands = () => mocks.call.mock.calls.map(([command]) => command as string);

describe('useOpenDataFile', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.environment = 'tauri';
        mocks.openConnectionIds = [];
        mocks.chooseInputFile.mockResolvedValue(picked);
        mocks.uploadFile.mockResolvedValue({token: 'upload-1'});
    });

    it('opens a picked file as a table of the workspace connection', async () => {
        backend({drivers: [sqlite, duckdb]});
        const {result} = renderHook(() => useOpenDataFile());

        await act(() => result.current.open());

        expect(mocks.chooseInputFile).toHaveBeenCalledWith({
            title: 'dataFiles.open',
            filters: [{name: 'dataFiles.fileFilter', extensions: ['csv', 'parquet', 'pq']}],
        });
        expect(mocks.call).toHaveBeenCalledWith('open_data_file', {
            filePath: '/data/orders.csv',
            workspaceName: 'dataFiles.workspaceName',
        });
        expect(mocks.loadConnections).toHaveBeenCalled();
        expect(mocks.connect).toHaveBeenCalledWith('files-1');
        expect(mocks.navigate).toHaveBeenCalledWith('/connections/files-1/editor', {
            state: expect.objectContaining({
                kind: 'table',
                tableName: 'orders',
                initialQuery: 'SELECT * FROM "orders"',
                targetConnectionId: 'files-1',
            }),
        });
        expect(result.current.stage).toEqual({kind: 'idle'});
    });

    it('uploads the file first in the browser', async () => {
        mocks.environment = 'browser';
        const blob = new Blob(['id\n1\n']);
        mocks.readInputBlob.mockResolvedValue(blob);
        backend({drivers: [duckdb]});
        const {result} = renderHook(() => useOpenDataFile());

        await act(() => result.current.open([{name: 'orders.csv', reference: 'browser-file:1'}]));

        expect(mocks.chooseInputFile).not.toHaveBeenCalled();
        expect(mocks.uploadFile).toHaveBeenCalledWith({
            contents: blob,
            fileName: 'orders.csv',
            purpose: 'data-file',
        });
        expect(mocks.call).toHaveBeenCalledWith('open_data_file', {
            uploadToken: 'upload-1',
            workspaceName: 'dataFiles.workspaceName',
        });
    });

    it('refreshes and focuses the workspace when it is already open', async () => {
        mocks.openConnectionIds = ['files-1'];
        backend({drivers: [duckdb]});
        const {result} = renderHook(() => useOpenDataFile());

        await act(() => result.current.open([picked]));

        expect(mocks.connect).not.toHaveBeenCalled();
        expect(mocks.refreshViews).toHaveBeenCalledWith('files-1');
        expect(mocks.switchConnection).toHaveBeenCalledWith('files-1');
    });

    it('does nothing when the picker is cancelled', async () => {
        mocks.chooseInputFile.mockResolvedValue(null);
        backend({drivers: [duckdb]});
        const {result} = renderHook(() => useOpenDataFile());

        await act(() => result.current.open());

        expect(commands()).toEqual(['get_registered_drivers']);
        expect(result.current.stage).toEqual({kind: 'idle'});
    });

    it('rejects files that are not data files without asking for a plugin', async () => {
        backend({drivers: [sqlite]});
        const {result} = renderHook(() => useOpenDataFile());
        const files = [picked, {name: 'notes.txt', reference: '/data/notes.txt'}];

        await act(() => result.current.open(files));

        expect(result.current.stage).toEqual({
            kind: 'error',
            files,
            message: 'dataFiles.unsupported',
        });
        expect(commands()).not.toContain('open_data_file');
    });

    it('asks before installing the plugin, then opens the waiting file', async () => {
        const state = {drivers: [sqlite] as unknown[], install: async () => undefined};
        state.install = async () => {
            state.drivers = [sqlite, duckdb];
        };
        backend(state);
        const {result} = renderHook(() => useOpenDataFile());

        await act(() => result.current.open([picked]));

        expect(result.current.stage).toEqual({kind: 'plugin-required', files: [picked]});
        expect(commands()).toEqual(['get_registered_drivers']);

        await act(() => result.current.installAndOpen());

        expect(mocks.call).toHaveBeenCalledWith(
            'install_plugin',
            {pluginId: 'duckdb'},
            {deadlineMs: expect.any(Number)},
        );
        expect(mocks.refreshDrivers).toHaveBeenCalled();
        expect(mocks.call).toHaveBeenCalledWith('open_data_file', {
            filePath: '/data/orders.csv',
            workspaceName: 'dataFiles.workspaceName',
        });
        expect(mocks.connect).toHaveBeenCalledWith('files-1');
        expect(result.current.stage).toEqual({kind: 'idle'});
    });

    it('activates the installed plugin without narrowing an absent preference', async () => {
        const state = {drivers: [sqlite] as unknown[], install: async () => undefined};
        state.install = async () => {
            state.drivers = [duckdb];
        };
        backend(state);
        const {result} = renderHook(() => useOpenDataFile());
        await act(() => result.current.open([picked]));
        await act(() => result.current.installAndOpen());

        const [key, updater] = mocks.updateSetting.mock.calls[0] as [
            string,
            (active: string[] | null | undefined) => string[] | null | undefined,
        ];
        expect(key).toBe('activeExternalDrivers');
        expect(updater(undefined)).toBeUndefined();
        expect(updater(null)).toBeNull();
        expect(updater(['redis'])).toEqual(['redis', 'duckdb']);
        expect(updater(['duckdb'])).toEqual(['duckdb']);
    });

    it('lets a failed install be retried', async () => {
        const state = {
            drivers: [sqlite] as unknown[],
            install: vi.fn<() => Promise<void>>().mockRejectedValueOnce(new Error('offline')),
        };
        backend(state);
        const {result} = renderHook(() => useOpenDataFile());
        await act(() => result.current.open([picked]));

        await act(() => result.current.installAndOpen());

        expect(result.current.stage).toEqual({
            kind: 'error',
            files: [picked],
            message: 'offline',
            retryInstall: true,
        });

        state.install.mockImplementationOnce(async () => {
            state.drivers = [duckdb];
        });
        await act(() => result.current.installAndOpen());

        expect(result.current.stage).toEqual({kind: 'idle'});
        expect(mocks.connect).toHaveBeenCalledWith('files-1');
    });

    it('explains when the installed plugin still cannot open the file', async () => {
        backend({drivers: [sqlite], install: async () => undefined});
        const {result} = renderHook(() => useOpenDataFile());
        await act(() => result.current.open([picked]));

        await act(() => result.current.installAndOpen());

        expect(result.current.stage).toEqual({
            kind: 'error',
            files: [picked],
            message: 'dataFiles.pluginCannotOpen',
        });
        expect(commands()).not.toContain('open_data_file');

        await act(() => result.current.installAndOpen());
        expect(commands().filter((command) => command === 'install_plugin')).toHaveLength(1);
    });

    it('reports a failed open and can be dismissed', async () => {
        mocks.call.mockImplementation(async (command: string) => {
            if (command === 'get_registered_drivers') return [duckdb];
            throw new Error('Failed to open data file: malformed CSV');
        });
        const {result} = renderHook(() => useOpenDataFile());

        await act(() => result.current.open([picked]));

        expect(result.current.stage).toEqual({
            kind: 'error',
            files: [picked],
            message: 'Failed to open data file: malformed CSV',
        });
        expect(mocks.connect).not.toHaveBeenCalled();

        act(() => result.current.dismiss());
        expect(result.current.stage).toEqual({kind: 'idle'});
    });

    it('shows the files that opened before reporting the one that failed', async () => {
        let calls = 0;
        mocks.call.mockImplementation(async (command: string) => {
            if (command === 'get_registered_drivers') return [duckdb];
            calls += 1;
            if (calls === 2) throw new Error('Failed to open data file: malformed CSV');
            return opened;
        });
        const files = [picked, {name: 'broken.csv', reference: '/data/broken.csv'}];
        const {result} = renderHook(() => useOpenDataFile());

        await act(() => result.current.open(files));

        expect(mocks.loadConnections).toHaveBeenCalled();
        expect(mocks.connect).toHaveBeenCalledWith('files-1');
        expect(mocks.navigate).toHaveBeenCalledWith(
            '/connections/files-1/editor',
            expect.objectContaining({state: expect.objectContaining({tableName: 'orders'})}),
        );
        expect(result.current.stage).toEqual({
            kind: 'error',
            files,
            message: 'Failed to open data file: malformed CSV',
        });
    });

    it('opens files requested during another open once it has finished', async () => {
        const releases: (() => void)[] = [];
        mocks.call.mockImplementation((command: string) => {
            if (command === 'get_registered_drivers') return Promise.resolve([duckdb]);
            return new Promise((resolve) => releases.push(() => resolve(opened)));
        });
        const second = {name: 'second.csv', reference: '/data/second.csv'};
        const third = {name: 'third.csv', reference: '/data/third.csv'};
        const {result} = renderHook(() => useOpenDataFile());

        let first: Promise<void> = Promise.resolve();
        await act(async () => {
            first = result.current.open([picked]);
            await Promise.resolve();
        });
        await act(() => result.current.open([second]));
        await act(() => result.current.open([third]));
        const openCalls = () =>
            mocks.call.mock.calls.filter(([command]) => command === 'open_data_file');
        expect(openCalls()).toHaveLength(1);

        await act(async () => {
            releases[0]();
            await first;
        });
        // The two waiting files open together, in the order they arrived.
        await act(async () => {
            releases[1]();
            await Promise.resolve();
        });
        await act(async () => {
            releases[2]();
            await Promise.resolve();
        });

        expect(openCalls().map(([, request]) => (request as {filePath: string}).filePath)).toEqual([
            '/data/orders.csv',
            '/data/second.csv',
            '/data/third.csv',
        ]);
        expect(result.current.stage).toEqual({kind: 'idle'});
    });

    it('keeps files that arrive during a prompt until the user answers it', async () => {
        backend({drivers: [sqlite]});
        const later = {name: 'later.csv', reference: '/data/later.csv'};
        const {result} = renderHook(() => useOpenDataFile());
        await act(() => result.current.open([picked]));
        expect(result.current.stage.kind).toBe('plugin-required');

        await act(() => result.current.open([later]));
        expect(result.current.stage).toEqual({kind: 'plugin-required', files: [picked]});

        await act(async () => {
            result.current.dismiss();
            await Promise.resolve();
        });
        expect(result.current.stage).toEqual({kind: 'plugin-required', files: [later]});
    });

    it('keeps a quick open silent and reveals a slow one', async () => {
        vi.useFakeTimers();
        let finishOpen: (value: typeof opened) => void = () => undefined;
        mocks.call.mockImplementation((command: string) => {
            if (command === 'get_registered_drivers') return Promise.resolve([duckdb]);
            return new Promise((resolve) => {
                finishOpen = resolve;
            });
        });
        const {result} = renderHook(() => useOpenDataFile());

        let pending: Promise<void> = Promise.resolve();
        await act(async () => {
            pending = result.current.open([picked]);
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(result.current.stage).toEqual({kind: 'opening', files: [picked], quiet: true});

        // Asking to pick another file is ignored while the first one opens.
        await act(() => result.current.open());
        act(() => result.current.dismiss());
        expect(result.current.stage.kind).toBe('opening');

        await act(() => vi.advanceTimersByTimeAsync(400));
        expect(result.current.stage).toEqual({kind: 'opening', files: [picked], quiet: false});

        await act(async () => {
            finishOpen(opened);
            await pending;
        });
        expect(result.current.stage).toEqual({kind: 'idle'});
        vi.useRealTimers();
    });
});
