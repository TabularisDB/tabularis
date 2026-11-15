import type {TabularisClient} from '@/api/client';
import type {SavedConnection} from '@/contexts/DatabaseContext';
import type {PluginHostHandler} from '@/plugins/sandbox/connectFrame';
import type {SlotContext} from '@/types/pluginSlots';
import type {EditorContextType} from '@/contexts/EditorContext';

interface ProviderServices {
    client: TabularisClient;
    connections: readonly SavedConnection[];
    context: SlotContext;
    loadConnections: () => Promise<void>;
    openConnection: (id: string, sourceId?: string) => Promise<void>;
    openWorkspace: (options: {id: string; title: string; connectionId: string}) => string;
}

export function openProviderWorkspace(
    editor: Pick<EditorContextType, 'tabs' | 'addTab' | 'setActiveTabId'>,
    pluginId: string,
    options: {id: string; title: string; connectionId: string},
): string {
    const existing = editor.tabs.find(
        (tab) =>
            tab.type === 'plugin-workspace' &&
            tab.connectionId === options.connectionId &&
            tab.pluginId === pluginId &&
            tab.workspaceId === options.id,
    );
    const id =
        existing?.id ??
        editor.addTab({
            type: 'plugin-workspace',
            pluginId,
            workspaceId: options.id,
            title: options.title,
            connectionId: options.connectionId,
        });
    if (!id) throw new Error('The workspace connection is not active in this editor');
    editor.setActiveTabId(id);
    return id;
}

export function providerString(value: unknown, label: string, limit = 256): string {
    if (typeof value !== 'string' || !value.trim() || value.length > limit)
        throw new Error(`Invalid ${label}`);
    return value;
}

export function providerRecord(value: unknown, secrets = false): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Provider arguments must be an object');
    const entries = Object.entries(value);
    if (JSON.stringify(value).length > 1_048_576 || entries.length > 256)
        throw new Error('Provider arguments are too large');
    if (
        secrets &&
        entries.some(
            ([key, item]) => !/^[A-Za-z0-9._-]{1,64}$/.test(key) || typeof item !== 'string',
        )
    )
        throw new Error('Invalid provider secret fields');
    return value as Record<string, unknown>;
}

/** Bind every provider operation to this frame's identity, never guest-supplied IDs. */
export function createProviderSandboxHandlers(
    pluginId: string,
    services: () => ProviderServices,
): Record<string, PluginHostHandler> {
    const method = (value: unknown) => {
        const name = providerString(value, 'provider method', 128);
        if (!/^[A-Za-z][A-Za-z0-9._-]*$/.test(name)) throw new Error('Invalid provider method');
        return name;
    };
    const scopedConnection = (requested?: unknown) => {
        const {context} = services();
        const id = providerString(context.connectionId, 'frame connection');
        if (context.driver !== pluginId || (requested !== undefined && requested !== id))
            throw new Error('Connection does not belong to this plugin frame');
        return id;
    };
    const ownedConnection = async (value: unknown) => {
        const id = providerString(value, 'connection');
        const current = services();
        const saved =
            current.connections.find((item) => item.id === id) ??
            (await current.client.call('get_connection_by_id', {id}));
        if (saved.params.driver !== pluginId)
            throw new Error('Connection belongs to another provider');
        return id;
    };
    return {
        'provider.account': async (operation, value, args) => {
            const {client, loadConnections} = services();
            switch (operation) {
                case 'connect':
                    await client.call('plugin_account', {
                        pluginId,
                        operation,
                        secrets: providerRecord(value, true) as Record<string, string>,
                    });
                    return null;
                case 'fields':
                case 'disconnect':
                    return client.call('plugin_account', {pluginId, operation});
                case 'call':
                case 'prepare':
                    return client.call('plugin_account', {
                        pluginId,
                        operation,
                        method: method(value),
                        args: providerRecord(args ?? {}),
                    });
                case 'import': {
                    const imported = await client.call('plugin_account', {
                        pluginId,
                        operation,
                        args: providerRecord(value),
                    });
                    await loadConnections();
                    return imported;
                }
                default:
                    throw new Error('Unsupported provider account operation');
            }
        },
        'provider.connection': async (operation, requested, value, args) => {
            const connectionId = scopedConnection(requested);
            const {client} = services();
            switch (operation) {
                case 'call':
                    return client.call('call_plugin_extension', {
                        pluginId,
                        connectionId,
                        method: method(value),
                        args: providerRecord(args ?? {}),
                    });
                case 'saveSecrets':
                    return client.call('set_plugin_secrets', {
                        pluginId,
                        connectionId,
                        secrets: providerRecord(value, true) as Record<string, string>,
                    });
                case 'secretFields':
                    return client.call('get_plugin_secret_fields', {pluginId, connectionId});
                case 'deleteSecrets':
                    return client.call('delete_plugin_secrets', {pluginId, connectionId});
                default:
                    throw new Error('Unsupported provider connection operation');
            }
        },
        'provider.accountConnection': async (requested, value, args) => {
            const connectionId = await ownedConnection(requested);
            return services().client.call('call_plugin_extension', {
                pluginId,
                connectionId,
                method: method(value),
                args: providerRecord(args ?? {}),
            });
        },
        'provider.openConnection': async (requested, source) => {
            const connectionId = await ownedConnection(requested);
            const sourceId = source === undefined ? undefined : scopedConnection(source);
            await services().openConnection(connectionId, sourceId);
            return null;
        },
        'provider.openWorkspace': (value) => {
            const options = providerRecord(value);
            const connectionId = scopedConnection(options.connectionId);
            return services().openWorkspace({
                id: providerString(options.id, 'workspace ID'),
                title: providerString(options.title, 'workspace title'),
                connectionId,
            });
        },
    };
}
