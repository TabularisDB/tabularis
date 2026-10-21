import {useState, useEffect, useCallback, type ReactNode} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {useDatabase} from '@/hooks/useDatabase';
import {SavedQueriesContext, type SavedQuery, type SavedQueryFolder} from './SavedQueriesContext';

export const SavedQueriesProvider = ({children}: {children: ReactNode}) => {
    const {activeConnectionId} = useDatabase();
    const [queries, setQueries] = useState<SavedQuery[]>([]);
    const [folders, setFolders] = useState<SavedQueryFolder[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const refreshQueries = useCallback(async () => {
        if (!activeConnectionId) {
            setQueries([]);
            setFolders([]);
            return;
        }

        setIsLoading(true);
        try {
            const [result, folderResult] = await Promise.all([
                invoke<SavedQuery[]>('get_saved_queries', {connectionId: activeConnectionId}),
                // Folders are organizational only: if they can't load, queries still show as unfiled.
                invoke<SavedQueryFolder[]>('get_saved_query_folders', {
                    connectionId: activeConnectionId,
                }).catch((e) => {
                    console.error('Failed to load saved query folders:', e);
                    return [] as SavedQueryFolder[];
                }),
            ]);
            setQueries(result);
            setFolders(Array.isArray(folderResult) ? folderResult : []);
        } catch (e) {
            console.error('Failed to load saved queries:', e);
        } finally {
            setIsLoading(false);
        }
    }, [activeConnectionId]);

    useEffect(() => {
        refreshQueries();
    }, [refreshQueries]);

    const saveQuery = async (name: string, sql: string, database?: string | null) => {
        if (!activeConnectionId) return;
        try {
            await invoke('save_query', {
                connectionId: activeConnectionId,
                name,
                sql,
                database: database ?? null,
            });
            await refreshQueries();
        } catch (e) {
            console.error('Failed to save query:', e);
            throw e;
        }
    };

    const updateQuery = async (id: string, name: string, sql: string, database?: string | null) => {
        try {
            await invoke('update_saved_query', {id, name, sql, database: database ?? null});
            await refreshQueries();
        } catch (e) {
            console.error('Failed to update query:', e);
            throw e;
        }
    };

    const deleteQuery = async (id: string) => {
        try {
            await invoke('delete_saved_query', {id});
            await refreshQueries();
        } catch (e) {
            console.error('Failed to delete query:', e);
            throw e;
        }
    };

    const createFolder = async (name: string) => {
        if (!activeConnectionId) return;
        await invoke('create_saved_query_folder', {connectionId: activeConnectionId, name});
        await refreshQueries();
    };

    const renameFolder = async (id: string, name: string) => {
        await invoke('rename_saved_query_folder', {id, name});
        await refreshQueries();
    };

    const deleteFolder = async (id: string) => {
        await invoke('delete_saved_query_folder', {id});
        await refreshQueries();
    };

    const moveQuery = async (id: string, folderId: string | null) => {
        await invoke('move_saved_query', {id, folderId});
        await refreshQueries();
    };

    return (
        <SavedQueriesContext.Provider
            value={{
                queries,
                folders,
                isLoading,
                saveQuery,
                updateQuery,
                deleteQuery,
                createFolder,
                renameFolder,
                deleteFolder,
                moveQuery,
                refreshQueries,
            }}
        >
            {children}
        </SavedQueriesContext.Provider>
    );
};
