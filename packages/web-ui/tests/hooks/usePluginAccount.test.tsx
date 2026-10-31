import {renderHook} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {usePluginAccount} from '@/hooks/usePluginAccount';

const {call, loadConnections} = vi.hoisted(() => ({call: vi.fn(), loadConnections: vi.fn()}));
vi.mock('@/hooks/useDatabase', () => ({useDatabase: () => ({loadConnections})}));
vi.mock('@/hooks/useTabularisClient', () => {
    const client = {call};
    return {useTabularisClient: () => client};
});

describe('usePluginAccount', () => {
    beforeEach(() => {
        call.mockReset();
        loadConnections.mockReset();
    });

    it('refreshes shared connection state after imports from any entry point', async () => {
        const imported = {id: 'saved', name: 'Imported branch', warnings: []};
        call.mockResolvedValue(imported);
        const {result} = renderHook(() => usePluginAccount('neon'));
        await expect(result.current.importConnection({branchId: 'production'})).resolves.toEqual(
            imported,
        );
        expect(loadConnections).toHaveBeenCalledExactlyOnceWith();
    });

    it('works before a database connection exists and scopes every operation to the provider', async () => {
        const {result, rerender} = renderHook(() => usePluginAccount('neon'));
        const initial = result.current;
        rerender();
        expect(result.current).toBe(initial);
        await result.current.connect({NEON_API_KEY: 'private'});
        expect(call).toHaveBeenLastCalledWith('plugin_account', {
            pluginId: 'neon',
            operation: 'connect',
            secrets: {NEON_API_KEY: 'private'},
        });
        call.mockResolvedValue(['NEON_API_KEY']);
        await expect(result.current.secretFields()).resolves.toEqual(['NEON_API_KEY']);
        expect(call).toHaveBeenLastCalledWith('plugin_account', {
            pluginId: 'neon',
            operation: 'fields',
        });
        await result.current.call('account_projects');
        expect(call).toHaveBeenLastCalledWith('plugin_account', {
            pluginId: 'neon',
            operation: 'call',
            method: 'account_projects',
            args: {},
        });
        call.mockResolvedValue({id: 'saved', name: 'Neon production', warnings: []});
        await expect(result.current.importConnection({branchId: 'production'})).resolves.toEqual({
            id: 'saved',
            name: 'Neon production',
            warnings: [],
        });
        expect(call).toHaveBeenLastCalledWith('plugin_account', {
            pluginId: 'neon',
            operation: 'import',
            args: {branchId: 'production'},
        });
        await result.current.disconnect();
        expect(call).toHaveBeenLastCalledWith('plugin_account', {
            pluginId: 'neon',
            operation: 'disconnect',
        });
        expect(result.current).not.toHaveProperty('getSecrets');
    });

    it('does not capture the previous provider when rerendered', async () => {
        const {result, rerender} = renderHook(({id}) => usePluginAccount(id), {
            initialProps: {id: 'neon'},
        });
        rerender({id: 'appwrite'});
        await result.current.call('account_projects', {filter: 'mine'});
        expect(call).toHaveBeenLastCalledWith('plugin_account', {
            pluginId: 'appwrite',
            operation: 'call',
            method: 'account_projects',
            args: {filter: 'mine'},
        });
    });
});
