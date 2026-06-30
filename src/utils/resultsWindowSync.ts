import type { QueryResult, QueryResultEntry, Tab } from "../types/editor";

/**
 * Protocol for syncing query results between the main editor window and a
 * detached results window. The main window owns all query/DB logic and is the
 * single source of truth: it pushes result state to the detached window via
 * {@link RESULTS_SYNC_EVENT} and receives user actions back via
 * {@link RESULTS_ACTION_EVENT}. Keeping the shape and dispatch in one tested
 * module avoids event-name / payload drift between the two windows.
 */

export const RESULTS_SYNC_EVENT = "results-window:sync";
export const RESULTS_ACTION_EVENT = "results-window:action";
export const RESULTS_READY_EVENT = "results-window:ready";
export const RESULTS_CLOSED_EVENT = "results-window:closed";

/** Synthetic entry id used to render a legacy single `Tab.result` through the
 * entry-based detached view. */
export const SINGLE_RESULT_ENTRY_ID = "__single__";

export type CopyFormat = "csv" | "json" | "sql-insert";

/** Display settings the detached window needs but cannot read from main-window
 * React state. */
export interface ResultsDisplaySettings {
  connectionId: string | null;
  copyFormat: CopyFormat;
  csvDelimiter: string;
  csvIncludeHeaders: boolean;
}

/** Full snapshot of the active tab's result state pushed to the detached window. */
export interface ResultsSyncPayload extends ResultsDisplaySettings {
  tabId: string;
  tabTitle: string;
  query: string;
  // Legacy single-result path (`Tab.result`).
  result: QueryResult | null;
  error: string;
  executionTime: number | null;
  isLoading: boolean;
  activeTable: string | null;
  // Multi-result path (`Tab.results`).
  results?: QueryResultEntry[];
  activeResultId?: string;
}

/** Handshake the detached window sends on mount so the main window pushes the
 * current state for its tab. */
export interface ResultsReadyPayload {
  tabId: string;
}

/** Notification (from the backend) that a tab's detached window was closed. */
export interface ResultsClosedPayload {
  tabId: string;
}

/** Actions the detached window forwards to the main window. */
export type ResultsWindowAction =
  | { type: "run-query-page"; query: string; page: number }
  | { type: "page-change"; entryId: string; page: number }
  | { type: "select-result"; entryId: string }
  | { type: "rerun-entry"; entryId: string }
  | { type: "close-entry"; entryId: string }
  | { type: "close-other-entries"; entryId: string }
  | { type: "close-entries-to-right"; entryId: string }
  | { type: "close-entries-to-left"; entryId: string }
  | { type: "close-all-entries" }
  | { type: "rename-entry"; entryId: string; label: string }
  | { type: "load-count" };

/** Action envelope tagging which tab's window forwarded the action, so the main
 * window applies it to the correct tab. */
export interface ResultsActionEnvelope {
  tabId: string;
  action: ResultsWindowAction;
}

/** Handlers the main window wires to its existing result operations. */
export interface ResultsWindowActionHandlers {
  onRunQueryPage: (query: string, page: number) => void;
  onPageChange: (entryId: string, page: number) => void;
  onSelectResult: (entryId: string) => void;
  onRerunEntry: (entryId: string) => void;
  onCloseEntry: (entryId: string) => void;
  onCloseOtherEntries: (entryId: string) => void;
  onCloseEntriesToRight: (entryId: string) => void;
  onCloseEntriesToLeft: (entryId: string) => void;
  onCloseAllEntries: () => void;
  onRenameEntry: (entryId: string, label: string) => void;
  onLoadCount: () => void;
}

/** Build the snapshot pushed to the detached window from the active tab. */
export function buildSyncPayload(
  tab: Tab,
  settings: ResultsDisplaySettings,
): ResultsSyncPayload {
  return {
    tabId: tab.id,
    tabTitle: tab.title,
    query: tab.query,
    result: tab.result,
    error: tab.error,
    executionTime: tab.executionTime,
    isLoading: tab.isLoading ?? false,
    activeTable: tab.activeTable,
    results: tab.results,
    activeResultId: tab.activeResultId,
    connectionId: settings.connectionId,
    copyFormat: settings.copyFormat,
    csvDelimiter: settings.csvDelimiter,
    csvIncludeHeaders: settings.csvIncludeHeaders,
  };
}

/** True when the payload should render the multi-result panel rather than the
 * legacy single-result view. */
export function hasMultiResults(payload: ResultsSyncPayload): boolean {
  return Array.isArray(payload.results) && payload.results.length > 0;
}

/** Adapt a legacy single-result payload into a {@link QueryResultEntry} so the
 * detached window can reuse the entry-based renderer. */
export function singleResultToEntry(
  payload: ResultsSyncPayload,
): QueryResultEntry {
  return {
    id: SINGLE_RESULT_ENTRY_ID,
    queryIndex: 0,
    query: payload.query,
    result: payload.result,
    error: payload.error,
    executionTime: payload.executionTime,
    isLoading: payload.isLoading,
    page: payload.result?.pagination?.page ?? 1,
    activeTable: payload.activeTable,
    pkColumns: null,
  };
}

/** Dispatch a forwarded action to the main window's handlers. */
export function applyAction(
  action: ResultsWindowAction,
  handlers: ResultsWindowActionHandlers,
): void {
  switch (action.type) {
    case "run-query-page":
      handlers.onRunQueryPage(action.query, action.page);
      break;
    case "page-change":
      handlers.onPageChange(action.entryId, action.page);
      break;
    case "select-result":
      handlers.onSelectResult(action.entryId);
      break;
    case "rerun-entry":
      handlers.onRerunEntry(action.entryId);
      break;
    case "close-entry":
      handlers.onCloseEntry(action.entryId);
      break;
    case "close-other-entries":
      handlers.onCloseOtherEntries(action.entryId);
      break;
    case "close-entries-to-right":
      handlers.onCloseEntriesToRight(action.entryId);
      break;
    case "close-entries-to-left":
      handlers.onCloseEntriesToLeft(action.entryId);
      break;
    case "close-all-entries":
      handlers.onCloseAllEntries();
      break;
    case "rename-entry":
      handlers.onRenameEntry(action.entryId, action.label);
      break;
    case "load-count":
      handlers.onLoadCount();
      break;
  }
}
