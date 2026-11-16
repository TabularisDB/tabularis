import {beforeEach, describe, expect, it, vi} from 'vitest';
import {createProviderSandboxHandlers, openProviderWorkspace} from '@/utils/providerSandbox';
import {createInitialTabState} from '@/utils/editor';
import {TabularisClient} from '@/api/client';
import type {SlotContext} from '@/types/pluginSlots';

describe('provider sandbox host authority', () => {
    const call = vi.fn().mockResolvedValue(null);
    const loadConnections = vi.fn().mockResolvedValue(undefined);
    const openConnection = vi.fn().mockResolvedValue(undefined);
    const openWorkspace = vi.fn().mockReturnValue('host-tab');
    let context: SlotContext;
    const client = new TabularisClient({
        call,
        callUnmigrated: vi.fn(),
        subscribe: vi.fn(),
        emit: vi.fn(),
    });
    const handlers = createProviderSandboxHandlers('provider', () => ({
        client,
        context,
        loadConnections,
        openConnection,
        openWorkspace,
        connections: [
            {id: 'own', name: 'Own', params: {driver: 'provider', database: 'db'}},
            {id: 'foreign', name: 'Foreign', params: {driver: 'other', database: 'db'}},
        ],
    }));
    beforeEach(() => {
        vi.clearAllMocks();
        call.mockResolvedValue(null);
        context = {connectionId: 'own', driver: 'provider'};
    });
    it('pins connection RPC and write-only secret storage to the frame owner', async () => {
        await handlers['provider.connection']('call', 'own', 'service_read', {limit: 1});
        expect(call).toHaveBeenLastCalledWith(
            'call_plugin_extension',
            {pluginId: 'provider', connectionId: 'own', method: 'service_read', args: {limit: 1}},
            undefined,
        );
        await handlers['provider.connection']('saveSecrets', 'own', {token: 'synthetic-secret'});
        expect(call).toHaveBeenLastCalledWith(
            'set_plugin_secrets',
            {pluginId: 'provider', connectionId: 'own', secrets: {token: 'synthetic-secret'}},
            undefined,
        );
        await handlers['provider.connection']('secretFields', 'own');
        expect(call).toHaveBeenLastCalledWith(
            'get_plugin_secret_fields',
            {pluginId: 'provider', connectionId: 'own'},
            undefined,
        );
    });
    it('rejects another connection and stale or missing provider scopes before invoking the backend', async () => {
        await expect(handlers['provider.connection']('call', 'foreign', 'read')).rejects.toThrow(
            'plugin frame',
        );
        context = {connectionId: 'own', driver: 'other'};
        await expect(handlers['provider.connection']('call', 'own', 'read')).rejects.toThrow(
            'plugin frame',
        );
        context = {};
        await expect(handlers['provider.connection']('call', undefined, 'read')).rejects.toThrow(
            'frame connection',
        );
        expect(call).not.toHaveBeenCalled();
    });
    it('cannot invoke arbitrary backend commands or unknown provider operations', async () => {
        await expect(handlers['provider.account']('get_config')).rejects.toThrow('Unsupported');
        await expect(handlers['provider.connection']('get_config', 'own')).rejects.toThrow(
            'Unsupported',
        );
        await expect(handlers['provider.account']('prepare', '../invoke')).rejects.toThrow(
            'Invalid provider method',
        );
        await expect(handlers['provider.account']('connect', {token: 5})).rejects.toThrow(
            'Invalid provider secret',
        );
        expect(call).not.toHaveBeenCalled();
    });
    it('retains backend administrator failures unchanged', async () => {
        const forbidden = Object.assign(new Error('Administrator access required'), {
            code: 'FORBIDDEN',
        });
        call.mockRejectedValue(forbidden);
        await expect(
            handlers['provider.account']('connect', {token: 'synthetic-secret'}),
        ).rejects.toBe(forbidden);
        expect(call).toHaveBeenCalledWith(
            'plugin_account',
            {pluginId: 'provider', operation: 'connect', secrets: {token: 'synthetic-secret'}},
            undefined,
        );
    });
    it('refreshes saved metadata after importing and allows only own account connections', async () => {
        const imported = {id: 'new', name: 'Imported', warnings: []};
        call.mockResolvedValue(imported);
        await expect(handlers['provider.account']('import', {project: 'test'})).resolves.toBe(
            imported,
        );
        expect(loadConnections).toHaveBeenCalledOnce();
        await handlers['provider.accountConnection']('own', 'branches');
        await expect(handlers['provider.accountConnection']('foreign', 'branches')).rejects.toThrow(
            'another provider',
        );
        await expect(handlers['provider.openConnection']('foreign')).rejects.toThrow(
            'another provider',
        );
        expect(openConnection).not.toHaveBeenCalled();
    });
    it('opens workspaces only on the bound connection', async () => {
        expect(await handlers['provider.openWorkspace']({id: 'services', title: 'Services'})).toBe(
            'host-tab',
        );
        expect(openWorkspace).toHaveBeenCalledWith({
            id: 'services',
            title: 'Services',
            connectionId: 'own',
        });
        expect(() =>
            handlers['provider.openWorkspace']({
                id: 'services',
                title: 'Services',
                connectionId: 'foreign',
            }),
        ).toThrow('plugin frame');
    });
    it('reactivates an existing connection-owned workspace without adding a duplicate tab', () => {
        const tab = createInitialTabState('own', {
            id: 'existing',
            type: 'plugin-workspace',
            pluginId: 'provider',
            workspaceId: 'services',
        });
        const editor = {
            tabs: [tab],
            addTab: vi.fn().mockReturnValue('new'),
            setActiveTabId: vi.fn(),
        };
        const options = {id: 'services', title: 'Services', connectionId: 'own'};
        expect(openProviderWorkspace(editor, 'provider', options)).toBe('existing');
        expect(openProviderWorkspace(editor, 'provider', options)).toBe('existing');
        expect(editor.addTab).not.toHaveBeenCalled();
        expect(editor.setActiveTabId).toHaveBeenCalledTimes(2);
        expect(
            openProviderWorkspace(editor, 'provider', {...options, connectionId: 'another'}),
        ).toBe('new');
    });
    it('opens a newly imported provider connection before the React connection list refresh renders', async () => {
        call.mockResolvedValue({
            id: 'new',
            name: 'New',
            params: {driver: 'provider', database: 'db'},
        });
        await handlers['provider.openConnection']('new');
        expect(call).toHaveBeenCalledWith('get_connection_by_id', {id: 'new'}, undefined);
        expect(openConnection).toHaveBeenCalledWith('new', undefined);
        call.mockResolvedValue({id: 'unrelated', params: {driver: 'other'}});
        await expect(handlers['provider.openConnection']('unrelated')).rejects.toThrow(
            'another provider',
        );
    });
});
