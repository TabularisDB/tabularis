import {useCallback, useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {PluginRegistryContext} from './PluginRegistryContext';
import {seedConnectionCatalogue} from '@/hooks/useConnectionCatalogue';
import {useSettings} from '@/hooks/useSettings';
import {useTabularisClient} from '@/hooks/useTabularisClient';
import type {RegistryPluginWithStatus} from '@/types/plugins';
import {toErrorMessage} from '@/utils/errors';
import {getPluginUpdates} from '@/utils/pluginUpdates';
import {APP_VERSION} from '@/version';

export function PluginRegistryProvider({children}: {children: ReactNode}) {
    const {settings, isLoading: settingsLoading} = useSettings();
    const client = useTabularisClient();
    const [plugins, setPlugins] = useState<RegistryPluginWithStatus[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const registryUrl = settings.tabulariumRegistryUrl;
    const requestId = useRef(0);
    const newest = useRef<{request: number; settled: Promise<void>} | null>(null);

    const refresh = useCallback((): Promise<void> => {
        const request = ++requestId.current;
        // Defer state changes so this can also run from startup/config effects.
        const settled = Promise.resolve()
            .then(async () => {
                if (request !== requestId.current) return;
                setLoading(true);
                setError(null);
                try {
                    const result = await client.call('fetch_plugin_registry', undefined);
                    if (request === requestId.current) {
                        setPlugins(result);
                        // The connection picker caches the same registry; keep it current
                        // for every install path (Settings, deep link, activation).
                        seedConnectionCatalogue(client, registryUrl, result);
                    }
                } catch (err) {
                    if (request === requestId.current) setError(toErrorMessage(err));
                } finally {
                    if (request === requestId.current) setLoading(false);
                }
            })
            // A newer refresh replaced this one (an install also announces itself with
            // an event): its result is the one readers get, so callers wait for it.
            .then(() =>
                newest.current && newest.current.request !== request
                    ? newest.current.settled
                    : undefined,
            );
        newest.current = {request, settled};
        return settled;
    }, [client, registryUrl]);

    useEffect(() => {
        if (settingsLoading) return;
        void refresh();
        return () => {
            requestId.current += 1;
        };
    }, [refresh, settingsLoading]);

    useEffect(() => {
        let mounted = true;
        const subscriptions = (
            ['tabularis://plugin-installed', 'tabularis://plugin-activated'] as const
        ).map((event) =>
            client.subscribe(event, () => {
                if (mounted) void refresh();
            }),
        );
        for (const subscription of subscriptions) {
            void subscription.catch((err) =>
                console.warn('Failed to subscribe to plugin changes:', err),
            );
        }
        return () => {
            mounted = false;
            for (const subscription of subscriptions) {
                void subscription.then((unlisten) => unlisten()).catch(() => {});
            }
        };
    }, [client, refresh]);

    const updates = useMemo(() => getPluginUpdates(plugins, APP_VERSION), [plugins]);
    const value = useMemo(
        () => ({plugins, updates, loading, error, refresh}),
        [plugins, updates, loading, error, refresh],
    );

    return (
        <PluginRegistryContext.Provider value={value}>{children}</PluginRegistryContext.Provider>
    );
}
