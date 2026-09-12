import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Save } from "lucide-react";
import { PasswordInput } from "../ui/PasswordInput";
import { useAlert } from "../../hooks/useAlert";
import {
  SettingButtonGroup,
  SettingRow,
} from "./SettingControls";
import {
  DEFAULT_PROXY_ENDPOINT,
  clampProxyPort,
  type ProxyEndpoint,
  type ProxyMode,
  type ProxyOverride,
  type ProxyProtocol,
} from "../../types/proxy";

const textInputClass =
  "w-full max-w-xs px-3 py-2 bg-base border border-strong rounded-lg text-sm text-primary placeholder:text-muted focus:border-blue-500 focus:outline-none transition-colors";

export interface ProxyFieldsProps {
  /** When set, shows inherit/custom/disabled mode selector (overrides). */
  showMode?: boolean;
  mode?: ProxyMode;
  onModeChange?: (mode: ProxyMode) => void;
  endpoint: ProxyEndpoint;
  onEndpointChange: (endpoint: ProxyEndpoint) => void;
  /** Keychain slot for the password (`proxy:global`, `proxy:ai:…`, …). */
  passwordSlot: string | null;
  disabled?: boolean;
}

export function ProxyFields({
  showMode,
  mode = "custom",
  onModeChange,
  endpoint,
  onEndpointChange,
  passwordSlot,
  disabled,
}: ProxyFieldsProps) {
  const { t } = useTranslation();
  const { showAlert } = useAlert();
  const [password, setPassword] = useState("");
  const [passwordSet, setPasswordSet] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const showEndpoint = !showMode || mode === "custom";

  const refreshPasswordStatus = useCallback(async () => {
    if (!passwordSlot) {
      setPasswordSet(false);
      return;
    }
    try {
      const set = await invoke<boolean>("proxy_password_is_set", {
        slot: passwordSlot,
      });
      setPasswordSet(set);
    } catch {
      setPasswordSet(false);
    }
  }, [passwordSlot]);

  useEffect(() => {
    void refreshPasswordStatus();
  }, [refreshPasswordStatus]);

  const patch = (partial: Partial<ProxyEndpoint>) => {
    onEndpointChange({ ...endpoint, ...partial });
  };

  const handleSavePassword = async () => {
    if (!passwordSlot || !password) return;
    setSavingPassword(true);
    try {
      await invoke("set_proxy_password", {
        slot: passwordSlot,
        password,
      });
      setPassword("");
      await refreshPasswordStatus();
    } catch (e) {
      showAlert(String(e), { title: t("common.error"), kind: "error" });
    } finally {
      setSavingPassword(false);
    }
  };

  const handleClearPassword = async () => {
    if (!passwordSlot) return;
    setSavingPassword(true);
    try {
      await invoke("delete_proxy_password", { slot: passwordSlot });
      setPassword("");
      await refreshPasswordStatus();
    } catch (e) {
      showAlert(String(e), { title: t("common.error"), kind: "error" });
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="space-y-1">
      {showMode && onModeChange && (
        <SettingRow
          label={t("settings.network.overrideMode")}
          description={t("settings.network.overrideModeDesc")}
        >
          <SettingButtonGroup<ProxyMode>
            value={mode}
            onChange={onModeChange}
            options={[
              {
                value: "inherit",
                label: t("settings.network.modeInherit"),
              },
              {
                value: "custom",
                label: t("settings.network.modeCustom"),
              },
              {
                value: "disabled",
                label: t("settings.network.modeDisabled"),
              },
            ]}
          />
        </SettingRow>
      )}

      {showEndpoint && (
        <>
          <SettingRow
            label={t("settings.network.protocol")}
            description={t("settings.network.protocolDesc")}
          >
            <SettingButtonGroup<ProxyProtocol>
              value={endpoint.protocol || "http"}
              onChange={(protocol) => patch({ protocol })}
              options={[
                { value: "http", label: "HTTP" },
                { value: "socks5", label: "SOCKS5" },
              ]}
            />
          </SettingRow>

          <SettingRow
            label={t("settings.network.host")}
            description={t("settings.network.hostDesc")}
            vertical
          >
            <input
              type="text"
              className={textInputClass}
              value={endpoint.host}
              disabled={disabled}
              placeholder="127.0.0.1"
              onChange={(e) => patch({ host: e.target.value })}
            />
          </SettingRow>

          <SettingRow
            label={t("settings.network.port")}
            description={t("settings.network.portDesc")}
          >
            <input
              type="number"
              min={1}
              max={65535}
              className={`${textInputClass} w-28`}
              value={endpoint.port || ""}
              disabled={disabled}
              onChange={(e) =>
                patch({ port: clampProxyPort(e.target.value) })
              }
            />
          </SettingRow>

          <SettingRow
            label={t("settings.network.username")}
            description={t("settings.network.usernameDesc")}
            vertical
          >
            <input
              type="text"
              className={textInputClass}
              value={endpoint.username ?? ""}
              disabled={disabled}
              autoComplete="off"
              onChange={(e) =>
                patch({
                  username: e.target.value || undefined,
                })
              }
            />
          </SettingRow>

          {passwordSlot && (
            <SettingRow
              label={t("settings.network.password")}
              description={
                passwordSet
                  ? t("settings.network.passwordReplaceDesc")
                  : t("settings.network.passwordDesc")
              }
              vertical
            >
              <div className="flex items-center gap-2 max-w-md">
                <PasswordInput
                  value={password}
                  onChange={setPassword}
                  placeholder={passwordSet ? "••••••••" : undefined}
                  className={textInputClass}
                  aria-label={t("settings.network.password")}
                />
                <button
                  type="button"
                  disabled={disabled || savingPassword || !password}
                  onClick={() => void handleSavePassword()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm bg-blue-600 text-white disabled:opacity-50"
                >
                  <Save size={14} />
                  {t("common.save")}
                </button>
                {passwordSet && (
                  <button
                    type="button"
                    disabled={disabled || savingPassword}
                    onClick={() => void handleClearPassword()}
                    className="px-3 py-2 rounded-lg text-sm border border-default text-muted hover:text-primary"
                  >
                    {t("settings.network.clearPassword")}
                  </button>
                )}
              </div>
            </SettingRow>
          )}
        </>
      )}
    </div>
  );
}

/** Compact mode+endpoint editor for connection / AI overrides. */
export function ProxyOverrideEditor({
  value,
  onChange,
  passwordSlot,
  disabled,
}: {
  value: ProxyOverride;
  onChange: (next: ProxyOverride) => void;
  passwordSlot: string | null;
  disabled?: boolean;
}) {
  const endpoint = value.endpoint ?? { ...DEFAULT_PROXY_ENDPOINT };

  return (
    <ProxyFields
      showMode
      mode={value.mode}
      onModeChange={(mode) => {
        if (mode === "custom") {
          onChange({
            mode,
            endpoint: value.endpoint ?? { ...DEFAULT_PROXY_ENDPOINT },
          });
        } else {
          onChange({ mode, endpoint: undefined });
        }
      }}
      endpoint={endpoint}
      onEndpointChange={(next) => onChange({ mode: "custom", endpoint: next })}
      passwordSlot={value.mode === "custom" ? passwordSlot : null}
      disabled={disabled}
    />
  );
}
