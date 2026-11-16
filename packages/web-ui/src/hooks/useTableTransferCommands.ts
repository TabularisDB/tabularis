import {useCallback, useLayoutEffect, useSyncExternalStore} from 'react';

import {tableTransferCommandStore, type TableTransferCommands} from '@/utils/tableTransferCommands';

/** Offers the sidebar's table transfer commands in the command palette. */
export function useRegisterTableTransferCommands(
    connectionId: string | null,
    commands: TableTransferCommands,
) {
    useLayoutEffect(() => {
        if (!connectionId) return;
        return tableTransferCommandStore.register(connectionId, commands);
    }, [connectionId, commands]);
}

export function useTableTransferCommands(
    connectionId: string | null,
): TableTransferCommands | undefined {
    const getSnapshot = useCallback(
        () => tableTransferCommandStore.get(connectionId),
        [connectionId],
    );
    return useSyncExternalStore(tableTransferCommandStore.subscribe, getSnapshot, getSnapshot);
}
