import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Download, Loader2, RefreshCw, Trash2} from 'lucide-react';
import {PluginRemoveModal} from '@/components/modals/PluginRemoveModal';
import {AiProviderIcon} from '@/components/icons/AiProviderIcon';
import type {AiAssistantManifest} from '@/types/ai';
import type {RegistryPluginWithStatus} from '@/types/plugins';
import {usePluginRegistry} from '@/hooks/usePluginRegistry';
import {useTabularisClient} from '@/hooks/useTabularisClient';
import {PLUGIN_INSTALL_DEADLINE_MS} from '@/api/pluginLifecycle';
import {getPluginVersionState} from '@/utils/pluginVersions';
import {mergeLocalAiProviders} from '@/utils/aiProviders';
import {toErrorMessage} from '@/utils/errors';
import {APP_VERSION} from '@/version';
import {SettingSection} from './SettingControls';

interface Props {
    installedProviders: AiAssistantManifest[];
    onInstalled: (id: string) => Promise<void>;
    onRemoved: (id: string) => Promise<void>;
}

/** Uses the same registry and installer as the Plugin Center. */
export function AiProviderCatalog({installedProviders, onInstalled, onRemoved}: Props) {
    const {t} = useTranslation();
    const client = useTabularisClient();
    const registry = usePluginRegistry();
    const [operation, setOperation] = useState<{id: string; kind: 'install' | 'remove'} | null>(
        null,
    );
    const [removalTarget, setRemovalTarget] = useState<RegistryPluginWithStatus | null>(null);
    const [failure, setFailure] = useState<string | null>(null);
    const available = mergeLocalAiProviders(registry.plugins, installedProviders).filter(
        (plugin) => plugin.kind === 'ai-assistant',
    );
    const install = async (id: string, version: string) => {
        setOperation({id, kind: 'install'});
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
            setOperation(null);
        }
    };
    const remove = async () => {
        if (!removalTarget || operation) return;
        setOperation({id: removalTarget.id, kind: 'remove'});
        setFailure(null);
        try {
            await client.call('uninstall_plugin', {pluginId: removalTarget.id});
            await onRemoved(removalTarget.id);
            setRemovalTarget(null);
            registry.refresh();
        } catch (error) {
            setFailure(toErrorMessage(error));
        } finally {
            setOperation(null);
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
            {failure && !removalTarget && (
                <p role="alert" className="pt-3 text-sm text-accent-error">
                    {failure}
                </p>
            )}
            {operation && (
                <p role="status" className="pt-3 text-sm text-muted">
                    {t(
                        operation.kind === 'install'
                            ? 'settings.ai.installingProvider'
                            : 'settings.ai.removingProvider',
                    )}
                </p>
            )}
            {!registry.loading && !registry.error && available.length === 0 && (
                <p className="pt-3 text-sm text-muted">{t('settings.ai.noExternalProviders')}</p>
            )}
            <div className="grid grid-cols-1 @min-[560px]:grid-cols-2 gap-3 pt-3">
                {available.map((provider) => {
                    const installed = !!provider.installed_version;
                    const version = getPluginVersionState(provider, undefined, APP_VERSION);
                    const compatible = version.platformSupported && version.isCompatible;
                    return (
                        <div
                            key={provider.id}
                            className="rounded-xl border border-default bg-elevated p-4"
                        >
                            <h4 className="flex items-center gap-2 text-sm font-medium text-primary">
                                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-default bg-base">
                                    <AiProviderIcon src={provider.icon} size={26} />
                                </span>
                                {provider.name}
                            </h4>
                            <p className="mt-1 text-xs text-muted">{provider.description}</p>
                            {installed && (
                                <p className="mt-2 text-xs text-accent-success">
                                    {t('settings.plugins.installed')}
                                </p>
                            )}
                            {!installed && !compatible && (
                                <p className="mt-2 text-xs text-muted">
                                    {t('settings.ai.providerRequiresUpdate')}
                                </p>
                            )}
                            <button
                                type="button"
                                disabled={operation !== null || (!installed && !compatible)}
                                onClick={() => {
                                    if (installed) {
                                        setFailure(null);
                                        setRemovalTarget(provider);
                                    } else {
                                        void install(provider.id, version.selectedVersion);
                                    }
                                }}
                                aria-label={t(
                                    installed
                                        ? 'settings.ai.removeProvider'
                                        : 'settings.ai.installAndUseProvider',
                                    {provider: provider.name},
                                )}
                                className={`mt-3 inline-flex items-center gap-2 rounded-lg border border-default px-3 py-2 text-sm ${installed ? 'text-accent-error' : 'text-accent'} hover:bg-surface-secondary disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus`}
                            >
                                {operation?.id === provider.id ? (
                                    <Loader2 size={14} className="animate-spin" />
                                ) : installed ? (
                                    <Trash2 size={14} />
                                ) : (
                                    <Download size={14} />
                                )}
                                {t(
                                    installed
                                        ? 'settings.plugins.remove'
                                        : 'settings.ai.installAndUse',
                                )}
                            </button>
                        </div>
                    );
                })}
            </div>
            <PluginRemoveModal
                isOpen={removalTarget !== null}
                pluginName={removalTarget?.name ?? ''}
                onClose={() => setRemovalTarget(null)}
                onConfirm={() => void remove()}
                busy={operation?.kind === 'remove'}
            >
                {failure && (
                    <p role="alert" className="text-sm text-accent-error">
                        {failure}
                    </p>
                )}
            </PluginRemoveModal>
        </SettingSection>
    );
}
