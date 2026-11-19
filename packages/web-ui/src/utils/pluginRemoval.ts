import type {RegistryPluginWithStatus} from '@/types/plugins';
import {pluginKind, type PluginKind} from './plugins';

/** A theme and a driver may share an id, so a removal is tracked per kind. */
export function removedPluginKey(kind: PluginKind, id: string): string {
    return `${kind}:${id}`;
}

/**
 * Drops the registry's "installed" claim for packages removed in this session.
 *
 * The registry snapshot is a network round trip behind: until the next one
 * lands it still reports a removed package as installed, so lists and counts
 * built on it would keep showing it. Local knowledge still wins afterwards: a
 * driver that is on disk again keeps the registry's word, and themes and AI
 * providers are merged in from their own catalogs.
 */
export function withoutRemovedPlugins(
    registry: RegistryPluginWithStatus[],
    removed: ReadonlySet<string>,
    installedDrivers: ReadonlyArray<{id: string}>,
): RegistryPluginWithStatus[] {
    if (removed.size === 0) return registry;
    return registry.map((plugin) => {
        const kind = pluginKind(plugin);
        if (!plugin.installed_version || !removed.has(removedPluginKey(kind, plugin.id)))
            return plugin;
        if (kind === 'driver' && installedDrivers.some((driver) => driver.id === plugin.id))
            return plugin;
        return {...plugin, installed_version: null, update_available: false};
    });
}
