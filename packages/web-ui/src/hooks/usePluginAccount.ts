import {useNavigate} from 'react-router-dom';
import {buildEditorRoute} from '@/routing';
import {useCallback, useLayoutEffect, useMemo, useRef} from 'react';
import {useTabularisClient} from './useTabularisClient';
import {useDatabase} from './useDatabase';
import type {PluginAccountImportResult, UsePluginAccountReturn} from '@/types/pluginAccount';

/** A provider account can be connected before the user has any saved database connection. */
export function usePluginAccount(pluginId: string): UsePluginAccountReturn {
    const client = useTabularisClient();
    const database = useDatabase();
    const databaseRef = useRef(database);
    useLayoutEffect(() => {
        databaseRef.current = database;
    }, [database]);
    const {loadConnections, connections: savedConnections} = database;
    const navigate = useNavigate();
    const connections = useMemo(
        () =>
            (savedConnections ?? [])
                .filter((connection) => connection.params.driver === pluginId)
                .map(({id, name}) => ({id, name})),
        [savedConnections, pluginId],
    );
    const openConnection = useCallback(
        async (connectionId: string, sourceConnectionId?: string) => {
            const saved = await client.call('get_connection_by_id', {id: connectionId});
            if (saved.params.driver !== pluginId)
                throw new Error('Connection belongs to another provider');
            const current = databaseRef.current;
            if (sourceConnectionId && current.activeConnectionId !== sourceConnectionId)
                throw new Error('The source connection is no longer active');
            if (current.openConnectionIds?.includes(connectionId))
                current.switchConnection(connectionId);
            else await current.connect(connectionId);
            navigate(buildEditorRoute(connectionId));
        },
        [client, pluginId, navigate],
    );
    const callConnection = useCallback(
        <T = unknown>(connectionId: string, method: string, args: Record<string, unknown> = {}) =>
            client.call('call_plugin_extension', {
                pluginId,
                connectionId,
                method,
                args,
            }) as Promise<T>,
        [client, pluginId],
    );
    const prepare = useCallback(
        <T = unknown>(method: string, args: Record<string, unknown> = {}) =>
            client.call('plugin_account', {
                pluginId,
                operation: 'prepare',
                method,
                args,
            }) as Promise<T>,
        [client, pluginId],
    );
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
        () => ({
            connections,
            openConnection,
            callConnection,
            prepare,
            connect,
            secretFields,
            disconnect,
            call,
            importConnection,
        }),
        [
            connections,
            openConnection,
            callConnection,
            prepare,
            connect,
            secretFields,
            disconnect,
            call,
            importConnection,
        ],
    );
}
