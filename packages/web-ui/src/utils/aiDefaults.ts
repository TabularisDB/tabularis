import type {TabularisClient} from '@/api/client';
import type {Settings} from '@/contexts/SettingsContext';

/** Optional AI discovery must not hold up settings hydration or reconnection. */
export async function detectAiDefaults(
    client: TabularisClient,
    settings: Settings,
): Promise<Partial<Settings>> {
    if (
        !settings.aiEnabled ||
        settings.aiProvider === 'chatgpt' ||
        (settings.aiProvider && settings.aiModel)
    )
        return {};
    let provider = settings.aiProvider;
    if (!provider) {
        const catalog = await client.call('get_ai_providers', undefined);
        const providers = catalog.providers
            .filter((provider) => provider.ai_assistant.auto_select_priority != null)
            .sort(
                (a, b) =>
                    (a.ai_assistant.auto_select_priority ?? 0) -
                    (b.ai_assistant.auto_select_priority ?? 0),
            )
            .map((provider) => provider.id);
        const available = await Promise.all(
            providers.map((provider) =>
                catalog.providers.find((entry) => entry.id === provider)?.ai_assistant
                    .authentication === 'none'
                    ? Promise.resolve(true)
                    : client.call('check_ai_key', {provider}).catch(() => false),
            ),
        );
        provider = providers.find((_, index) => available[index]) ?? null;
    }
    if (!provider) return {};
    if (settings.aiModel) return {aiProvider: provider};
    const models = await client.call('get_ai_models', {forceRefresh: false});
    return {aiProvider: provider, aiModel: models[provider]?.[0] ?? null};
}
