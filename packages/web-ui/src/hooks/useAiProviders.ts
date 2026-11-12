import {useCallback, useEffect, useState} from 'react';
import type {AiProviderCatalog} from '@/types/ai';
import {useTabularisClient} from './useTabularisClient';

export function useAiProviders() {
    const client = useTabularisClient();
    const [catalog, setCatalog] = useState<AiProviderCatalog>({
        providers: [],
        pendingMigration: [],
    });
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const refresh = useCallback(async () => {
        try {
            const next = await client.call('get_ai_providers', undefined);
            setCatalog(next);
            setError(null);
        } catch (failure) {
            setError(String(failure));
        } finally {
            setLoading(false);
        }
    }, [client]);
    useEffect(() => {
        let disposed = false;
        const subscriptions: Array<() => void> = [];
        void refresh();
        for (const event of [
            'tabularis://ai-providers-changed',
            'tabularis://plugin-installed',
        ] as const) {
            void client
                .subscribe(event, () => void refresh())
                .then((cleanup) => {
                    if (disposed) cleanup();
                    else subscriptions.push(cleanup);
                })
                .catch((failure: unknown) => setError(String(failure)));
        }
        return () => {
            disposed = true;
            subscriptions.forEach((cleanup) => cleanup());
        };
    }, [client, refresh]);
    const retryMigration = useCallback(async () => {
        setLoading(true);
        try {
            await client.call('migrate_ai_providers', undefined);
        } catch (failure) {
            setError(String(failure));
        } finally {
            await refresh();
        }
    }, [client, refresh]);
    return {...catalog, error, loading, refresh, retryMigration};
}
