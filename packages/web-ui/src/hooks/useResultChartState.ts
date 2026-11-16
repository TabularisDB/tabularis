import {useCallback, useSyncExternalStore} from 'react';
import type {ResultChartConfig, ResultView} from '@/utils/resultChart';
import {resultEntryIdPrefix} from '@/utils/multiResult';

export interface ResultChartState {
    view: ResultView;
    /** Last chart config the user picked; null until they change something. */
    config: ResultChartConfig | null;
}

const DEFAULT_STATE: ResultChartState = {view: 'grid', config: null};

// Module-level so the choice survives the result panel remounting (switching
// editor tabs unmounts it). Keyed by tab id or result entry id; not persisted.
// Entry ids are reused per tab, so the map holds at most one state per tab and
// result entry, and closing a tab drops its states (forgetResultChartStates).
const states = new Map<string, ResultChartState>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function update(key: string, patch: Partial<ResultChartState>) {
    states.set(key, {...(states.get(key) ?? DEFAULT_STATE), ...patch});
    listeners.forEach((listener) => listener());
}

/** Forgets the stored views and configs of closed tabs and their result entries. */
export function forgetResultChartStates(tabIds: readonly string[]) {
    if (tabIds.length === 0 || states.size === 0) return;
    const prefixes = tabIds.map(resultEntryIdPrefix);
    let changed = false;
    for (const key of states.keys()) {
        if (tabIds.includes(key) || prefixes.some((prefix) => key.startsWith(prefix))) {
            states.delete(key);
            changed = true;
        }
    }
    if (changed) listeners.forEach((listener) => listener());
}

/** Forgets every stored view and config. Exposed for tests. */
export function resetResultChartStates() {
    states.clear();
    listeners.forEach((listener) => listener());
}

/**
 * Grid/chart view and chart config for one result, identified by `key`.
 * A null key always reads as the grid and ignores writes.
 */
export function useResultChartState(key: string | null) {
    const state = useSyncExternalStore(subscribe, () =>
        key === null ? DEFAULT_STATE : (states.get(key) ?? DEFAULT_STATE),
    );
    const setView = useCallback(
        (view: ResultView) => {
            if (key !== null) update(key, {view});
        },
        [key],
    );
    const setConfig = useCallback(
        (config: ResultChartConfig) => {
            if (key !== null) update(key, {config});
        },
        [key],
    );
    return {...state, setView, setConfig};
}
