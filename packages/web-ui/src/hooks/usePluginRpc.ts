import {useCallback, useMemo} from 'react';
import {useTabularisClient} from './useTabularisClient';
import {usePluginConnection} from './usePluginApi';
import type {UsePluginRpcReturn} from '@/types/pluginRpc';

export function usePluginRpc(pluginId: string, connectionId?: string): UsePluginRpcReturn {
    const client = useTabularisClient();
    const active = usePluginConnection();
    const target = connectionId ?? active.connectionId;
    const scope = useCallback(() => {
        if (!target) throw new Error('Select a connection before using plugin services');
        return {pluginId, connectionId: target};
    }, [pluginId, target]);
    const call = useCallback(
        <T = unknown>(method: string, args: Record<string, unknown> = {}) =>
            client.call('call_plugin_extension', {...scope(), method, args}) as Promise<T>,
        [client, scope],
    );
    const saveSecrets = useCallback(
        (secrets: Record<string, string>) =>
            client.call('set_plugin_secrets', {...scope(), secrets}),
        [client, scope],
    );
    const secretFields = useCallback(
        () => client.call('get_plugin_secret_fields', scope()),
        [client, scope],
    );
    const deleteSecrets = useCallback(
        () => client.call('delete_plugin_secrets', scope()),
        [client, scope],
    );
    return useMemo(
        () => ({call, saveSecrets, secretFields, deleteSecrets}),
        [call, saveSecrets, secretFields, deleteSecrets],
    );
}
