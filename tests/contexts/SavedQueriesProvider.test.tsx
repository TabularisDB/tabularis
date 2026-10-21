import {describe, it, expect, vi, beforeEach} from 'vitest';
import {renderHook, waitFor} from '@testing-library/react';
import {SavedQueriesProvider} from '@/contexts/SavedQueriesProvider';
import {useSavedQueries} from '@/hooks/useSavedQueries';
import {useDatabase} from '@/hooks/useDatabase';
import {invoke} from '@tauri-apps/api/core';
import React from 'react';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

// Mock useDatabase
vi.mock('@/hooks/useDatabase', () => ({
    useDatabase: vi.fn(),
}));

type Backend = {
    queries?: unknown[];
    folders?: unknown[];
    fail?: Record<string, Error>;
    /** Runs when a command is invoked, to simulate the backend changing state. */
    effects?: Record<string, () => void>;
};

// Routes by command so tests don't depend on how many reads a refresh makes.
const mockBackend = (backend: Backend) => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
        if (backend.fail?.[cmd]) throw backend.fail[cmd];
        backend.effects?.[cmd]?.();
        if (cmd === 'get_saved_queries') return backend.queries ?? [];
        if (cmd === 'get_saved_query_folders') return backend.folders ?? [];
        return undefined;
    });
    return backend;
};

describe('SavedQueriesProvider', () => {
    const mockQueries = [
        {id: 'query-1', name: 'All Users', sql: 'SELECT * FROM users', connection_id: 'conn-123'},
        {
            id: 'query-2',
            name: 'Active Orders',
            sql: 'SELECT * FROM orders WHERE status = "active"',
            connection_id: 'conn-123',
        },
    ];

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useDatabase).mockReturnValue({
            activeConnectionId: 'conn-123',
        } as ReturnType<typeof useDatabase>);
    });

    it('should provide initial empty state', () => {
        mockBackend({});

        const wrapper = ({children}: {children: React.ReactNode}) =>
            React.createElement(SavedQueriesProvider, null, children);

        const {result} = renderHook(() => useSavedQueries(), {wrapper});

        expect(result.current.queries).toHaveLength(0);
        expect(result.current.isLoading).toBe(true);
    });

    it('should load saved queries on mount', async () => {
        mockBackend({queries: mockQueries});

        const wrapper = ({children}: {children: React.ReactNode}) =>
            React.createElement(SavedQueriesProvider, null, children);

        const {result} = renderHook(() => useSavedQueries(), {wrapper});

        await waitFor(() => {
            expect(result.current.queries).toHaveLength(2);
            expect(result.current.isLoading).toBe(false);
        });

        expect(result.current.queries[0].name).toBe('All Users');
        expect(result.current.queries[1].sql).toBe('SELECT * FROM orders WHERE status = "active"');
        expect(invoke).toHaveBeenCalledWith('get_saved_queries', {connectionId: 'conn-123'});
    });

    it('should clear queries when disconnected', async () => {
        mockBackend({queries: mockQueries});
        vi.mocked(useDatabase).mockReturnValue({
            activeConnectionId: null,
        } as ReturnType<typeof useDatabase>);

        const wrapper = ({children}: {children: React.ReactNode}) =>
            React.createElement(SavedQueriesProvider, null, children);

        const {result} = renderHook(() => useSavedQueries(), {wrapper});

        await waitFor(() => {
            expect(result.current.queries).toHaveLength(0);
            expect(result.current.isLoading).toBe(false);
        });
    });

    it('should save a new query', async () => {
        const backend: Backend = mockBackend({
            queries: mockQueries,
            effects: {
                save_query: () => {
                    backend.queries = [
                        ...mockQueries,
                        {
                            id: 'query-3',
                            name: 'New Query',
                            sql: 'SELECT 1',
                            connection_id: 'conn-123',
                        },
                    ];
                },
            },
        });

        const wrapper = ({children}: {children: React.ReactNode}) =>
            React.createElement(SavedQueriesProvider, null, children);

        const {result} = renderHook(() => useSavedQueries(), {wrapper});

        await waitFor(() => expect(result.current.queries).toHaveLength(2));

        await result.current.saveQuery('New Query', 'SELECT 1');

        expect(invoke).toHaveBeenCalledWith('save_query', {
            connectionId: 'conn-123',
            name: 'New Query',
            sql: 'SELECT 1',
            database: null,
        });

        await waitFor(() => {
            expect(result.current.queries).toHaveLength(3);
        });
    });

    it('should not save query when disconnected', async () => {
        vi.mocked(useDatabase).mockReturnValue({
            activeConnectionId: null,
        } as ReturnType<typeof useDatabase>);

        const wrapper = ({children}: {children: React.ReactNode}) =>
            React.createElement(SavedQueriesProvider, null, children);

        const {result} = renderHook(() => useSavedQueries(), {wrapper});

        await result.current.saveQuery('New Query', 'SELECT 1');

        expect(invoke).not.toHaveBeenCalledWith('save_query', expect.anything());
    });

    it('should update an existing query', async () => {
        const backend: Backend = mockBackend({
            queries: mockQueries,
            effects: {
                update_saved_query: () => {
                    backend.queries = [
                        {
                            ...mockQueries[0],
                            name: 'Updated Users',
                            sql: 'SELECT id, name FROM users',
                        },
                        mockQueries[1],
                    ];
                },
            },
        });

        const wrapper = ({children}: {children: React.ReactNode}) =>
            React.createElement(SavedQueriesProvider, null, children);

        const {result} = renderHook(() => useSavedQueries(), {wrapper});

        await waitFor(() => expect(result.current.queries).toHaveLength(2));

        await result.current.updateQuery('query-1', 'Updated Users', 'SELECT id, name FROM users');

        expect(invoke).toHaveBeenCalledWith('update_saved_query', {
            id: 'query-1',
            name: 'Updated Users',
            sql: 'SELECT id, name FROM users',
            database: null,
        });

        await waitFor(() => {
            expect(result.current.queries[0].name).toBe('Updated Users');
        });
    });

    it('should delete a query', async () => {
        const backend: Backend = mockBackend({
            queries: mockQueries,
            effects: {
                delete_saved_query: () => {
                    backend.queries = [mockQueries[1]];
                },
            },
        });

        const wrapper = ({children}: {children: React.ReactNode}) =>
            React.createElement(SavedQueriesProvider, null, children);

        const {result} = renderHook(() => useSavedQueries(), {wrapper});

        await waitFor(() => expect(result.current.queries).toHaveLength(2));

        await result.current.deleteQuery('query-1');

        expect(invoke).toHaveBeenCalledWith('delete_saved_query', {id: 'query-1'});

        await waitFor(() => {
            expect(result.current.queries).toHaveLength(1);
            expect(result.current.queries[0].id).toBe('query-2');
        });
    });

    it('should handle save error', async () => {
        mockBackend({queries: mockQueries, fail: {save_query: new Error('Save failed')}});

        const wrapper = ({children}: {children: React.ReactNode}) =>
            React.createElement(SavedQueriesProvider, null, children);

        const {result} = renderHook(() => useSavedQueries(), {wrapper});

        await waitFor(() => expect(result.current.queries).toHaveLength(2));

        await expect(result.current.saveQuery('New Query', 'SELECT 1')).rejects.toThrow(
            'Save failed',
        );
    });

    it('should refresh queries manually', async () => {
        const backend = mockBackend({queries: mockQueries});

        const wrapper = ({children}: {children: React.ReactNode}) =>
            React.createElement(SavedQueriesProvider, null, children);

        const {result} = renderHook(() => useSavedQueries(), {wrapper});

        await waitFor(() => expect(result.current.queries).toHaveLength(2));

        backend.queries = [
            ...mockQueries,
            {id: 'query-3', name: 'Another Query', sql: 'SELECT 2', connection_id: 'conn-123'},
        ];
        await result.current.refreshQueries();

        await waitFor(() => {
            expect(result.current.queries).toHaveLength(3);
        });
    });

    describe('folders', () => {
        const folder = {id: 'f1', connection_id: 'conn-123', name: 'Reports', created_at: null};

        const setup = async (backend: Backend) => {
            mockBackend(backend);
            const wrapper = ({children}: {children: React.ReactNode}) =>
                React.createElement(SavedQueriesProvider, null, children);
            const hook = renderHook(() => useSavedQueries(), {wrapper});
            await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
            return hook;
        };

        it('loads folders for the active connection alongside queries', async () => {
            const {result} = await setup({queries: mockQueries, folders: [folder]});

            expect(result.current.folders).toEqual([folder]);
            expect(invoke).toHaveBeenCalledWith('get_saved_query_folders', {
                connectionId: 'conn-123',
            });
        });

        it('still loads queries, unfiled, when folders fail to load', async () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const {result} = await setup({
                queries: mockQueries,
                fail: {get_saved_query_folders: new Error('corrupt folders.json')},
            });

            expect(result.current.queries).toHaveLength(2);
            expect(result.current.folders).toEqual([]);
            consoleSpy.mockRestore();
        });

        it('clears folders when disconnected', async () => {
            vi.mocked(useDatabase).mockReturnValue({activeConnectionId: null} as ReturnType<
                typeof useDatabase
            >);
            const {result} = await setup({folders: [folder]});

            expect(result.current.folders).toEqual([]);
            expect(invoke).not.toHaveBeenCalled();
        });

        it('creates a folder for the active connection and refreshes', async () => {
            const backend: Backend = {
                effects: {
                    create_saved_query_folder: () => {
                        backend.folders = [folder];
                    },
                },
            };
            const {result} = await setup(backend);

            await result.current.createFolder('Reports');

            expect(invoke).toHaveBeenCalledWith('create_saved_query_folder', {
                connectionId: 'conn-123',
                name: 'Reports',
            });
            await waitFor(() => expect(result.current.folders).toEqual([folder]));
        });

        it('renames and deletes folders', async () => {
            const {result} = await setup({folders: [folder]});

            await result.current.renameFolder('f1', 'Ops');
            expect(invoke).toHaveBeenCalledWith('rename_saved_query_folder', {
                id: 'f1',
                name: 'Ops',
            });

            await result.current.deleteFolder('f1');
            expect(invoke).toHaveBeenCalledWith('delete_saved_query_folder', {id: 'f1'});
        });

        it('moves a query into a folder and back to unfiled', async () => {
            const {result} = await setup({queries: mockQueries, folders: [folder]});

            await result.current.moveQuery('query-1', 'f1');
            expect(invoke).toHaveBeenCalledWith('move_saved_query', {
                id: 'query-1',
                folderId: 'f1',
            });

            await result.current.moveQuery('query-1', null);
            expect(invoke).toHaveBeenCalledWith('move_saved_query', {
                id: 'query-1',
                folderId: null,
            });
        });

        it('surfaces backend errors, e.g. deleting a non-empty folder', async () => {
            const {result} = await setup({
                folders: [folder],
                fail: {delete_saved_query_folder: new Error('Folder is not empty')},
            });

            await expect(result.current.deleteFolder('f1')).rejects.toThrow('Folder is not empty');
            expect(result.current.folders).toEqual([folder]);
        });
    });
});
