import { useState, useEffect, useCallback, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useDatabase } from "../hooks/useDatabase";
import {
  QueryHistoryContext,
  type QueryHistoryEntry,
} from "./QueryHistoryContext";
import type {
  QueryHistoryRecoveryNotice,
  QueryHistoryResponse,
} from "../types/queryHistory";

export const QueryHistoryProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const { activeConnectionId } = useDatabase();
  const [entries, setEntries] = useState<QueryHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [recoveryNotice, setRecoveryNotice] =
    useState<QueryHistoryRecoveryNotice | null>(null);

  const refreshHistory = useCallback(async () => {
    if (!activeConnectionId) {
      setEntries([]);
      setRecoveryNotice(null);
      return;
    }

    setIsLoading(true);
    try {
      const result = await invoke<QueryHistoryResponse>("get_query_history", {
        connectionId: activeConnectionId,
      });
      setEntries(result.entries);
      if (result.recoveredBackupPath) {
        setRecoveryNotice({
          connectionId: activeConnectionId,
          backupPath: result.recoveredBackupPath,
        });
      } else {
        setRecoveryNotice((prev) =>
          prev && prev.connectionId === activeConnectionId ? prev : null,
        );
      }
    } catch (e) {
      console.error("Failed to load query history:", e);
    } finally {
      setIsLoading(false);
    }
  }, [activeConnectionId]);

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

  const addEntry = useCallback(async (
    sql: string,
    executionTimeMs: number | null,
    status: "success" | "error",
    rowsAffected: number | null,
    error: string | null,
    database?: string | null,
  ) => {
    if (!activeConnectionId) return;
    try {
      const entry = await invoke<QueryHistoryEntry>(
        "add_query_history_entry",
        {
          connectionId: activeConnectionId,
          sql,
          executedAt: new Date().toISOString(),
          executionTimeMs,
          status,
          rowsAffected,
          error,
          database: database ?? null,
        },
      );
      setEntries((prev) => {
        if (prev.length > 0 && prev[0].id === entry.id) {
          return [entry, ...prev.slice(1)];
        }
        return [entry, ...prev];
      });
    } catch (e) {
      console.error("Failed to add query history entry:", e);
    }
  }, [activeConnectionId]);

  const deleteEntry = async (id: string) => {
    if (!activeConnectionId) return;
    try {
      await invoke("delete_query_history_entry", {
        connectionId: activeConnectionId,
        id,
      });
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch (e) {
      console.error("Failed to delete query history entry:", e);
      throw e;
    }
  };

  const clearHistory = async () => {
    if (!activeConnectionId) return;
    try {
      await invoke("clear_query_history", {
        connectionId: activeConnectionId,
      });
      setEntries([]);
    } catch (e) {
      console.error("Failed to clear query history:", e);
      throw e;
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
