import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type { ReactNode } from "react";
import type { Tab, SchemaCache, TableSchema } from "../types/editor";
import { EditorContext } from "./EditorContext";
import { useDatabase } from "../hooks/useDatabase";
import { invoke } from "@tauri-apps/api/core";
import {
  generateTabId,
  loadTabsFromStorage,
  loadActiveTabId,
  saveTabsToStorage,
  createInitialTabState,
  generateTabTitle,
  findExistingTableTab,
  getConnectionTabs,
  getActiveTab,
  closeTabWithState,
  closeAllTabsForConnection,
  closeOtherTabsForConnection,
  closeTabsToLeft,
  closeTabsToRight,
  updateTabInList,
  shouldUseCachedSchema,
  createSchemaCacheEntry,
} from "../utils/editor";

export const EditorProvider = ({ children }: { children: ReactNode }) => {
  const { activeConnectionId } = useDatabase();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabIds, setActiveTabIds] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);

  const schemaCacheRef = useRef<Record<string, SchemaCache>>({});
  const tabsRef = useRef<Tab[]>([]);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  // Load tabs from file storage when connection changes
  useEffect(() => {
    if (!activeConnectionId) {
      setTabs([]);
      setIsLoading(false);
      return;
    }

    const loadPreferences = async () => {
      setIsLoading(true);
      try {
        const loadedTabs = await loadTabsFromStorage(activeConnectionId);
        const loadedActiveTabId = await loadActiveTabId(activeConnectionId);

        if (loadedTabs.length > 0) {
          // Merge loaded tabs with tabs from other connections
          setTabs((prev) => {
            const tabsFromOtherConnections = prev.filter(t => t.connectionId !== activeConnectionId);
            return [...tabsFromOtherConnections, ...loadedTabs];
          });
          if (loadedActiveTabId) {
            setActiveTabIds((prev) => ({
              ...prev,
              [activeConnectionId]: loadedActiveTabId,
            }));
          }
        } else {
          // Create initial tab if no tabs exist, preserving other connections' tabs
          const initialTab = createInitialTabState(activeConnectionId);
          setTabs((prev) => {
            const tabsFromOtherConnections = prev.filter(t => t.connectionId !== activeConnectionId);
            return [...tabsFromOtherConnections, initialTab];
          });
          setActiveTabIds((prev) => ({
            ...prev,
            [activeConnectionId]: initialTab.id,
          }));
        }
      } catch (e) {
        console.error("Failed to load preferences:", e);
        // Fallback: create initial tab, preserving other connections' tabs
        const initialTab = createInitialTabState(activeConnectionId);
        setTabs((prev) => {
          const tabsFromOtherConnections = prev.filter(t => t.connectionId !== activeConnectionId);
          return [...tabsFromOtherConnections, initialTab];
        });
        setActiveTabIds((prev) => ({
          ...prev,
          [activeConnectionId]: initialTab.id,
        }));
      } finally {
        setIsLoading(false);
      }
    };

    loadPreferences();
  }, [activeConnectionId]);

  const createInitialTab = useCallback(
    (partial?: Partial<Tab>): Tab => {
      return createInitialTabState(activeConnectionId, partial);
    },
    [activeConnectionId],
  );

  // Save tabs to file storage when they change
  useEffect(() => {
    if (!activeConnectionId || isLoading || tabs.length === 0) return;

    const connectionTabs = tabs.filter(
      (t) => t.connectionId === activeConnectionId,
    );
    const activeTabId = activeTabIds[activeConnectionId] || null;

    saveTabsToStorage(activeConnectionId, connectionTabs, activeTabId);
  }, [tabs, activeTabIds, activeConnectionId, isLoading]);

  const activeTabId = activeConnectionId
    ? activeTabIds[activeConnectionId] || null
    : null;

  const setActiveTabId = useCallback(
    (id: string | null) => {
      if (activeConnectionId && id) {
        setActiveTabIds((prev) => ({ ...prev, [activeConnectionId]: id }));
      }
    },
    [activeConnectionId],
  );

  const addTab = useCallback(
    (partial?: Partial<Tab>) => {
      if (!activeConnectionId) return "";

      const existing = findExistingTableTab(
        tabsRef.current,
        activeConnectionId,
        partial?.activeTable || undefined,
        partial?.schema,
      );
      if (existing) {
        setActiveTabId(existing.id);
        return existing.id;
      }

      const id = generateTabId();
      setTabs((prev) => {
        const title = generateTabTitle(prev, activeConnectionId, partial);
        const newTab = createInitialTab({
          id,
          title,
          connectionId: activeConnectionId,
          ...partial,
        });
        return [...prev, newTab];
      });
      setActiveTabId(id);
      return id;
    },
    [createInitialTab, activeConnectionId, setActiveTabId],
  );

  const closeTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const {
          newTabs,
          newActiveTabId: nextActiveId,
          createdNewTab,
        } = closeTabWithState(
          prev,
          activeConnectionId || "",
          activeTabId,
          id,
          (connId) =>
            createInitialTab({ id: generateTabId(), connectionId: connId }),
        );

        if (createdNewTab && nextActiveId) {
          setActiveTabIds((prevIds) => ({
            ...prevIds,
            [activeConnectionId || ""]: nextActiveId,
          }));
        } else if (nextActiveId !== activeTabId) {
          setActiveTabIds((prevIds) => ({
            ...prevIds,
            [activeConnectionId || ""]: nextActiveId || "",
          }));
        }

        return newTabs;
      });
    },
    [activeConnectionId, activeTabId, createInitialTab],
  );

  const closeAllTabs = useCallback(() => {
    if (!activeConnectionId) return;
    setTabs((prev) => {
      const { newTabs, newActiveTabId } = closeAllTabsForConnection(
        prev,
        activeConnectionId,
        (connId) =>
          createInitialTab({ id: generateTabId(), connectionId: connId }),
      );
      setActiveTabIds((prevIds) => ({
        ...prevIds,
        [activeConnectionId]: newActiveTabId,
      }));
      return newTabs;
    });
  }, [activeConnectionId, createInitialTab]);

  const closeOtherTabs = useCallback(
    (id: string) => {
      if (!activeConnectionId) return;
      setTabs((prev) => {
        const newTabs = closeOtherTabsForConnection(
          prev,
          activeConnectionId,
          id,
        );
        setActiveTabIds((prevIds) => ({
          ...prevIds,
          [activeConnectionId]: id,
        }));
        return newTabs;
      });
    },
    [activeConnectionId],
  );

  const closeTabsToLeftInternal = useCallback(
    (id: string) => {
      if (!activeConnectionId) return;
      setTabs((prev) => {
        const { newTabs, newActiveTabId } = closeTabsToLeft(
          prev,
          activeConnectionId,
          id,
          activeTabId,
        );
        if (newActiveTabId && newActiveTabId !== activeTabId) {
          setActiveTabIds((prevIds) => ({
            ...prevIds,
            [activeConnectionId]: newActiveTabId,
          }));
        }
        return newTabs;
      });
    },
    [activeConnectionId, activeTabId],
  );

  const closeTabsToRightInternal = useCallback(
    (id: string) => {
      if (!activeConnectionId) return;
      setTabs((prev) => {
        const { newTabs, newActiveTabId } = closeTabsToRight(
          prev,
          activeConnectionId,
          id,
          activeTabId,
        );
        if (newActiveTabId && newActiveTabId !== activeTabId) {
          setActiveTabIds((prevIds) => ({
            ...prevIds,
            [activeConnectionId]: newActiveTabId,
          }));
        }
        return newTabs;
      });
    },
    [activeConnectionId, activeTabId],
  );

  const updateTab = useCallback((id: string, partial: Partial<Tab>) => {
    setTabs((prev) => updateTabInList(prev, id, partial));
  }, []);

  const getSchema = useCallback(
    async (
      connectionId: string,
      schemaVersion?: number,
      schema?: string,
    ): Promise<TableSchema[]> => {
      const cacheKey = schema ? `${connectionId}:${schema}` : connectionId;
      const cached = schemaCacheRef.current[cacheKey];

      // Cache hit: same version, less than 5 minutes old
      if (shouldUseCachedSchema(cached, schemaVersion)) {
        console.log("Using cached schema for", cacheKey);
        return cached!.data;
      }

      // Cache miss: fetch from backend
      console.log("Fetching schema from backend for", cacheKey);
      const data = await invoke<TableSchema[]>("get_schema_snapshot", {
        connectionId,
        ...(schema ? { schema } : {}),
      });

      // Update cache in ref (no state update = no re-render)
      schemaCacheRef.current = {
        ...schemaCacheRef.current,
        [cacheKey]: createSchemaCacheEntry(data, schemaVersion || 0),
      };

      return data;
    },
    [],
  ); // No dependencies - stable function

  const activeTab = useMemo(() => {
    return getActiveTab(tabs, activeConnectionId, activeTabId);
  }, [tabs, activeTabId, activeConnectionId]);

  const connectionTabs = useMemo(() => {
    return getConnectionTabs(tabs, activeConnectionId);
  }, [tabs, activeConnectionId]);

  const contextValue = useMemo(
    () => ({
      tabs: connectionTabs,
      activeTabId,
      activeTab,
      addTab,
      closeTab,
      updateTab,
      setActiveTabId,
      closeAllTabs,
      closeOtherTabs,
      closeTabsToLeft: closeTabsToLeftInternal,
      closeTabsToRight: closeTabsToRightInternal,
      getSchema,
    }),
    [
      connectionTabs,
      activeTabId,
      activeTab,
      addTab,
      closeTab,
      updateTab,
      setActiveTabId,
      closeAllTabs,
      closeOtherTabs,
      closeTabsToLeftInternal,
      closeTabsToRightInternal,
      getSchema,
    ],
  );

  return (
    <EditorContext.Provider value={contextValue}>
      {children}
    </EditorContext.Provider>
  );
};
