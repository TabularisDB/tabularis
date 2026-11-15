import {renderHook} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {usePluginRpc} from '@/hooks/usePluginRpc';

const {connection, call} = vi.hoisted(() => ({
    connection: {connectionId: 'conn-neon' as string | null},
    call: vi.fn(),
}));
vi.mock('@/hooks/usePluginApi', () => ({usePluginConnection: () => connection}));
vi.mock('@/hooks/useTabularisClient', () => {
    const client = {call};
    return {useTabularisClient: () => client};
});

describe('usePluginRpc', () => {
    beforeEach(() => {
        call.mockReset();
        connection.connectionId = 'conn-neon';
    });

    it('uses the typed transport and keeps callbacks stable while the connection is unchanged', async () => {
        call.mockResolvedValue({ready: true});
        const {result, rerender} = renderHook(() => usePluginRpc('neon'));
        const initial = result.current;
        rerender();
        expect(result.current).toBe(initial);
        await expect(result.current.call('neon_status', {include: 'storage'})).resolves.toEqual({
            ready: true,
        });
        expect(call).toHaveBeenCalledWith('call_plugin_extension', {
            pluginId: 'neon',
            connectionId: 'conn-neon',
            method: 'neon_status',
            args: {include: 'storage'},
        });
        connection.connectionId = 'next';
        rerender();
        await result.current.call('neon_status');
        expect(call).toHaveBeenLastCalledWith('call_plugin_extension', {
            pluginId: 'neon',
            connectionId: 'next',
            method: 'neon_status',
            args: {},
        });
    });

    it('stores secrets and exposes only field names for an explicit connection', async () => {
        const {result} = renderHook(() => usePluginRpc('neon', 'explicit'));
        await result.current.saveSecrets({TOKEN: 'private'});
        expect(call).toHaveBeenLastCalledWith('set_plugin_secrets', {
            pluginId: 'neon',
            connectionId: 'explicit',
            secrets: {TOKEN: 'private'},
        });
        call.mockResolvedValue(['TOKEN']);
        await expect(result.current.secretFields()).resolves.toEqual(['TOKEN']);
        expect(call).toHaveBeenLastCalledWith('get_plugin_secret_fields', {
            pluginId: 'neon',
            connectionId: 'explicit',
        });
        await result.current.deleteSecrets();
        expect(call).toHaveBeenLastCalledWith('delete_plugin_secrets', {
            pluginId: 'neon',
            connectionId: 'explicit',
        });
        expect(result.current).not.toHaveProperty('getSecrets');
    });

    it('rejects missing connection before invoking a transport', () => {
        connection.connectionId = null;
        const {result} = renderHook(() => usePluginRpc('neon'));
        expect(() => result.current.call('neon_status')).toThrow('Select a connection');
        expect(() => result.current.secretFields()).toThrow('Select a connection');
        expect(call).not.toHaveBeenCalled();
    });
});
