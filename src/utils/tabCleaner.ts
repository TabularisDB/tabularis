import type { Tab } from '../types/editor';

/**
 * Interface representing a cleaned tab with only persistent data
 */
export interface CleanedTab {
  id: string;
  title: string;
  type: 'console' | 'table' | 'query_builder' | 'notebook';
  query: string;
  page: number;
  activeTable: string | null;
  pkColumn: string | null;
  connectionId: string;
  flowState?: Tab['flowState'];
  isEditorOpen?: boolean;
  filterClause?: string;
  sortClause?: string;
  limitClause?: number;
  queryParams?: Record<string, string>;
  notebookId?: string;
  schema?: string;
  readOnly?: boolean;
}

/**
 * Removes temporary/runtime data from a tab, keeping only persistent state.
 * Excludes: result, error, executionTime, isLoading, pendingChanges, pendingDeletions, selectedRows
 * For notebook tabs: only persists notebookId reference, not the full notebookState.
 *
 * @param tab - The tab to clean
 * @returns A cleaned tab with only persistent data
 */
export function cleanTabForStorage(tab: Tab): CleanedTab {
  return {
    id: tab.id,
    title: tab.title,
    type: tab.type,
    query: tab.query,
    page: tab.page,
    activeTable: tab.activeTable,
    pkColumn: tab.pkColumn,
    connectionId: tab.connectionId,
    flowState: tab.flowState,
    isEditorOpen: tab.isEditorOpen,
    filterClause: tab.filterClause,
    sortClause: tab.sortClause,
    limitClause: tab.limitClause,
    queryParams: tab.queryParams,
    notebookId: tab.notebookId,
    schema: tab.schema,
    readOnly: tab.readOnly,
  };
}

/**
 * Restores a tab from storage, adding default values for temporary fields
 *
 * @param cleanedTab - The cleaned tab from storage
 * @returns A full tab with default values for temporary fields
 */
export function restoreTabFromStorage(cleanedTab: Partial<Tab>): Tab {
  return {
    ...cleanedTab,
    id: cleanedTab.id || '',
    title: cleanedTab.title || 'Untitled',
    type: cleanedTab.type || 'console',
    query: cleanedTab.query || '',
    page: cleanedTab.page || 1,
    activeTable: cleanedTab.activeTable || null,
    pkColumn: cleanedTab.pkColumn || null,
    connectionId: cleanedTab.connectionId || '',
    result: null,
    error: '',
    executionTime: null,
    isLoading: false,
    pendingChanges: undefined,
    pendingDeletions: undefined,
    selectedRows: undefined,
    notebookId: cleanedTab.notebookId,
    notebookState: undefined,
  };
}
