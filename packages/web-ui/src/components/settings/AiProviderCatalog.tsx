import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Download, Loader2, RefreshCw} from 'lucide-react';
import {usePluginRegistry} from '@/hooks/usePluginRegistry';
import {useTabularisClient} from '@/hooks/useTabularisClient';
import {PLUGIN_INSTALL_DEADLINE_MS} from '@/api/pluginLifecycle';
import {getPluginVersionState} from '@/utils/pluginVersions';
import {toErrorMessage} from '@/utils/errors';
import {APP_VERSION} from '@/version';
import {SettingSection} from './SettingControls';

interface Props {
    installedIds: string[];
    onInstalled: (id: string) => Promise<void>;
}

/** Uses the same registry and installer as the Plugin Center. */
export function AiProviderCatalog({installedIds, onInstalled}: Props) {
    const {t} = useTranslation();
    const client = useTabularisClient();
    const registry = usePluginRegistry();
    const [installing, setInstalling] = useState<string | null>(null);
    const [failure, setFailure] = useState<string | null>(null);
    const available = registry.plugins.filter(
        (plugin) => plugin.kind === 'ai-assistant' && !installedIds.includes(plugin.id),
    );
    const install = async (id: string, version: string) => {
        setInstalling(id);
        setFailure(null);
        try {
            await client.call(
                'install_plugin',
                {pluginId: id, version},
                {
                    deadlineMs: PLUGIN_INSTALL_DEADLINE_MS,
                },
            );
            await onInstalled(id);
            registry.refresh();
        } catch (error) {
            setFailure(toErrorMessage(error));
        } finally {
            setInstalling(null);
        }
    };
    return (
        <SettingSection
            title={t('settings.ai.availableProviders')}
            description={t('settings.ai.installProviderHelp')}
        >
            {registry.loading && (
                <p role="status" className="pt-3 text-sm text-muted">
                    {t('settings.plugins.loadingRegistry')}
                </p>
            )}
            {registry.error && (
                <div role="status" className="pt-3 text-sm text-muted">
                    <p>{t('settings.ai.providerRegistryOffline')}</p>
                    <button
                        type="button"
                        onClick={registry.refresh}
                        className="mt-2 inline-flex items-center gap-2 text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    >
                        <RefreshCw size={14} />
                        {t('common.retry')}
                    </button>
                </div>
            )}
            {failure && (
                <p role="alert" className="pt-3 text-sm text-accent-error">
                    {failure}
                </p>
            )}
            {installing && (
                <p role="status" className="pt-3 text-sm text-muted">
                    {t('settings.ai.installingProvider')}
                </p>
            )}
            {!registry.loading && !registry.error && available.length === 0 && (
                <p className="pt-3 text-sm text-muted">{t('settings.ai.allProvidersInstalled')}</p>
            )}
            <div className="grid grid-cols-1 @min-[560px]:grid-cols-2 gap-3 pt-3">
                {available.map((provider) => {
                    const version = getPluginVersionState(provider, undefined, APP_VERSION);
                    const compatible = version.platformSupported && version.isCompatible;
                    return (
                        <div
                            key={provider.id}
                            className="rounded-xl border border-default bg-elevated p-4"
                        >
                            <h4 className="flex items-center gap-2 text-sm font-medium text-primary">
                                {provider.icon && (
                                    <img src={provider.icon} alt="" className="h-6 w-6" />
                                )}
                                {provider.name}
                            </h4>
                            <p className="mt-1 text-xs text-muted">{provider.description}</p>
                            {!compatible && (
                                <p className="mt-2 text-xs text-muted">
                                    {t('settings.ai.providerRequiresUpdate')}
                                </p>
                            )}
                            <button
                                type="button"
                                disabled={installing !== null || !compatible}
                                onClick={() => void install(provider.id, version.selectedVersion)}
                                aria-label={t('settings.ai.installAndUseProvider', {
                                    provider: provider.name,
                                })}
                                className="mt-3 inline-flex items-center gap-2 rounded-lg border border-default px-3 py-2 text-sm text-accent hover:bg-surface-secondary disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                            >
                                {installing === provider.id ? (
                                    <Loader2 size={14} className="animate-spin" />
                                ) : (
                                    <Download size={14} />
                                )}
                                {t('settings.ai.installAndUse')}
                            </button>
                        </div>
                    );
                })}
            </div>
        </SettingSection>
    );
}
