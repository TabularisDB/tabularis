/**
 * Command history for pending cell edits and grouped paste/fill operations
 * in the data grid before commit.
 */

export type PendingChangesMap = Record<
  string,
  { pkOriginalValue: unknown; changes: Record<string, unknown> }
>;

/** Maximum number of undo steps kept in memory per tab. */
export const GRID_HISTORY_LIMIT = 50;

/** Consecutive edits within this window collapse into a single undo step. */
export const GRID_COALESCE_MS = 500;

export interface GridHistory {
  past: (PendingChangesMap | undefined)[];
  future: (PendingChangesMap | undefined)[];
  /** Timestamp of the last recorded edit, used to coalesce rapid typing / grouped writes. */
  lastEditTime: number;
}

export function createGridHistory(): GridHistory {
  return { past: [], future: [], lastEditTime: 0 };
}

/** Deep clone of the pending changes map to preserve historical snapshots. */
export function clonePendingChanges(
  changes: PendingChangesMap | undefined,
): PendingChangesMap | undefined {
  if (!changes) return undefined;
  const clone: PendingChangesMap = {};
  for (const [key, entry] of Object.entries(changes)) {
    if (entry && entry.changes) {
      clone[key] = {
        pkOriginalValue: entry.pkOriginalValue,
        changes: { ...entry.changes },
      };
    }
  }
  return Object.keys(clone).length > 0 ? clone : undefined;
}

/**
 * Deterministic signature of pending changes for equality checking.
 */
export function pendingChangesSignature(
  changes: PendingChangesMap | undefined,
): string {
  if (!changes || Object.keys(changes).length === 0) return "";
  const sortedKeys = Object.keys(changes).sort();
  const normalized: Record<string, Record<string, unknown>> = {};
  for (const key of sortedKeys) {
    const entry = changes[key];
    if (entry && entry.changes && Object.keys(entry.changes).length > 0) {
      const colKeys = Object.keys(entry.changes).sort();
      const colMap: Record<string, unknown> = {};
      for (const col of colKeys) {
        colMap[col] = entry.changes[col];
      }
      normalized[key] = colMap;
    }
  }
  return JSON.stringify(normalized);
}

/**
 * Record a transition between pending changes states.
 * - Identical states are ignored.
 * - Edits within {@link GRID_COALESCE_MS} merge into the current step (e.g. multi-cell paste/fill).
 * - A new edit clears the redo (future) branch.
 */
export function recordGridEdit(
  history: GridHistory = createGridHistory(),
  prev: PendingChangesMap | undefined,
  next: PendingChangesMap | undefined,
  now: number,
  options?: { coalesce?: boolean },
): GridHistory {
  if (pendingChangesSignature(prev) === pendingChangesSignature(next)) {
    return history;
  }

  const shouldCoalesce =
    options?.coalesce !== false &&
    now - history.lastEditTime < GRID_COALESCE_MS &&
    history.past.length > 0;

  if (shouldCoalesce) {
    return { ...history, lastEditTime: now };
  }

  const past = [...history.past, clonePendingChanges(prev)];
  if (past.length > GRID_HISTORY_LIMIT) {
    past.shift();
  }

  return {
    past,
    future: [],
    lastEditTime: now,
  };
}

export interface GridHistoryStep {
  history: GridHistory;
  pendingChanges: PendingChangesMap | undefined;
}

/**
 * Step back one edit. Returns null when there is nothing to undo.
 */
export function undoGridEdit(
  history: GridHistory,
  current: PendingChangesMap | undefined,
): GridHistoryStep | null {
  if (!history || history.past.length === 0) return null;
  const past = [...history.past];
  const target = past.pop();
  return {
    history: {
      past,
      future: [clonePendingChanges(current), ...history.future],
      lastEditTime: 0,
    },
    pendingChanges: clonePendingChanges(target),
  };
}

/**
 * Step forward one edit. Returns null when there is nothing to redo.
 */
export function redoGridEdit(
  history: GridHistory,
  current: PendingChangesMap | undefined,
): GridHistoryStep | null {
  if (!history || history.future.length === 0) return null;
  const [target, ...future] = history.future;
  return {
    history: {
      past: [...history.past, clonePendingChanges(current)],
      future,
      lastEditTime: 0,
    },
    pendingChanges: clonePendingChanges(target),
  };
}

export function canUndoGrid(history: GridHistory | undefined): boolean {
  return !!history && history.past.length > 0;
}

export function canRedoGrid(history: GridHistory | undefined): boolean {
  return !!history && history.future.length > 0;
}
