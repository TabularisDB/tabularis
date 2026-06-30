import type { QueryResultEntry } from "../types/editor";

/**
 * Creates initial QueryResultEntry array from a list of queries.
 * All entries start in loading state.
 */
export function createResultEntries(
  tabId: string,
  queries: string[],
): QueryResultEntry[] {
  return queries.map((query, index) => ({
    id: `${tabId}-result-${index}`,
    queryIndex: index,
    query,
    result: null,
    error: "",
    executionTime: null,
    isLoading: true,
    page: 1,
    activeTable: null,
    pkColumns: null,
  }));
}

/**
 * Updates a single entry within a results array by id.
 * Returns a new array with the matching entry replaced.
 */
export function updateResultEntry(
  results: QueryResultEntry[],
  entryId: string,
  partial: Partial<QueryResultEntry>,
): QueryResultEntry[] {
  return results.map((r) =>
    r.id === entryId ? { ...r, ...partial } : r,
  );
}

/**
 * Finds the active result entry from a results array.
 * Falls back to the first entry if activeResultId is not found.
 */
export function findActiveEntry(
  results: QueryResultEntry[],
  activeResultId: string | undefined,
): QueryResultEntry | undefined {
  if (results.length === 0) return undefined;
  return results.find((r) => r.id === activeResultId) || results[0];
}

/**
 * Counts succeeded entries (not loading, no error, has result).
 */
export function countSucceeded(results: QueryResultEntry[]): number {
  return results.filter((r) => !r.isLoading && !r.error && r.result).length;
}

/**
 * Counts failed entries (not loading, has error).
 */
export function countFailed(results: QueryResultEntry[]): number {
  return results.filter((r) => !r.isLoading && r.error).length;
}

/**
 * Sums execution times across all entries.
 */
export function totalExecutionTime(results: QueryResultEntry[]): number {
  return results.reduce((sum, r) => sum + (r.executionTime ?? 0), 0);
}

/**
 * Removes an entry from the results array.
 * Returns the new results and the id of the entry that should become active
 * (next sibling, or previous if last was removed).
 */
export function removeResultEntry(
  results: QueryResultEntry[],
  entryId: string,
  activeResultId: string | undefined,
): { results: QueryResultEntry[]; nextActiveId: string | undefined } {
  const idx = results.findIndex((r) => r.id === entryId);
  if (idx === -1) return { results, nextActiveId: activeResultId };

  const filtered = results.filter((r) => r.id !== entryId);
  if (filtered.length === 0) {
    return { results: filtered, nextActiveId: undefined };
  }

  let nextActiveId = activeResultId;
  if (activeResultId === entryId) {
    const nextIdx = Math.min(idx, filtered.length - 1);
    nextActiveId = filtered[nextIdx].id;
  }

  return { results: filtered, nextActiveId };
}

/**
 * Removes all entries except the one with the given id.
 */
export function removeOtherEntries(
  results: QueryResultEntry[],
  keepId: string,
): { results: QueryResultEntry[]; nextActiveId: string } {
  const kept = results.filter((r) => r.id === keepId);
  return { results: kept, nextActiveId: keepId };
}

/**
 * Removes all entries to the right of the given id.
 */
export function removeEntriesToRight(
  results: QueryResultEntry[],
  entryId: string,
  activeResultId: string | undefined,
): { results: QueryResultEntry[]; nextActiveId: string | undefined } {
  const idx = results.findIndex((r) => r.id === entryId);
  if (idx === -1) return { results, nextActiveId: activeResultId };
  const kept = results.slice(0, idx + 1);
  const activeStillExists = kept.some((r) => r.id === activeResultId);
  return {
    results: kept,
    nextActiveId: activeStillExists ? activeResultId : entryId,
  };
}

/**
 * Computes the height (in px) for a stacked result grid based on row count.
 * Accounts for header row (35px) and data rows (35px each), capped at maxHeight.
 */
export function getStackedGridHeight(
  rowCount: number,
  maxHeight = 400,
): number {
  const ROW_HEIGHT = 35;
  const HEADER_HEIGHT = 35;
  const contentHeight = HEADER_HEIGHT + rowCount * ROW_HEIGHT;
  return Math.min(contentHeight, maxHeight);
}

/**
 * Returns the display label for a result entry.
 * Uses the custom label if set, otherwise falls back to "Query {index+1}".
 */
export function getEntryDisplayLabel(
  entry: QueryResultEntry,
  fallbackPrefix: string,
): string {
  return entry.label || `${fallbackPrefix} ${entry.queryIndex + 1}`;
}

/**
 * Removes all entries to the left of the given id.
 */
export function removeEntriesToLeft(
  results: QueryResultEntry[],
  entryId: string,
  activeResultId: string | undefined,
): { results: QueryResultEntry[]; nextActiveId: string | undefined } {
  const idx = results.findIndex((r) => r.id === entryId);
  if (idx === -1) return { results, nextActiveId: activeResultId };
  const kept = results.slice(idx);
  const activeStillExists = kept.some((r) => r.id === activeResultId);
  return {
    results: kept,
    nextActiveId: activeStillExists ? activeResultId : entryId,
  };
}
