import type {
  Tab,
  SchemaCache,
  TableSchema,
  EditorPreferences,
} from "../types/editor";
import { quoteTableRef } from "./identifiers";
import { invoke } from "@tauri-apps/api/core";
import { cleanTabForStorage, restoreTabFromStorage } from "./tabCleaner";
import {
  filterTabsByConnection,
  getActiveTabForConnection,
} from "./tabFilters";

export interface TabsStorage {
  tabs: Tab[];
  activeTabIds: Record<string, string>;
}

export const STORAGE_KEY = "tabularis_editor_tabs";

export function generateTabId(): string {
  return Math.random().toString(36).substring(2, 9);
}

export async function loadEditorPreferences(
  connectionId: string | null,
): Promise<{ tabs: Tab[]; activeTabId: string | null }> {
  if (!connectionId) return { tabs: [], activeTabId: null };

  try {
    const prefs = await invoke<EditorPreferences | null>(
      "load_editor_preferences",
      { connectionId },
    );
    const tabs = (prefs?.tabs || []).map(restoreTabFromStorage);
    return { tabs, activeTabId: prefs?.active_tab_id || null };
  } catch (e) {
    console.error("Failed to load editor preferences", e);
    return { tabs: [], activeTabId: null };
  }
}

/** @deprecated Use loadEditorPreferences instead */
export async function loadTabsFromStorage(
  connectionId: string | null,
): Promise<Tab[]> {
  return (await loadEditorPreferences(connectionId)).tabs;
}

/** @deprecated Use loadEditorPreferences instead */
export async function loadActiveTabId(
  connectionId: string | null,
): Promise<string | null> {
  return (await loadEditorPreferences(connectionId)).activeTabId;
}

export async function saveTabsToStorage(
  connectionId: string,
  tabs: Tab[],
  activeTabId: string | null,
): Promise<void> {
  try {
    // Clean tabs before saving: remove temporary data like results, errors, etc.
    const cleanedTabs = tabs.map(cleanTabForStorage);

    await invoke("save_editor_preferences", {
      connectionId,
      preferences: {
        tabs: cleanedTabs,
        active_tab_id: activeTabId,
      },
    });
  } catch (e) {
    console.error("Failed to save tabs to storage", e);
  }
}

export function createInitialTabState(
  connectionId: string | null,
  partial?: Partial<Tab>,
): Tab {
  return {
    id: generateTabId(),
    title: "Console",
    type: "console",
    query: "",
    result: null,
    error: "",
    executionTime: null,
    page: 1,
    activeTable: null,
    pkColumns: null,
    isLoading: false,
    connectionId: connectionId || "",
    isEditorOpen: partial?.isEditorOpen ?? partial?.type !== "table",
    ...partial,
  };
}

export function generateTabTitle(
  tabs: Tab[],
  activeConnectionId: string,
  partial?: Partial<Tab>,
): string {
  if (partial?.title) {
    return partial.title;
  }

  if (partial?.type === "table" && partial.activeTable) {
    return partial.activeTable;
  }

  const consoleCount = tabs.filter(
    (t) => t.connectionId === activeConnectionId && t.type === "console",
  ).length;
  const queryBuilderCount = tabs.filter(
    (t) => t.connectionId === activeConnectionId && t.type === "query_builder",
  ).length;

  if (partial?.type === "query_builder") {
    return queryBuilderCount === 0
      ? "Visual Query"
      : `Visual Query ${queryBuilderCount + 1}`;
  }

  if (partial?.type === "notebook") {
    const notebookCount = tabs.filter(
      (t) => t.connectionId === activeConnectionId && t.type === "notebook",
    ).length;
    return notebookCount === 0 ? "Notebook" : `Notebook ${notebookCount + 1}`;
  }

  return consoleCount === 0 ? "Console" : `Console ${consoleCount + 1}`;
}

export function findExistingTableTab(
  tabs: Tab[],
  connectionId: string,
  tableName: string | undefined,
  schema?: string,
): Tab | undefined {
  if (!tableName) return undefined;
  return tabs.find(
    (t) =>
      t.connectionId === connectionId &&
      t.type === "table" &&
      t.activeTable === tableName &&
      (t.schema || undefined) === (schema || undefined),
  );
}

export function getConnectionTabs(
  tabs: Tab[],
  connectionId: string | null,
): Tab[] {
  return filterTabsByConnection(tabs, connectionId);
}

export function getActiveTab(
  tabs: Tab[],
  connectionId: string | null,
  activeTabId: string | null,
): Tab | null {
  return getActiveTabForConnection(tabs, connectionId, activeTabId);
}

export interface CloseTabResult {
  newTabs: Tab[];
  newActiveTabId: string | null;
}

export function closeTabWithState(
  tabs: Tab[],
  connectionId: string,
  activeTabId: string | null,
  tabIdToClose: string,
): CloseTabResult {
  const newTabs = tabs.filter((t) => t.id !== tabIdToClose);
  const connTabs = newTabs.filter((t) => t.connectionId === connectionId);

  // If closing the active tab, find next active tab (prefer previous tab)
  let newActiveTabIdResult = activeTabId;
  if (activeTabId === tabIdToClose) {
    const originalConnTabs = tabs.filter(
      (t) => t.connectionId === connectionId,
    );
    const closedIdx = originalConnTabs.findIndex((t) => t.id === tabIdToClose);
    const nextActiveIdx = Math.max(0, closedIdx - 1);
    const nextActiveTab = connTabs[nextActiveIdx];
    newActiveTabIdResult = nextActiveTab?.id || null;
  }

  return {
    newTabs,
    newActiveTabId: newActiveTabIdResult,
  };
}

export function closeAllTabsForConnection(
  tabs: Tab[],
  connectionId: string,
): { newTabs: Tab[]; newActiveTabId: string | null } {
  const otherConnTabs = tabs.filter((t) => t.connectionId !== connectionId);
  return {
    newTabs: otherConnTabs,
    newActiveTabId: null,
  };
}

export function closeOtherTabsForConnection(
  tabs: Tab[],
  connectionId: string,
  keepTabId: string,
): Tab[] {
  return tabs.filter(
    (t) => t.connectionId !== connectionId || t.id === keepTabId,
  );
}

export function closeTabsToLeft(
  tabs: Tab[],
  connectionId: string,
  targetTabId: string,
  activeTabId: string | null,
): { newTabs: Tab[]; newActiveTabId: string | null } {
  const connTabs = tabs.filter((t) => t.connectionId === connectionId);
  const targetIndex = connTabs.findIndex((t) => t.id === targetTabId);

  if (targetIndex === -1) {
    return { newTabs: tabs, newActiveTabId: activeTabId };
  }

  const tabsToClose = connTabs.slice(0, targetIndex).map((t) => t.id);
  const otherConnTabs = tabs.filter((t) => t.connectionId !== connectionId);
  const remainingConnTabs = connTabs.slice(targetIndex);

  const activeTabWasClosed = activeTabId
    ? tabsToClose.includes(activeTabId)
    : false;
  const newActiveTabId = activeTabWasClosed ? targetTabId : activeTabId;

  return {
    newTabs: [...otherConnTabs, ...remainingConnTabs],
    newActiveTabId,
  };
}

export function closeTabsToRight(
  tabs: Tab[],
  connectionId: string,
  targetTabId: string,
  activeTabId: string | null,
): { newTabs: Tab[]; newActiveTabId: string | null } {
  const connTabs = tabs.filter((t) => t.connectionId === connectionId);
  const targetIndex = connTabs.findIndex((t) => t.id === targetTabId);

  if (targetIndex === -1) {
    return { newTabs: tabs, newActiveTabId: activeTabId };
  }

  const tabsToClose = connTabs.slice(targetIndex + 1).map((t) => t.id);
  const otherConnTabs = tabs.filter((t) => t.connectionId !== connectionId);
  const remainingConnTabs = connTabs.slice(0, targetIndex + 1);

  const activeTabWasClosed = activeTabId
    ? tabsToClose.includes(activeTabId)
    : false;
  const newActiveTabId = activeTabWasClosed ? targetTabId : activeTabId;

  return {
    newTabs: [...otherConnTabs, ...remainingConnTabs],
    newActiveTabId,
  };
}

export function updateTabInList(
  tabs: Tab[],
  tabId: string,
  partial: Partial<Tab>,
): Tab[] {
  return tabs.map((t) => (t.id === tabId ? { ...t, ...partial } : t));
}

// Schema cache utilities
export function shouldUseCachedSchema(
  cached: SchemaCache | undefined,
  schemaVersion?: number,
): boolean {
  if (!cached) return false;

  // If schemaVersion is provided, check if it matches
  if (schemaVersion !== undefined && cached.version !== schemaVersion) {
    return false;
  }

  // Check if cache is less than 5 minutes old (300000 ms)
  const isFresh = Date.now() - cached.timestamp < 300000;
  return isFresh;
}

export function createSchemaCacheEntry(
  data: TableSchema[],
  version: number,
): SchemaCache {
  return {
    data,
    version,
    timestamp: Date.now(),
  };
}

export interface ReconstructQueryOptions {
  filterOverride?: string | null;
  sortOverride?: string | null;
  limitOverride?: number | null;
  wrapLimitSubquery?: boolean;
}

/**
 * Reconstruct a SELECT query for a table tab with filters, sort, and limit.
 * Optional overrides replace the tab's own clause values when provided.
 * When wrapLimitSubquery is true, the LIMIT is applied via a subquery wrapper
 * instead of appending directly.
 */
export function reconstructTableQuery(
  tab: Tab,
  driver?: string,
  options?: ReconstructQueryOptions,
): string {
  if (!tab.activeTable) {
    return tab.query;
  }

  const filterClause =
    options?.filterOverride !== undefined
      ? options.filterOverride
      : tab.filterClause;
  const sortClause =
    options?.sortOverride !== undefined
      ? options.sortOverride
      : tab.sortClause;
  const limitClause =
    options?.limitOverride !== undefined
      ? options.limitOverride
      : tab.limitClause;

  const filter = filterClause ? `WHERE ${filterClause}` : "";
  const sort = sortClause ? `ORDER BY ${sortClause}` : "";
  const quotedTable = quoteTableRef(tab.activeTable, driver, tab.schema);

  let baseQuery = `SELECT * FROM ${quotedTable} ${filter} ${sort}`.trim();

  if (limitClause && limitClause > 0) {
    if (options?.wrapLimitSubquery) {
      baseQuery = `SELECT * FROM (${baseQuery} LIMIT ${limitClause}) AS limited_subset`;
    } else {
      baseQuery = `${baseQuery} LIMIT ${limitClause}`;
    }
  }

  return baseQuery.replace(/\s+/g, " ").trim();
}

/**
 * Format an export filename with timestamp and extension
 * @param tableName - Name of the table being exported
 * @param format - Export format (csv, json, etc.)
 * @returns Formatted filename
 */
export function formatExportFileName(
  tableName: string,
  format: string,
): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const safeName = tableName.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${safeName}_${timestamp}.${format}`;
}

/**
 * Validate a page number input
 * @param pageInput - Page number as string
 * @param totalPages - Total number of pages available
 * @returns True if page number is valid
 */
export function validatePageNumber(
  pageInput: string,
  totalPages: number,
): boolean {
  const num = parseInt(pageInput, 10);
  return !isNaN(num) && num >= 1 && num <= totalPages;
}

/**
 * Calculate total pages based on total rows and page size
 * @param totalRows - Total number of rows
 * @param pageSize - Number of rows per page
 * @returns Total number of pages
 */
export function calculateTotalPages(
  totalRows: number | null,
  pageSize: number,
): number {
  if (totalRows === null || totalRows === 0) return 1;
  return Math.ceil(totalRows / pageSize);
}
