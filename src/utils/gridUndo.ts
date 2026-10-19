/**
 * Command history for pending cell edits, row insertions, row deletions,
 * and grouped paste/fill operations in the data grid before commit.
 */

export type PendingChangesMap = Record<
  string,
  { pkOriginalValue: unknown; changes: Record<string, unknown> }
>;

export type PendingDeletionsMap = Record<string, unknown>;

export interface PendingInsertion {
  tempId: string;
  data: Record<string, unknown>;
  displayIndex?: number;
}

export type PendingInsertionsMap = Record<string, PendingInsertion>;

export interface GridPendingSnapshot {
  pendingChanges?: PendingChangesMap;
  pendingDeletions?: PendingDeletionsMap;
  pendingInsertions?: PendingInsertionsMap;
}

/** Maximum number of undo steps kept in memory per tab. */
export const GRID_HISTORY_LIMIT = 50;

/** Consecutive rapid burst writes (e.g. multi-cell paste/fill) collapse into a single step. */
export const GRID_BURST_COALESCE_MS = 150;

/** Consecutive edits to the same row collapse into a single undo step within this window. */
export const GRID_COALESCE_MS = 500;

export type GridSnapshotEntry = GridPendingSnapshot | undefined;

export interface GridHistory {
  past: GridSnapshotEntry[];
  future: GridSnapshotEntry[];
  /** Timestamp of the last recorded edit, used to coalesce rapid typing / grouped writes. */
  lastEditTime: number;
  /** Key of the last modified row/entity, used to distinguish same-cell vs distinct-cell edits. */
  lastModifiedKey?: string | null;
}

export function createGridHistory(): GridHistory {
  return { past: [], future: [], lastEditTime: 0, lastModifiedKey: null };
}

function isSnapshot(val: unknown): val is GridPendingSnapshot {
  if (!val || typeof val !== "object") return false;
  return (
    "pendingChanges" in val ||
    "pendingDeletions" in val ||
    "pendingInsertions" in val
  );
}

export function toGridSnapshot(
  state: GridPendingSnapshot | PendingChangesMap | undefined,
): GridPendingSnapshot | undefined {
  if (!state) return undefined;
  if (isSnapshot(state)) {
    if (
      !state.pendingChanges &&
      !state.pendingDeletions &&
      !state.pendingInsertions
    ) {
      return undefined;
    }
    return {
      pendingChanges: state.pendingChanges,
      pendingDeletions: state.pendingDeletions,
      pendingInsertions: state.pendingInsertions,
    };
  }
  return { pendingChanges: state as PendingChangesMap };
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

/** Deep clone of the pending deletions map. */
export function clonePendingDeletions(
  deletions: PendingDeletionsMap | undefined,
): PendingDeletionsMap | undefined {
  if (!deletions) return undefined;
  const clone: PendingDeletionsMap = {};
  for (const [key, val] of Object.entries(deletions)) {
    clone[key] =
      val && typeof val === "object"
        ? { ...(val as Record<string, unknown>) }
        : val;
  }
  return Object.keys(clone).length > 0 ? clone : undefined;
}

/** Deep clone of the pending insertions map. */
export function clonePendingInsertions(
  insertions: PendingInsertionsMap | undefined,
): PendingInsertionsMap | undefined {
  if (!insertions) return undefined;
  const clone: PendingInsertionsMap = {};
  for (const [key, entry] of Object.entries(insertions)) {
    if (entry) {
      clone[key] = {
        tempId: entry.tempId,
        displayIndex: entry.displayIndex ?? 0,
        data: { ...entry.data },
      };
    }
  }
  return Object.keys(clone).length > 0 ? clone : undefined;
}

/** Deep clone of an entire grid pending snapshot. Returns undefined if empty. */
export function cloneGridSnapshot(
  snapshot: GridPendingSnapshot | undefined,
): GridPendingSnapshot | undefined {
  if (!snapshot) return undefined;
  const changes = clonePendingChanges(snapshot.pendingChanges);
  const deletions = clonePendingDeletions(snapshot.pendingDeletions);
  const insertions = clonePendingInsertions(snapshot.pendingInsertions);
  if (!changes && !deletions && !insertions) return undefined;
  return {
    pendingChanges: changes,
    pendingDeletions: deletions,
    pendingInsertions: insertions,
  };
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
 * Deterministic signature of an entire grid snapshot (changes, deletions, insertions).
 */
export function gridSnapshotSignature(
  state: GridPendingSnapshot | PendingChangesMap | undefined,
): string {
  if (!state) return "";
  const snap = toGridSnapshot(state);
  if (!snap) return "";
  const changesSig = pendingChangesSignature(snap.pendingChanges);

  const delKeys = Object.keys(snap.pendingDeletions || {}).sort();
  const delSig = delKeys.length === 0 ? "" : JSON.stringify(delKeys);

  const insKeys = Object.keys(snap.pendingInsertions || {}).sort();
  let insSig = "";
  if (insKeys.length > 0) {
    const norm: Record<string, unknown> = {};
    for (const key of insKeys) {
      const ins = snap.pendingInsertions![key];
      norm[key] = {
        d: ins.displayIndex,
        data: ins.data,
      };
    }
    insSig = JSON.stringify(norm);
  }

  return `${changesSig}::${delSig}::${insSig}`;
}

function findModifiedKey(
  prev: GridPendingSnapshot | undefined,
  next: GridPendingSnapshot | undefined,
): string | null {
  const pCh = prev?.pendingChanges || {};
  const nCh = next?.pendingChanges || {};
  for (const k of Object.keys(nCh)) {
    if (JSON.stringify(pCh[k]) !== JSON.stringify(nCh[k])) return `c:${k}`;
  }
  for (const k of Object.keys(pCh)) {
    if (!nCh[k]) return `c:${k}`;
  }

  const pIns = prev?.pendingInsertions || {};
  const nIns = next?.pendingInsertions || {};
  for (const k of Object.keys(nIns)) {
    if (JSON.stringify(pIns[k]) !== JSON.stringify(nIns[k])) return `i:${k}`;
  }
  for (const k of Object.keys(pIns)) {
    if (!nIns[k]) return `i:${k}`;
  }

  return null;
}

/**
 * Record a transition between grid pending states.
 * - Identical states are ignored.
 * - Rapid burst operations (< 150ms) collapse into a single undo step (paste / fill / bulk transform).
 * - Successive edits to the same entity within 500ms collapse into a single undo step.
 * - Edits to distinct entities across human intervals (> 150ms) remain independent undo steps.
 * - A new edit clears the redo (future) branch.
 */
export function recordGridEdit(
  history: GridHistory = createGridHistory(),
  prev: GridPendingSnapshot | PendingChangesMap | undefined,
  next: GridPendingSnapshot | PendingChangesMap | undefined,
  now: number,
  options?: { coalesce?: boolean },
): GridHistory {
  if (gridSnapshotSignature(prev) === gridSnapshotSignature(next)) {
    return history;
  }

  const prevSnap = cloneGridSnapshot(toGridSnapshot(prev));
  const nextSnap = toGridSnapshot(next);
  const modifiedKey = findModifiedKey(prevSnap, nextSnap);
  const elapsed = now - history.lastEditTime;

  const isSameEntity = !!modifiedKey && modifiedKey === history.lastModifiedKey;
  const isBurstOperation = elapsed < GRID_BURST_COALESCE_MS;
  const isSameEntityQuickEdit = isSameEntity && elapsed < GRID_COALESCE_MS;

  const shouldCoalesce =
    options?.coalesce !== false &&
    history.past.length > 0 &&
    (isBurstOperation || isSameEntityQuickEdit);

  if (shouldCoalesce) {
    return { ...history, lastEditTime: now, lastModifiedKey: modifiedKey };
  }

  const past = [...history.past, prevSnap];
  if (past.length > GRID_HISTORY_LIMIT) {
    past.shift();
  }

  return {
    past,
    future: [],
    lastEditTime: now,
    lastModifiedKey: modifiedKey,
  };
}

export interface GridHistoryStep {
  history: GridHistory;
  pendingChanges: PendingChangesMap | undefined;
  pendingDeletions: PendingDeletionsMap | undefined;
  pendingInsertions: PendingInsertionsMap | undefined;
}

/**
 * Step back one edit. Returns null when there is nothing to undo.
 */
export function undoGridEdit(
  history: GridHistory,
  current: GridPendingSnapshot | PendingChangesMap | undefined,
): GridHistoryStep | null {
  if (!history || history.past.length === 0) return null;
  const past = [...history.past];
  const target = past.pop();
  return {
    history: {
      past,
      future: [cloneGridSnapshot(toGridSnapshot(current)), ...history.future],
      lastEditTime: 0,
      lastModifiedKey: null,
    },
    pendingChanges: clonePendingChanges(target?.pendingChanges),
    pendingDeletions: clonePendingDeletions(target?.pendingDeletions),
    pendingInsertions: clonePendingInsertions(target?.pendingInsertions),
  };
}

/**
 * Step forward one edit. Returns null when there is nothing to redo.
 */
export function redoGridEdit(
  history: GridHistory,
  current: GridPendingSnapshot | PendingChangesMap | undefined,
): GridHistoryStep | null {
  if (!history || history.future.length === 0) return null;
  const [target, ...future] = history.future;
  return {
    history: {
      past: [...history.past, cloneGridSnapshot(toGridSnapshot(current))],
      future,
      lastEditTime: 0,
      lastModifiedKey: null,
    },
    pendingChanges: clonePendingChanges(target?.pendingChanges),
    pendingDeletions: clonePendingDeletions(target?.pendingDeletions),
    pendingInsertions: clonePendingInsertions(target?.pendingInsertions),
  };
}

export function canUndoGrid(history: GridHistory | undefined): boolean {
  return !!history && history.past.length > 0;
}

export function canRedoGrid(history: GridHistory | undefined): boolean {
  return !!history && history.future.length > 0;
}
