import {useCallback, useSyncExternalStore} from 'react';
import type {CellChartConfig} from '@/types/notebook';
import type {ResultView} from '@/utils/resultChart';

export interface ResultChartState {
    view: ResultView;
    /** Last chart config the user picked; null until they change something. */
    config: CellChartConfig | null;
}

const DEFAULT_STATE: ResultChartState = {view: 'grid', config: null};

// Module-level so the choice survives the result panel remounting (switching
// editor tabs unmounts it). Keyed by tab id or result entry id; not persisted.
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
        (config: CellChartConfig) => {
            if (key !== null) update(key, {config});
        },
        [key],
    );
    return {...state, setView, setConfig};
}
