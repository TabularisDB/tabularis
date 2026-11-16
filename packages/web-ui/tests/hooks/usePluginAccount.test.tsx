import {renderHook} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {usePluginAccount} from '@/hooks/usePluginAccount';

const {call, loadConnections, connect, switchConnection, navigate, connections, openIds} =
    vi.hoisted(() => ({
        call: vi.fn(),
        loadConnections: vi.fn(),
        connect: vi.fn(),
        switchConnection: vi.fn(),
        navigate: vi.fn(),
        connections: [
            {id: 'source', name: 'Production', params: {driver: 'neon'}},
            {id: 'other', name: 'Other', params: {driver: 'sqlite'}},
        ],
        openIds: ['source'],
    }));
vi.mock('react-router-dom', () => ({useNavigate: () => navigate}));
vi.mock('@/hooks/useDatabase', () => ({
    useDatabase: () => ({
        loadConnections,
        connect,
        switchConnection,
        connections,
        openConnectionIds: openIds,
    }),
}));
vi.mock('@/hooks/useTabularisClient', () => {
    const client = {call};
    return {useTabularisClient: () => client};
});

describe('usePluginAccount', () => {
    it('prepares authentication before an account exists without adding credentials', async () => {
        const {result} = renderHook(() => usePluginAccount('neon'));
        call.mockResolvedValue({installed: true});
        await expect(result.current.prepare('account_cli_status')).resolves.toEqual({
            installed: true,
        });
        expect(call).toHaveBeenLastCalledWith('plugin_account', {
            pluginId: 'neon',
            operation: 'prepare',
            method: 'account_cli_status',
            args: {},
        });
    });
    beforeEach(() => {
        call.mockReset();
        connect.mockReset();
        switchConnection.mockReset();
        navigate.mockReset();
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

    it('activates only provider-owned connections and reuses an open context', async () => {
        const {result} = renderHook(() => usePluginAccount('neon'));
        expect(result.current.connections).toEqual([{id: 'source', name: 'Production'}]);
        call.mockResolvedValue({id: 'source', params: {driver: 'neon'}});
        await result.current.openConnection('source');
        expect(switchConnection).toHaveBeenCalledWith('source');
        expect(connect).not.toHaveBeenCalled();
        expect(navigate).toHaveBeenCalledWith('/connections/source/editor');
        call.mockResolvedValue({id: 'other', params: {driver: 'sqlite'}});
        await expect(result.current.openConnection('other')).rejects.toThrow('provider');
    });
    it('connects a new branch through the normal lifecycle and scopes metadata calls', async () => {
        const {result} = renderHook(() => usePluginAccount('neon'));
        call.mockResolvedValue({id: 'branch', params: {driver: 'neon'}});
        await result.current.openConnection('branch');
        expect(connect).toHaveBeenCalledWith('branch');
        await result.current.callConnection('source', 'neon_branch_context');
        expect(call).toHaveBeenLastCalledWith('call_plugin_extension', {
            pluginId: 'neon',
            connectionId: 'source',
            method: 'neon_branch_context',
            args: {},
        });
    });

    it('rejects stale branch actions after the selected connection changes', async () => {
        call.mockResolvedValue({id: 'branch', params: {driver: 'neon'}});
        const {result} = renderHook(() => usePluginAccount('neon'));
        await expect(result.current.openConnection('branch', 'no-longer-selected')).rejects.toThrow(
            'no longer active',
        );
        expect(connect).not.toHaveBeenCalled();
        expect(navigate).not.toHaveBeenCalled();
    });
    it('does not navigate when a new connection fails', async () => {
        call.mockResolvedValue({id: 'branch', params: {driver: 'neon'}});
        connect.mockRejectedValueOnce(new Error('Cannot connect'));
        const {result} = renderHook(() => usePluginAccount('neon'));
        await expect(result.current.openConnection('branch')).rejects.toThrow('Cannot connect');
        expect(navigate).not.toHaveBeenCalled();
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
