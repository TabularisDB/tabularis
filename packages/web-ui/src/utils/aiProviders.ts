import type {AiAssistantManifest} from '@/types/ai';
import type {RegistryPluginWithStatus} from '@/types/plugins';
import {versionGte} from './plugins';

/** Keep installed providers visible when the registry is offline. */
export function mergeLocalAiProviders(
    remote: RegistryPluginWithStatus[],
    installed: AiAssistantManifest[],
): RegistryPluginWithStatus[] {
    const known = new Set(
        remote.filter((plugin) => plugin.kind === 'ai-assistant').map((plugin) => plugin.id),
    );
    const local = new Map(installed.map((provider) => [provider.id, provider]));
    return [
        ...remote.map((plugin) => {
            if (plugin.kind !== 'ai-assistant') return plugin;
            const provider = local.get(plugin.id);
            return {
                ...plugin,
                installed_version: provider?.version ?? null,
                update_available:
                    !!provider && !versionGte(provider.version, plugin.latest_version),
            };
        }),
        ...installed
            .filter((plugin) => !known.has(plugin.id))
            .map((plugin) => ({
                id: plugin.id,
                name: plugin.name,
                description: plugin.description,
                kind: 'ai-assistant',
                author: '',
                homepage: '',
                latest_version: plugin.version,
                installed_version: plugin.version,
                update_available: false,
                platform_supported: true,
                releases: [],
            })),
    ];
}
