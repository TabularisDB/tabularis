import {useState} from 'react';
import {
    PluginExplorerSection,
    usePluginAccount,
    usePluginConnection,
    usePluginModal,
    usePluginTranslation,
    usePluginWorkspace,
    type SlotComponentProps,
} from '@tabularis/plugin-api';
import {styles} from './styles';
import {NeonMark} from './NeonMark';
import {serviceIds, serviceIcons} from './services';
import {AccountWizard} from './AccountWizard';
import {ConnectionSetup} from './ConnectionSetup';

export default function NeonActions({context}: SlotComponentProps) {
    const t = usePluginTranslation('neon');
    if (context.targetPluginId && context.targetPluginId !== 'neon') return null;
    if (!context.targetPluginId && context.driver !== 'neon') return null;
    if (
        typeof context.isEditing === 'boolean' &&
        typeof context.onConnectionCreated === 'function' &&
        typeof context.onClose === 'function'
    ) {
        return (
            <ConnectionSetup
                connectionId={
                    typeof context.connectionId === 'string' ? context.connectionId : null
                }
                isEditing={context.isEditing}
                onConnectionCreated={context.onConnectionCreated as () => void | Promise<void>}
                onClose={context.onClose as () => void}
            />
        );
    }
    if (typeof usePluginWorkspace !== 'function' || typeof PluginExplorerSection !== 'function')
        return <p role="status">{t('coreRequired')}</p>;
    return context.targetPluginId ? (
        <NeonSettingsAction />
    ) : (
        <PluginExplorerSection
            pluginId="neon"
            providerName="Neon"
            connectionId={
                typeof context.connectionId === 'string' ? context.connectionId : undefined
            }
            icon={<NeonMark size={14} />}
            items={serviceIds.map((id) => ({
                id: id === 'overview' ? 'services' : id,
                label: t(`tabs.${id}`),
                icon: serviceIcons[id],
            }))}
        />
    );
}

function NeonConnectAction({onConnected}: {onConnected?: () => void | Promise<void>}) {
    const t = usePluginTranslation('neon');
    const {openModal, closeModal} = usePluginModal();
    if (typeof usePluginAccount !== 'function') return <p role="status">{t('coreRequired')}</p>;
    return (
        <>
            <style>{styles}</style>
            <button
                type="button"
                className="neon-connect-action"
                onClick={() =>
                    openModal({
                        title: t('account.title'),
                        size: 'md',
                        content: <AccountWizard onConnected={onConnected} onClose={closeModal} />,
                    })
                }
            >
                <NeonMark size={16} />
                {t('account.connectNeon')}
            </button>
        </>
    );
}

function NeonSettingsAction() {
    const t = usePluginTranslation('neon');
    const active = usePluginConnection();
    const {openWorkspace} = usePluginWorkspace('neon');
    const [error, setError] = useState<string>();
    const connectionId = active.driver === 'neon' ? active.connectionId : null;
    return (
        <>
            <style>{styles}</style>
            <NeonConnectAction />
            {connectionId && (
                <button
                    type="button"
                    className="neon-settings-action"
                    onClick={() => {
                        try {
                            openWorkspace({
                                id: 'services',
                                title: `Neon · ${t('tabs.overview')}`,
                                connectionId,
                            });
                            setError(undefined);
                        } catch (cause) {
                            setError(cause instanceof Error ? cause.message : t('requestFailed'));
                        }
                    }}
                >
                    <NeonMark size={16} />
                    {t('manage')}
                </button>
            )}
            {error && (
                <p className="neon-error" role="alert">
                    {error}
                </p>
            )}
        </>
    );
}
