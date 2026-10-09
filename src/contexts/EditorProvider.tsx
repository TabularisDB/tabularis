import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type { ReactNode } from "react";
import type { Tab, SchemaCache, TableSchema, QueryResultEntry } from "../types/editor";
import { EditorContext } from "./EditorContext";
import { useDatabase } from "../hooks/useDatabase";
import { invoke } from "@tauri-apps/api/core";
import {
  generateTabId,
  loadEditorPreferences,
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
import { moveTab } from "../utils/tabDnd";
import { createAutoRefreshSchedule, type AutoRefreshSchedule } from "../utils/autoRefresh";
import {
  pushClosedTabs,
  popClosedTab,
  insertReopenedTab,
  type ClosedTabsByConnection,
} from "../utils/closedTabs";
import {
  createNotebookFromState,
  evictFromCache,
  flushAllPendingSaves,
} from "../utils/notebookStore";

export const EditorProvider = ({ children }: { children: ReactNode }) => {
  const { activeConnectionId } = useDatabase();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabIds, setActiveTabIds] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);

  // Closed tabs per connection, for "reopen closed tab". The state mirrors
  // closedTabsRef (kept in sync immediately) so consumers re-render on
  // canReopenClosedTab while reads stay synchronous across quick presses.
  const [closedTabs, setClosedTabs] = useState<ClosedTabsByConnection>({});
  const closedTabsRef = useRef<ClosedTabsByConnection>({});

  const schemaCacheRef = useRef<Record<string, SchemaCache>>({});
  const tabsRef = useRef<Tab[]>([]);
  const refreshSchedules = useRef(new Map<string, AutoRefreshSchedule>());
  const getAutoRefreshSchedule = useCallback((tabId: string) => {
    let schedule = refreshSchedules.current.get(tabId);
    if (!schedule) {
      schedule = createAutoRefreshSchedule();
      refreshSchedules.current.set(tabId, schedule);
    }
    return schedule;
  }, []);

  useEffect(() => {
    const open = new Set(tabs.map((tab) => tab.id));
    for (const [id, schedule] of refreshSchedules.current) {
      if (!open.has(id)) {
        schedule.invalidate();
        refreshSchedules.current.delete(id);
      }
    }
  }, [tabs]);
  // A notebook the user asked to open from a different connection. Resolved
  // once that connection's tabs have finished loading (see effect below), so
  // the freshly-added tab isn't wiped by the in-flight preference load.
  const pendingNotebookRef = useRef<{
    connectionId: string;
    notebookId: string;
    title: string;
  } | null>(null);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  // Every tab close ends here, so a tab leaving the list releases its pinned
  // connection, rolling back any transaction it left open. The list cleared with
  // no active connection is skipped: disconnect and a failed health check release
  // in the backend, and a detached window reopens the same tabs and continues them.
  const releasedFromTabsRef = useRef<Tab[]>([]);
  useEffect(() => {
    const previous = releasedFromTabsRef.current;
    releasedFromTabsRef.current = tabs;
    if (!activeConnectionId) return;
    const open = new Set(tabs.map((t) => t.id));
    for (const tab of previous) {
      if (open.has(tab.id)) continue;
      void invoke("release_query_session", {
        connectionId: tab.connectionId,
        sessionId: tab.id,
      }).catch(() => {
        // The tab is already gone; nothing useful to surface.
      });
    }
  }, [tabs, activeConnectionId]);

  // Load tabs from file storage when connection changes
  useEffect(() => {
    if (!activeConnectionId) {
      setTabs([]);
      setIsLoading(false);
      return;
    }

    // This connection's tabs are already live in memory. Storage copies are
    // saved result-stripped, so reloading them here would wipe the query
    // results of every tab whenever the user switches connections (#292).
    if (tabsRef.current.some((t) => t.connectionId === activeConnectionId)) {
      setIsLoading(false);
      return;
    }

    const loadPreferences = async () => {
      setIsLoading(true);
      try {
        const { tabs: loadedTabs, activeTabId: loadedActiveTabId } = await loadEditorPreferences(activeConnectionId);

        // Migrate old notebook tabs: notebookState → notebookId
        for (const tab of loadedTabs) {
          if (tab.type === "notebook" && tab.notebookState && !tab.notebookId) {
            try {
              const { notebookId } = await createNotebookFromState(
                tab.title,
                tab.notebookState,
                activeConnectionId,
              );
              tab.notebookId = notebookId;
              tab.notebookState = undefined;
            } catch (e) {
              console.error("Failed to migrate notebook tab:", e);
            }
          }
        }

        if (loadedTabs.length > 0) {
          // Merge loaded tabs with tabs from other connections
          setTabs((prev) => {
            const tabsFromOtherConnections = prev.filter(t => t.connectionId !== activeConnectionId);
            return [...tabsFromOtherConnections, ...loadedTabs];
          });
          setActiveTabIds((prev) => ({
            ...prev,
            [activeConnectionId]: loadedActiveTabId || loadedTabs[0].id,
          }));
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

  // Flush all pending notebook saves on app close
  useEffect(() => {
    const handleBeforeUnload = () => {
      flushAllPendingSaves();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  // Save tabs to file storage when they change
  useEffect(() => {
    if (!activeConnectionId || isLoading) return;

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

  // Open (or focus) a notebook tab, possibly belonging to another connection.
  // For the active connection it resolves immediately; otherwise it records the
  // intent and lets the effect below complete it after the target connection's
  // tabs have loaded (the caller is expected to call switchConnection too).
  const resolvePendingNotebook = useCallback(() => {
    const pending = pendingNotebookRef.current;
    if (!pending) return;
    if (isLoading || pending.connectionId !== activeConnectionId) return;
    pendingNotebookRef.current = null;
    const existing = tabsRef.current.find(
      (t) => t.notebookId === pending.notebookId,
    );
    if (existing) {
      setActiveTabId(existing.id);
    } else {
      addTab({ type: "notebook", notebookId: pending.notebookId, title: pending.title });
    }
  }, [isLoading, activeConnectionId, addTab, setActiveTabId]);

  const openNotebook = useCallback(
    (connectionId: string, notebookId: string, title: string) => {
      pendingNotebookRef.current = { connectionId, notebookId, title };
      resolvePendingNotebook();
    },
    [resolvePendingNotebook],
  );

  // Complete a deferred cross-connection notebook open once the connection's
  // tabs have settled (isLoading false + activeConnectionId matches).
  useEffect(() => {
    resolvePendingNotebook();
  }, [resolvePendingNotebook]);

  // Record tabs closed by the close actions below on their connection's
  // reopen stack. Runs outside the setTabs updater so React strict mode's
  // double invocation cannot push an entry twice.
  const rememberClosedTabs = useCallback((closedIds: string[]) => {
    const next = pushClosedTabs(closedTabsRef.current, tabsRef.current, closedIds);
    closedTabsRef.current = next;
    setClosedTabs(next);
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      // Flush and evict notebook cache for the closed tab
      const closedTab = tabsRef.current.find((t) => t.id === id);
      if (closedTab?.notebookId) {
        evictFromCache(closedTab.notebookId);
      }

      rememberClosedTabs([id]);

      setTabs((prev) => {
        const {
          newTabs,
          newActiveTabId: nextActiveId,
        } = closeTabWithState(
          prev,
          activeConnectionId || "",
          activeTabId,
          id,
        );

        if (nextActiveId !== activeTabId) {
          setActiveTabIds((prevIds) => ({
            ...prevIds,
            [activeConnectionId || ""]: nextActiveId || "",
          }));
        }

        return newTabs;
      });
    },
    [activeConnectionId, activeTabId, rememberClosedTabs],
  );

  const closeAllTabs = useCallback(() => {
    if (!activeConnectionId) return;
    rememberClosedTabs(
      tabsRef.current
        .filter((t) => t.connectionId === activeConnectionId)
        .map((t) => t.id),
    );
    setTabs((prev) => {
      const { newTabs, newActiveTabId } = closeAllTabsForConnection(
        prev,
        activeConnectionId,
      );
      setActiveTabIds((prevIds) => ({
        ...prevIds,
        [activeConnectionId]: newActiveTabId || "",
      }));
      return newTabs;
    });
  }, [activeConnectionId, rememberClosedTabs]);

  const closeOtherTabs = useCallback(
    (id: string) => {
      if (!activeConnectionId) return;
      rememberClosedTabs(
        tabsRef.current
          .filter((t) => t.connectionId === activeConnectionId && t.id !== id)
          .map((t) => t.id),
      );
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
    [activeConnectionId, rememberClosedTabs],
  );

  const closeTabsToLeftInternal = useCallback(
    (id: string) => {
      if (!activeConnectionId) return;
      const connTabs = tabsRef.current.filter(
        (t) => t.connectionId === activeConnectionId,
      );
      const targetIndex = connTabs.findIndex((t) => t.id === id);
      rememberClosedTabs(
        targetIndex === -1
          ? []
          : connTabs.slice(0, targetIndex).map((t) => t.id),
      );
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
    [activeConnectionId, activeTabId, rememberClosedTabs],
  );

  const closeTabsToRightInternal = useCallback(
    (id: string) => {
      if (!activeConnectionId) return;
      const connTabs = tabsRef.current.filter(
        (t) => t.connectionId === activeConnectionId,
      );
      const targetIndex = connTabs.findIndex((t) => t.id === id);
      rememberClosedTabs(
        targetIndex === -1
          ? []
          : connTabs.slice(targetIndex + 1).map((t) => t.id),
      );
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
    [activeConnectionId, activeTabId, rememberClosedTabs],
  );

  // Reopen the most recently closed tab of the active connection at its
  // previous position and activate it. Reads both mirrors through refs so
  // two quick presses restore two different tabs (LIFO).
  const reopenClosedTab = useCallback((): string | null => {
    if (!activeConnectionId) return null;
    const { entry, stacks } = popClosedTab(closedTabsRef.current, activeConnectionId);
    if (!entry) return null;
    closedTabsRef.current = stacks;
    setClosedTabs(stacks);

    const { newTabs, tab } = insertReopenedTab(
      tabsRef.current,
      activeConnectionId,
      entry,
    );
    setTabs(newTabs);
    setActiveTabId(tab.id);
    return tab.id;
  }, [activeConnectionId, setActiveTabId]);

  const updateTab = useCallback(
    (id: string, partial: Partial<Tab> | ((tab: Tab) => Partial<Tab>)) => {
      setTabs((prev) => updateTabInList(prev, id, partial));
    },
    [],
  );

  const reorderTab = useCallback(
    (fromTabId: string, insertAt: number) => {
      if (!activeConnectionId) return;
      setTabs((prev) => moveTab(prev, activeConnectionId, fromTabId, insertAt));
    },
    [activeConnectionId],
  );

  const updateResultEntry = useCallback(
    (tabId: string, entryId: string, partial: Partial<QueryResultEntry>) => {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tabId && t.results
            ? {
                ...t,
                results: t.results.map((r) =>
                  r.id === entryId ? { ...r, ...partial } : r,
                ),
              }
            : t,
        ),
      );
    },
    [],
  );

  const getSchema = useCallback(
    async (
      connectionId: string,
      schemaVersion?: number,
      schema?: string,
    ): Promise<TableSchema[]> => {
      const cacheKey = schema ? `${connectionId}:${schema}` : connectionId;
      const cached = schemaCacheRef.current[cacheKey];

      if (shouldUseCachedSchema(cached, schemaVersion)) {
        return cached!.data;
      }

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

  const canReopenClosedTab =
    !!activeConnectionId && (closedTabs[activeConnectionId]?.length ?? 0) > 0;

  const contextValue = useMemo(
    () => ({
      tabs: connectionTabs,
      activeTabId,
      activeTab,
      addTab,
      openNotebook,
      closeTab,
      updateTab,
      reorderTab,
      updateResultEntry,
      setActiveTabId,
      closeAllTabs,
      closeOtherTabs,
      closeTabsToLeft: closeTabsToLeftInternal,
      closeTabsToRight: closeTabsToRightInternal,
      reopenClosedTab,
      canReopenClosedTab,
      getSchema,
      getAutoRefreshSchedule,
    }),
    [
      connectionTabs,
      activeTabId,
      activeTab,
      addTab,
      openNotebook,
      closeTab,
      updateTab,
      reorderTab,
      updateResultEntry,
      setActiveTabId,
      closeAllTabs,
      closeOtherTabs,
      closeTabsToLeftInternal,
      closeTabsToRightInternal,
      reopenClosedTab,
      canReopenClosedTab,
      getSchema,
      getAutoRefreshSchedule,
    ],
  );

  return (
    <EditorContext.Provider value={contextValue}>
      {children}
    </EditorContext.Provider>
  );
};
