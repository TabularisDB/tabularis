import {useCallback, useEffect, useRef, useState, type ReactNode} from 'react';
import {useDatabase} from '@/hooks/useDatabase';
import {useTabularisClient} from '@/hooks/useTabularisClient';
import {
    SavedQueriesContext,
    type SavedQuery,
    type SavedQueryFolder,
    type SavedQueryVersion,
} from '@/contexts/SavedQueriesContext';

export const SavedQueriesProvider = ({children}: {children: ReactNode}) => {
    const {activeConnectionId} = useDatabase();
    const client = useTabularisClient();
    const activeConnectionIdRef = useRef(activeConnectionId);
    activeConnectionIdRef.current = activeConnectionId;
    const [queries, setQueries] = useState<SavedQuery[]>([]);
    const [folders, setFolders] = useState<SavedQueryFolder[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const refreshQueries = useCallback(async () => {
        const connectionId = activeConnectionIdRef.current;
        if (!connectionId) {
            setQueries([]);
            setFolders([]);
            setIsLoading(false);
            return;
        }

        setIsLoading(true);
        try {
            const [result, folderResult] = await Promise.all([
                client.call('get_saved_queries', {connectionId}),
                // Folders are organizational only: if they can't load, queries still show as unfiled.
                client.call('get_saved_query_folders', {connectionId}).catch((error: unknown) => {
                    console.error('Failed to load saved query folders:', error);
                    return [] as SavedQueryFolder[];
                }),
            ]);
            if (activeConnectionIdRef.current === connectionId) {
                setQueries(result);
                setFolders(Array.isArray(folderResult) ? folderResult : []);
            }
        } catch (error) {
            console.error('Failed to load saved queries:', error);
        } finally {
            if (activeConnectionIdRef.current === connectionId) {
                setIsLoading(false);
            }
        }
    }, [client]);

    useEffect(() => {
        void refreshQueries();
    }, [activeConnectionId, refreshQueries]);

    const saveQuery = async (name: string, sql: string, database?: string | null) => {
        const connectionId = activeConnectionIdRef.current;
        if (!connectionId) return;
        try {
            await client.call('save_query', {
                connectionId,
                name,
                sql,
                database: database ?? null,
            });
            await refreshQueries();
        } catch (error) {
            console.error('Failed to save query:', error);
            throw error;
        }
    };

    const updateQuery = async (id: string, name: string, sql: string, database?: string | null) => {
        const connectionId = activeConnectionIdRef.current;
        if (!connectionId) return;
        try {
            await client.call('update_saved_query', {
                connectionId,
                id,
                name,
                sql,
                database: database ?? null,
            });
            await refreshQueries();
        } catch (error) {
            console.error('Failed to update query:', error);
            throw error;
        }
    };

    const deleteQuery = async (id: string) => {
        const connectionId = activeConnectionIdRef.current;
        if (!connectionId) return;
        try {
            await client.call('delete_saved_query', {connectionId, id});
            await refreshQueries();
        } catch (error) {
            console.error('Failed to delete query:', error);
            throw error;
        }
    };

    const getQueryVersions = useCallback(
        async (id: string): Promise<SavedQueryVersion[]> => {
            const connectionId = activeConnectionIdRef.current;
            if (!connectionId) return [];
            return client.call('get_saved_query_versions', {connectionId, id});
        },
        [client],
    );

    const restoreQueryVersion = async (id: string, versionId: string) => {
        const connectionId = activeConnectionIdRef.current;
        if (!connectionId) return;
        await client.call('restore_saved_query_version', {connectionId, id, versionId});
        await refreshQueries();
    };

    const createFolder = async (name: string) => {
        const connectionId = activeConnectionIdRef.current;
        if (!connectionId) return;
        await client.call('create_saved_query_folder', {connectionId, name});
        await refreshQueries();
    };

    const renameFolder = async (id: string, name: string) => {
        const connectionId = activeConnectionIdRef.current;
        if (!connectionId) return;
        await client.call('rename_saved_query_folder', {connectionId, id, name});
        await refreshQueries();
    };

    const deleteFolder = async (id: string) => {
        const connectionId = activeConnectionIdRef.current;
        if (!connectionId) return;
        await client.call('delete_saved_query_folder', {connectionId, id});
        await refreshQueries();
    };

    const moveQuery = async (id: string, folderId: string | null) => {
        const connectionId = activeConnectionIdRef.current;
        if (!connectionId) return;
        await client.call('move_saved_query', {connectionId, id, folderId});
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
                getQueryVersions,
                restoreQueryVersion,
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
