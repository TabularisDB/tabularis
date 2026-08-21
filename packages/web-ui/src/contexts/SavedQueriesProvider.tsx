import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useDatabase } from '../hooks/useDatabase';
import { SavedQueriesContext, type SavedQuery } from './SavedQueriesContext';

export const SavedQueriesProvider = ({ children }: { children: ReactNode }) => {
  const { activeConnectionId } = useDatabase();
  const [queries, setQueries] = useState<SavedQuery[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refreshQueries = useCallback(async () => {
    if (!activeConnectionId) {
        setQueries([]);
        return;
    }
    
    setIsLoading(true);
    try {
      const result = await invoke<SavedQuery[]>('get_saved_queries', { connectionId: activeConnectionId });
      setQueries(result);
    } catch (e) {
      console.error("Failed to load saved queries:", e);
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
      await invoke('save_query', { connectionId: activeConnectionId, name, sql, database: database ?? null });
      await refreshQueries();
    } catch (e) {
      console.error("Failed to save query:", e);
      throw e;
    }
  };

  const updateQuery = async (id: string, name: string, sql: string, database?: string | null) => {
    try {
      await invoke('update_saved_query', { id, name, sql, database: database ?? null });
      await refreshQueries();
    } catch (e) {
      console.error("Failed to update query:", e);
      throw e;
    }
  };

  const deleteQuery = async (id: string) => {
    try {
      await invoke('delete_saved_query', { id });
      await refreshQueries();
    } catch (e) {
      console.error("Failed to delete query:", e);
      throw e;
    }
  };

  return (
    <SavedQueriesContext.Provider value={{ queries, isLoading, saveQuery, updateQuery, deleteQuery, refreshQueries }}>
      {children}
    </SavedQueriesContext.Provider>
  );
};
