import {useCallback, useMemo} from 'react';
import {useUiState} from '@/hooks/useUiState';
import {UI_STATE_KEYS, type UiStateStore} from '@/utils/uiStateStore';
import {
    isPinned,
    pinScope,
    pinsInScope,
    sanitizeExplorerPins,
    setPinned,
    type PinnedObject,
} from '@/utils/explorerPins';

const NO_PINS: unknown = {};

/**
 * Pinned tables and views of one connection's explorer. Saved in the shared UI state,
 * so pins survive restarts and show in every window. Scope each call with the same
 * `database` and `schema` the sidebar item passes to its context menu.
 */
export function useExplorerPins(
    connectionId: string | null | undefined,
    {store}: {store?: UiStateStore} = {},
) {
    const [stored, setStored] = useUiState<unknown>(UI_STATE_KEYS.explorerPins, NO_PINS, {store});
    const pins = useMemo(() => sanitizeExplorerPins(stored), [stored]);

    const pinsFor = useCallback(
        (database?: string | null, schema?: string | null): PinnedObject[] =>
            connectionId ? pinsInScope(pins, connectionId, pinScope(database, schema)) : [],
        [pins, connectionId],
    );

    const isObjectPinned = useCallback(
        (object: PinnedObject, database?: string | null, schema?: string | null): boolean =>
            connectionId ? isPinned(pins, connectionId, pinScope(database, schema), object) : false,
        [pins, connectionId],
    );

    const togglePin = useCallback(
        (object: PinnedObject, database?: string | null, schema?: string | null): void => {
            if (!connectionId) return;
            const scope = pinScope(database, schema);
            setStored(
                setPinned(
                    pins,
                    connectionId,
                    scope,
                    object,
                    !isPinned(pins, connectionId, scope, object),
                ),
            );
        },
        [pins, connectionId, setStored],
    );

    return {pinsFor, isPinned: isObjectPinned, togglePin};
}
