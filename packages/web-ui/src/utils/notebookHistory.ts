import type { CellExecutionEntry, NotebookCell } from "../types/notebook";
import type { QueryResult } from "../types/editor";

const MAX_HISTORY_SIZE = 10;

export function addHistoryEntry(
  history: CellExecutionEntry[],
  entry: CellExecutionEntry,
  maxSize: number = MAX_HISTORY_SIZE,
): CellExecutionEntry[] {
  const newHistory = [entry, ...history];
  return newHistory.slice(0, maxSize);
}

export function createHistoryEntry(
  query: string,
  result: QueryResult | null,
  error: string | undefined,
  executionTime: number | null,
): CellExecutionEntry {
  return {
    query,
    result,
    error,
    executionTime,
    timestamp: Date.now(),
  };
}

export function restoreFromHistory(
  cell: NotebookCell,
  entryIndex: number,
): Partial<NotebookCell> | null {
  const history = cell.history ?? [];
  const entry = history[entryIndex];
  if (!entry) return null;

  return {
    content: entry.query,
    result: entry.result,
    error: entry.error,
    executionTime: entry.executionTime,
    isLoading: false,
  };
}

export function getHistorySize(cell: NotebookCell): number {
  return cell.history?.length ?? 0;
}

