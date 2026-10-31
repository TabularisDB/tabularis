import {useCallback, useMemo} from 'react';
import {useTabularisClient} from './useTabularisClient';
import {useDatabase} from './useDatabase';
import type {PluginAccountImportResult, UsePluginAccountReturn} from '@/types/pluginAccount';

/** A provider account can be connected before the user has any saved database connection. */
export function usePluginAccount(pluginId: string): UsePluginAccountReturn {
    const client = useTabularisClient();
    const {loadConnections} = useDatabase();
    const connect = useCallback(
        async (secrets: Record<string, string>) => {
            await client.call('plugin_account', {pluginId, operation: 'connect', secrets});
        },
        [client, pluginId],
    );
    const secretFields = useCallback(
        () => client.call('plugin_account', {pluginId, operation: 'fields'}) as Promise<string[]>,
        [client, pluginId],
    );
    const disconnect = useCallback(async () => {
        await client.call('plugin_account', {pluginId, operation: 'disconnect'});
    }, [client, pluginId]);
    const call = useCallback(
        <T = unknown>(method: string, args: Record<string, unknown> = {}) =>
            client.call('plugin_account', {
                pluginId,
                operation: 'call',
                method,
                args,
            }) as Promise<T>,
        [client, pluginId],
    );
    const importConnection = useCallback(
        async (args: Record<string, unknown>) => {
            const imported = (await client.call('plugin_account', {
                pluginId,
                operation: 'import',
                args,
            })) as PluginAccountImportResult;
            await loadConnections();
            return imported;
        },
        [client, loadConnections, pluginId],
    );
    return useMemo(
        () => ({connect, secretFields, disconnect, call, importConnection}),
        [connect, secretFields, disconnect, call, importConnection],
    );
}
