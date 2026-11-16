import {useCallback, useState, useSyncExternalStore} from 'react';
import {UI_STATE_KEYS, uiStateStore, type UiStateStore} from '@/utils/uiStateStore';
import {readExpanded, sanitizeExplorerExpansion, withExpanded} from '@/utils/explorerExpansion';

const STORE_KEY = UI_STATE_KEYS.explorerExpanded.key;

interface UseExplorerExpandedOptions {
    /** Starts revealed (see `reveal`), e.g. when the node is the active one on mount. */
    revealed?: boolean;
    store?: UiStateStore;
}

export interface ExplorerExpandedState {
    isExpanded: boolean;
    /** User toggle: saved, so the node opens the same way after a restart. */
    setExpanded: (expanded: boolean) => void;
    /**
     * Opens the node for this session only, e.g. to reveal the active table. Safe
     * to call during render: it only sets React state.
     */
    reveal: () => void;
}

/**
 * Expanded state of one explorer tree node, saved in the shared UI state.
 * `key` comes from `expansionKey`; without a key the state is not saved.
 *
 * Each node subscribes to its own entry only, so toggling one table does not
 * re-render every other item of a large tree.
 */
export function useExplorerExpanded(
    key: string | null,
    defaultExpanded: boolean,
    {revealed: initiallyRevealed = false, store = uiStateStore}: UseExplorerExpandedOptions = {},
): ExplorerExpandedState {
    // Reads only this node's entry: the store notifies on every UI state change
    // (e.g. each step of a sidebar resize), so this runs for every mounted item.
    const saved = useSyncExternalStore(
        useCallback((listener: () => void) => store.subscribe(listener), [store]),
        () =>
            key === null ? undefined : readExpanded(store.get<unknown>(STORE_KEY, undefined), key),
    );
    const [local, setLocal] = useState(defaultExpanded || initiallyRevealed);
    const [revealed, setRevealed] = useState(initiallyRevealed);

    const isExpanded = revealed ? local : (saved ?? local);

    const setExpanded = useCallback(
        (expanded: boolean) => {
            setRevealed(false);
            setLocal(expanded);
            if (key === null) return;
            const current = sanitizeExplorerExpansion(store.get<unknown>(STORE_KEY, undefined));
            store.set(STORE_KEY, withExpanded(current, key, expanded, defaultExpanded));
        },
        [key, defaultExpanded, store],
    );

    const reveal = useCallback(() => {
        setRevealed(true);
        setLocal(true);
    }, []);

    return {isExpanded, setExpanded, reveal};
}
