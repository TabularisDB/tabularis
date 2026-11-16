import {useCallback, useMemo, useSyncExternalStore} from 'react';
import {resultEntryIdPrefix} from '@/utils/multiResult';
import {
    NO_HIDDEN_COLUMNS,
    resolveHiddenColumns,
    toHiddenColumnsState,
    type HiddenColumnsState,
} from '@/utils/hiddenColumns';

// Module-level so hidden columns survive the grid remounting (sorting,
// filtering, adding a row and switching editor tabs all remount it). Keyed by
// tab id or result entry id like the chart view (useResultChartState); not
// persisted, and closing a tab drops its states (forgetHiddenColumns).
const states = new Map<string, HiddenColumnsState>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function notify() {
    listeners.forEach((listener) => listener());
}

/** Forgets the hidden columns of closed tabs and their result entries. */
export function forgetHiddenColumns(tabIds: readonly string[]) {
    if (tabIds.length === 0 || states.size === 0) return;
    const prefixes = tabIds.map(resultEntryIdPrefix);
    let changed = false;
    for (const key of states.keys()) {
        if (tabIds.includes(key) || prefixes.some((prefix) => key.startsWith(prefix))) {
            states.delete(key);
            changed = true;
        }
    }
    if (changed) notify();
}

/** Forgets every hidden column. Exposed for tests. */
export function resetHiddenColumns() {
    states.clear();
    notify();
}

/**
 * Hidden columns of one result (#1299), identified by `key` (a tab or result
 * entry id). They apply while the result has the same columns: refreshing,
 * paging or re-running the query keeps them, a result with other columns
 * shows every column. A null key never hides anything and ignores writes.
 */
export function useHiddenColumns(key: string | null, columns: string[]) {
    const state = useSyncExternalStore(subscribe, () =>
        key === null ? undefined : states.get(key),
    );
    const hidden = useMemo(
        () => (key === null ? NO_HIDDEN_COLUMNS : resolveHiddenColumns(state, columns)),
        [key, state, columns],
    );
    const setHidden = useCallback(
        (next: ReadonlySet<number>) => {
            if (key === null) return;
            if (next.size === 0) states.delete(key);
            else states.set(key, toHiddenColumnsState(columns, next));
            notify();
        },
        [key, columns],
    );
    return {hidden, setHidden};
}
