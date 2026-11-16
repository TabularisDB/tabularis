import {useRef} from 'react';
import {useTranslation} from 'react-i18next';
import {Network} from 'lucide-react';
import {useSettings} from '@/hooks/useSettings';
import {useConnectionCatalogue} from '@/hooks/useConnectionCatalogue';
import {usePluginRegistry} from '@/hooks/usePluginRegistry';
import {SettingButtonGroup, SettingRow, SettingSection} from './SettingControls';
import {ProxyFields} from './ProxyFields';
import {
    DEFAULT_GLOBAL_PROXY,
    DEFAULT_PROXY_ENDPOINT,
    DEFAULT_PROXY_MODES,
    PROXY_KEYCHAIN_GLOBAL,
    PROXY_SCOPES,
    type HttpProxyMode,
    type ProxyEndpoint,
    type TcpProxyMode,
} from '@/types/proxy';

export function NetworkTab() {
    const {t} = useTranslation();
    const {settings, updateSetting} = useSettings();
    const {refresh: refreshCatalogue} = useConnectionCatalogue(false);
    const {refresh: refreshRegistry} = usePluginRegistry();
    const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const endpoint = {...DEFAULT_PROXY_ENDPOINT, ...settings.proxy?.endpoint};
    const modes = settings.proxy?.modes ?? DEFAULT_PROXY_MODES;
    const {app_http: appHttpMode, ai: aiMode, database: databaseMode, ssh_tunnel: sshMode} = modes;
    const customSelected =
        appHttpMode === 'custom' ||
        aiMode === 'custom' ||
        databaseMode === 'custom' ||
        sshMode === 'custom';

    const refreshAppCatalogues = () => {
        if (refreshTimer.current) clearTimeout(refreshTimer.current);
        refreshTimer.current = null;
        refreshRegistry();
        refreshCatalogue();
    };

    const setEndpoint = (next: ProxyEndpoint) => {
        void updateSetting('proxy', (current) => ({
            ...DEFAULT_GLOBAL_PROXY,
            ...current,
            endpoint: next,
        })).then(() => {
            if (appHttpMode === 'custom' && next.host.trim() && next.port > 0) {
                if (refreshTimer.current) clearTimeout(refreshTimer.current);
                refreshTimer.current = setTimeout(refreshAppCatalogues, 500);
            }
        });
    };

    const setHttpMode = (scope: 'app_http' | 'ai', mode: HttpProxyMode) => {
        void updateSetting('proxy', (current) => ({
            endpoint: current?.endpoint,
            modes: {...DEFAULT_PROXY_MODES, ...current?.modes, [scope]: mode},
        })).then(() => {
            if (
                scope === 'app_http' &&
                (mode !== 'custom' || (endpoint.host.trim() && endpoint.port > 0))
            ) {
                refreshAppCatalogues();
            }
        });
    };

    const setTcpMode = (scope: 'database' | 'ssh_tunnel', mode: TcpProxyMode) => {
        void updateSetting('proxy', (current) => ({
            endpoint: current?.endpoint,
            modes: {...DEFAULT_PROXY_MODES, ...current?.modes, [scope]: mode},
        }));
    };

    return (
        <div>
            <SettingSection
                title={t('settings.network.applyTo')}
                icon={<Network size={14} className="text-muted" />}
                description={t('settings.network.applyToDesc')}
            >
                {PROXY_SCOPES.map((scope) => (
                    <SettingRow
                        key={scope.id}
                        label={t(scope.labelKey)}
                        description={t(scope.descriptionKey)}
                    >
                        <div role="group" aria-label={t(scope.labelKey)}>
                            {scope.id === 'app_http' || scope.id === 'ai' ? (
                                <SettingButtonGroup<HttpProxyMode>
                                    value={scope.id === 'app_http' ? appHttpMode : aiMode}
                                    onChange={(mode) =>
                                        setHttpMode(
                                            scope.id === 'app_http' ? 'app_http' : 'ai',
                                            mode,
                                        )
                                    }
                                    options={[
                                        {value: 'system', label: t('settings.network.modeSystem')},
                                        {value: 'custom', label: t('settings.network.modeCustom')},
                                        {
                                            value: 'disabled',
                                            label: t('settings.network.modeDisabled'),
                                        },
                                    ]}
                                />
                            ) : (
                                <SettingButtonGroup<TcpProxyMode>
                                    value={scope.id === 'database' ? databaseMode : sshMode}
                                    onChange={(mode) =>
                                        setTcpMode(
                                            scope.id === 'database' ? 'database' : 'ssh_tunnel',
                                            mode,
                                        )
                                    }
                                    options={[
                                        {value: 'custom', label: t('settings.network.modeCustom')},
                                        {
                                            value: 'disabled',
                                            label: t('settings.network.modeDisabled'),
                                        },
                                    ]}
                                />
                            )}
                        </div>
                    </SettingRow>
                ))}
            </SettingSection>

            {customSelected && (
                <SettingSection
                    title={t('settings.network.customTitle')}
                    description={t('settings.network.customDesc')}
                >
                    <ProxyFields
                        endpoint={endpoint}
                        onEndpointChange={setEndpoint}
                        passwordSlot={PROXY_KEYCHAIN_GLOBAL}
                    />
                    {(!endpoint.host.trim() || endpoint.port < 1) && (
                        <p role="alert" className="text-xs text-accent-warning">
                            {t('settings.network.incompleteCustom')}
                        </p>
                    )}
                </SettingSection>
            )}
        </div>
    );
}
