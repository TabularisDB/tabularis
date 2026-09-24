import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useDatabase } from "../hooks/useDatabase";
import { useTabularisClient } from "../hooks/useTabularisClient";
import {
  QueryHistoryContext,
  type QueryHistoryEntry,
} from "./QueryHistoryContext";
import type { QueryHistoryRecoveryNotice } from "../types/queryHistory";

export const QueryHistoryProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const { activeConnectionId } = useDatabase();
  const client = useTabularisClient();
  const activeConnectionIdRef = useRef(activeConnectionId);
  activeConnectionIdRef.current = activeConnectionId;
  const [entries, setEntries] = useState<QueryHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [recoveryNotice, setRecoveryNotice] =
    useState<QueryHistoryRecoveryNotice | null>(null);

  const refreshHistory = useCallback(async () => {
    const connectionId = activeConnectionIdRef.current;
    if (!connectionId) {
      setEntries([]);
      setRecoveryNotice(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const result = await client.call("get_query_history", { connectionId });
      if (activeConnectionIdRef.current !== connectionId) return;
      setEntries(result.entries);
      if (result.recoveredBackupPath) {
        setRecoveryNotice({
          connectionId,
          backupPath: result.recoveredBackupPath,
        });
      } else {
        setRecoveryNotice((previous) =>
          previous && previous.connectionId === connectionId ? previous : null,
        );
      }
    } catch (error) {
      console.error("Failed to load query history:", error);
    } finally {
      if (activeConnectionIdRef.current === connectionId) {
        setIsLoading(false);
      }
    }
  }, [client]);

  useEffect(() => {
    void refreshHistory();
  }, [activeConnectionId, refreshHistory]);

  const addEntry = useCallback(
    async (
      sql: string,
      executionTimeMs: number | null,
      status: "success" | "error",
      rowsAffected: number | null,
      error: string | null,
      database?: string | null,
    ) => {
      const connectionId = activeConnectionIdRef.current;
      if (!connectionId) return;
      try {
        const entry = await client.call("add_query_history_entry", {
          connectionId,
          sql,
          executedAt: new Date().toISOString(),
          executionTimeMs,
          status,
          rowsAffected,
          error,
          database: database ?? null,
        });
        if (activeConnectionIdRef.current !== connectionId) return;
        setEntries((previous) => {
          if (previous.length > 0 && previous[0].id === entry.id) {
            return [entry, ...previous.slice(1)];
          }
          return [entry, ...previous];
        });
      } catch (caught) {
        console.error("Failed to add query history entry:", caught);
      }
    },
    [client],
  );

  const deleteEntry = async (id: string) => {
    const connectionId = activeConnectionIdRef.current;
    if (!connectionId) return;
    try {
      await client.call("delete_query_history_entry", { connectionId, id });
      if (activeConnectionIdRef.current === connectionId) {
        setEntries((previous) => previous.filter((entry) => entry.id !== id));
      }
    } catch (error) {
      console.error("Failed to delete query history entry:", error);
      throw error;
    }
  };

  const clearHistory = async () => {
    const connectionId = activeConnectionIdRef.current;
    if (!connectionId) return;
    try {
      await client.call("clear_query_history", { connectionId });
      if (activeConnectionIdRef.current === connectionId) {
        setEntries([]);
      }
    } catch (error) {
      console.error("Failed to clear query history:", error);
      throw error;
    }
  };

  const dismissRecoveryNotice = useCallback(() => {
    setRecoveryNotice(null);
  }, []);

  return (
    <QueryHistoryContext.Provider
      value={{
        entries,
        isLoading,
        recoveryNotice,
        dismissRecoveryNotice,
        addEntry,
        deleteEntry,
        clearHistory,
        refreshHistory,
      }}
    >
      {children}
    </QueryHistoryContext.Provider>
  );
};
