import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useDatabase } from "../hooks/useDatabase";
import { useTabularisClient } from "../hooks/useTabularisClient";
import { SavedQueriesContext, type SavedQuery } from "./SavedQueriesContext";

export const SavedQueriesProvider = ({ children }: { children: ReactNode }) => {
  const { activeConnectionId } = useDatabase();
  const client = useTabularisClient();
  const activeConnectionIdRef = useRef(activeConnectionId);
  activeConnectionIdRef.current = activeConnectionId;
  const [queries, setQueries] = useState<SavedQuery[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refreshQueries = useCallback(async () => {
    const connectionId = activeConnectionIdRef.current;
    if (!connectionId) {
      setQueries([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const result = await client.call("get_saved_queries", { connectionId });
      if (activeConnectionIdRef.current === connectionId) {
        setQueries(result);
      }
    } catch (error) {
      console.error("Failed to load saved queries:", error);
    } finally {
      if (activeConnectionIdRef.current === connectionId) {
        setIsLoading(false);
      }
    }
  }, [client]);

  useEffect(() => {
    void refreshQueries();
  }, [activeConnectionId, refreshQueries]);

  const saveQuery = async (
    name: string,
    sql: string,
    database?: string | null,
  ) => {
    const connectionId = activeConnectionIdRef.current;
    if (!connectionId) return;
    try {
      await client.call("save_query", {
        connectionId,
        name,
        sql,
        database: database ?? null,
      });
      await refreshQueries();
    } catch (error) {
      console.error("Failed to save query:", error);
      throw error;
    }
  };

  const updateQuery = async (
    id: string,
    name: string,
    sql: string,
    database?: string | null,
  ) => {
    const connectionId = activeConnectionIdRef.current;
    if (!connectionId) return;
    try {
      await client.call("update_saved_query", {
        connectionId,
        id,
        name,
        sql,
        database: database ?? null,
      });
      await refreshQueries();
    } catch (error) {
      console.error("Failed to update query:", error);
      throw error;
    }
  };

  const deleteQuery = async (id: string) => {
    const connectionId = activeConnectionIdRef.current;
    if (!connectionId) return;
    try {
      await client.call("delete_saved_query", { connectionId, id });
      await refreshQueries();
    } catch (error) {
      console.error("Failed to delete query:", error);
      throw error;
    }
  };

  return (
    <SavedQueriesContext.Provider
      value={{
        queries,
        isLoading,
        saveQuery,
        updateQuery,
        deleteQuery,
        refreshQueries,
      }}
    >
      {children}
    </SavedQueriesContext.Provider>
  );
};
