import { useCallback, useSyncExternalStore } from "react";
import {
  uiStateStore,
  type UiStateKeyDefinition,
  type UiStateStore,
} from "../utils/uiStateStore";

interface UseUiStateOptions {
  debounceMs?: number;
  store?: UiStateStore;
}

/** Reads and writes one shared UI state value (see utils/uiStateStore). */
export function useUiState<T>(
  definition: UiStateKeyDefinition<T>,
  fallback: T,
  { debounceMs, store = uiStateStore }: UseUiStateOptions = {},
): [T, (value: T) => void] {
  const { key } = definition;
  const value = useSyncExternalStore(
    useCallback((listener: () => void) => store.subscribe(listener), [store]),
    () => store.get(key, fallback),
  );
  const setValue = useCallback(
    (next: T) => store.set(key, next, { debounceMs }),
    [store, key, debounceMs],
  );
  return [value, setValue];
}

/** True once the backend values were loaded (or the load failed). */
export function useUiStateReady(store: UiStateStore = uiStateStore): boolean {
  return useSyncExternalStore(
    useCallback((listener: () => void) => store.subscribe(listener), [store]),
    () => store.isReady(),
  );
}
