import type { AutoRefreshInterval, Tab } from "../types/editor";

export const AUTO_REFRESH_INTERVALS = [0, 5000, 10000, 30000, 60000] as const;

export function normalizeAutoRefreshInterval(value: unknown): AutoRefreshInterval {
  return AUTO_REFRESH_INTERVALS.find((interval) => interval === value) ?? 0;
}

export function hasPendingTableEdits(tab: Pick<Tab, "pendingChanges" | "pendingInsertions" | "pendingDeletions">): boolean {
  return [tab.pendingChanges, tab.pendingInsertions, tab.pendingDeletions]
    .some((pending) => pending && Object.keys(pending).length > 0);
}

export function tableRefreshIdentity(tab: Tab): string {
  return JSON.stringify([tab.connectionId, tab.activeTable, tab.query, tab.schema,
    tab.page, tab.pageSize, tab.filterClause, tab.sortClause, tab.limitClause, tab.queryParams]);
}

export interface AutoRefreshSnapshot {
  intervalMs: AutoRefreshInterval;
  lastCompletedAt: number | null;
  nextDueAt: number | null;
  busy: boolean;
  editing: boolean;
  revision: number;
}

/** One tab's runtime schedule. Its owner outlives the active table toolbar. */
export function createAutoRefreshSchedule() {
  let snapshot: AutoRefreshSnapshot = {
    intervalMs: 0, lastCompletedAt: null, nextDueAt: null,
    busy: false, editing: false, revision: 0,
  };
  const listeners = new Set<() => void>();
  let tail: Promise<void> = Promise.resolve();
  let pending = 0;

  const publish = (partial: Partial<AutoRefreshSnapshot>) => {
    snapshot = { ...snapshot, ...partial };
    listeners.forEach((listener) => listener());
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    configure: (value: number) => {
      const intervalMs = normalizeAutoRefreshInterval(value);
      if (intervalMs === snapshot.intervalMs) return;
      publish({ intervalMs, nextDueAt: intervalMs
        ? (snapshot.lastCompletedAt ?? Date.now()) + intervalMs : null });
    },
    complete: () => {
      const now = Date.now();
      publish({ lastCompletedAt: now, nextDueAt: snapshot.intervalMs ? now + snapshot.intervalMs : null });
    },
    setEditing: (editing: boolean) => {
      if (snapshot.editing !== editing) {
        publish({ editing, revision: snapshot.revision + 1 });
      }
    },
    invalidate: () => publish({ revision: snapshot.revision + 1 }),
    run: <T>(operation: () => Promise<T>, automatic = false): Promise<T | undefined> => {
      if (automatic && pending > 0) return Promise.resolve(undefined);
      pending += 1;
      publish({ busy: true });
      const result = tail.then(operation).finally(() => {
        pending -= 1;
        publish({ busy: pending > 0 });
      });
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}

export type AutoRefreshSchedule = ReturnType<typeof createAutoRefreshSchedule>;
