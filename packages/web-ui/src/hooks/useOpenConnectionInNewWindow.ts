import {useCallback} from 'react';
import {useDatabase} from './useDatabase';
import {usePlatformCapabilities} from './usePlatformCapabilities';
import {useTabularisClient} from './useTabularisClient';

/**
 * Open a connection in its own dedicated window.
 *
 * If the connection is not open anywhere yet, its connectivity is validated
 * first (`open_saved_connection`); the window is only created once that succeeds, so a
 * failing connection surfaces the error in the originating window instead of in
 * a freshly-spawned empty window. The returned function rejects on failure so
 * callers can present the error.
 *
 * The connection is "owned" by the new window: if it is currently open in the
 * calling window it is detached from that window's UI (its process-global pool
 * stays alive and is reused by the new window, which disconnects it on close).
 */
export function useOpenConnectionInNewWindow() {
    const client = useTabularisClient();
    const platform = usePlatformCapabilities();
    const {detachConnection, isConnectionOpen, isConnectionOpenAnywhere} = useDatabase();

    return useCallback(
        async (connectionId: string, name?: string | null) => {
            // Validate connectivity before spawning the window, unless the connection
            // is already open somewhere (then it's known-good and the window either
            // reuses the warm pool or just gets focused).
            if (!isConnectionOpenAnywhere(connectionId)) {
                await client.call('open_saved_connection', {connectionId});
            }

            await platform.openConnectionRoute({
                connectionId,
                title: name ?? null,
            });

            if (isConnectionOpen(connectionId)) {
                detachConnection(connectionId);
            }
        },
        [client, detachConnection, isConnectionOpen, isConnectionOpenAnywhere, platform],
    );
}
