import { useTranslation } from "react-i18next";
import { Network } from "lucide-react";
import { useSettings } from "../../hooks/useSettings";
import {
  SettingSection,
  SettingRow,
  SettingToggle,
} from "./SettingControls";
import { ProxyFields } from "./ProxyFields";
import {
  DEFAULT_GLOBAL_PROXY,
  DEFAULT_PROXY_ENDPOINT,
  PROXY_KEYCHAIN_GLOBAL,
  PROXY_SCOPES,
  type GlobalProxySettings,
  type ProxyEndpoint,
  type ProxyScopeId,
} from "../../types/proxy";

export function NetworkTab() {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();

  const proxy: GlobalProxySettings = {
    ...DEFAULT_GLOBAL_PROXY,
    ...settings.proxy,
    endpoint: {
      ...DEFAULT_PROXY_ENDPOINT,
      ...settings.proxy?.endpoint,
    },
    scopes: { ...settings.proxy?.scopes },
  };

  const persist = async (next: GlobalProxySettings) => {
    await updateSetting("proxy", next);
  };

  const setEnabled = (enabled: boolean) => {
    void persist({ ...proxy, enabled });
  };

  const setEndpoint = (endpoint: ProxyEndpoint) => {
    void persist({ ...proxy, endpoint });
  };

  const setScope = (id: ProxyScopeId, checked: boolean) => {
    void persist({
      ...proxy,
      scopes: { ...proxy.scopes, [id]: checked },
    });
  };

  return (
    <div>
      <SettingSection
        title={t("settings.network.title")}
        icon={<Network size={14} className="text-muted" />}
        description={t("settings.network.description")}
      >
        <SettingRow
          label={t("settings.network.enabled")}
          description={t("settings.network.enabledDesc")}
        >
          <SettingToggle checked={proxy.enabled} onChange={setEnabled} />
        </SettingRow>

        <ProxyFields
          endpoint={proxy.endpoint ?? DEFAULT_PROXY_ENDPOINT}
          onEndpointChange={setEndpoint}
          passwordSlot={PROXY_KEYCHAIN_GLOBAL}
          disabled={!proxy.enabled}
        />
      </SettingSection>

      <SettingSection
        title={t("settings.network.applyTo")}
        description={t("settings.network.applyToDesc")}
      >
        {PROXY_SCOPES.map((scope) => (
          <SettingRow
            key={scope.id}
            label={t(scope.labelKey)}
            description={t(scope.descriptionKey)}
          >
            <SettingToggle
              checked={!!proxy.scopes[scope.id]}
              disabled={!proxy.enabled}
              onChange={(checked) => setScope(scope.id, checked)}
            />
          </SettingRow>
        ))}
      </SettingSection>
    </div>
  );
}
