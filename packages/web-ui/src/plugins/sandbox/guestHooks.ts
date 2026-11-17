import {useCallback, useMemo} from 'react';

const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};

/** Stable hook callbacks read fresh host snapshots without restarting consumer effects. */
export function createGuestSettingsApi(
    pluginId: string,
    context: () => Record<string, unknown>,
    update: (value: Record<string, unknown>) => void,
    call: (method: string, ...args: unknown[]) => Promise<unknown>,
) {
    function usePluginSetting(requested: string) {
        if (requested !== pluginId) throw new Error('Plugins may only access their own settings');
        const getSetting = useCallback(<T>(key: string, defaultValue?: T): T => {
            const settings = record(context().pluginSettings);
            return (Object.hasOwn(settings, key) ? settings[key] : defaultValue) as T;
        }, []);
        const setSetting = useCallback(async (key: string, value: unknown): Promise<void> => {
            await call('api.setting.set', key, value);
            const current = context();
            update({...current, pluginSettings: {...record(current.pluginSettings), [key]: value}});
        }, []);
        const setSettings = useCallback(
            async (updates: Record<string, unknown>): Promise<void> => {
                for (const [key, value] of Object.entries(updates)) await setSetting(key, value);
                if (pluginId === 'google-sheets' && Object.hasOwn(updates, 'access_token'))
                    await call('api.oauth.googleSync');
            },
            [setSetting],
        );
        return useMemo(
            () => ({getSetting, setSetting, setSettings}),
            [getSetting, setSetting, setSettings],
        );
    }
    function usePluginTranslation(requested: string) {
        if (requested !== pluginId)
            throw new Error('Plugins may only access their own translations');
        return useCallback((key: string, options?: Record<string, unknown>): string => {
            let value: unknown = record(context().translations);
            for (const part of key.split('.')) value = record(value)[part];
            const {defaultValue, ...interpolations} = options ?? {};
            let translated =
                typeof value === 'string'
                    ? value
                    : typeof defaultValue === 'string'
                      ? defaultValue
                      : key;
            for (const [name, replacement] of Object.entries(interpolations))
                translated = translated.replaceAll(`{{${name}}}`, String(replacement));
            return translated;
        }, []);
    }
    return {usePluginSetting, usePluginTranslation};
}
