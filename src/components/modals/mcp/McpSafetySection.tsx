import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { ShieldCheck, Lock } from "lucide-react";
import { useSettings } from "../../../hooks/useSettings";
import {
  SettingRow,
  SettingSection,
  SettingToggle,
  SettingButtonGroup,
  SettingNumberInput,
} from "../../settings/SettingControls";
import type { McpApprovalMode } from "../../../types/ai";

interface ConnectionItem {
  id: string;
  name: string;
}

/// Settings block embedded in McpModal: read-only + approval gate controls.
export function McpSafetySection() {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();
  const [connections, setConnections] = useState<ConnectionItem[]>([]);

  useEffect(() => {
    invoke<ConnectionItem[]>("get_connections")
      .then((list) => setConnections(list.map((c) => ({ id: c.id, name: c.name }))))
      .catch(() => setConnections([]));
  }, []);

  const readonlyDefault = settings.mcpReadonlyDefault ?? false;
  const overrideList = settings.mcpReadonlyConnections ?? [];
  const approvalMode = (settings.mcpApprovalMode ?? "writes_only") as McpApprovalMode;
  const approvalTimeout = settings.mcpApprovalTimeoutSeconds ?? 120;
  const preflightExplain = settings.mcpPreflightExplain ?? true;
  const approvalAlwaysOnTop = settings.mcpApprovalAlwaysOnTop ?? true;
  const approvalNotifySound = settings.mcpApprovalNotifySound ?? true;

  const toggleConnection = (id: string) => {
    const next = overrideList.includes(id)
      ? overrideList.filter((c) => c !== id)
      : [...overrideList, id];
    updateSetting("mcpReadonlyConnections", next);
  };

  return (
    <>
      <SettingSection
        title={t("mcp.safety.readOnlyTitle")}
        icon={<Lock size={14} className="text-yellow-400" />}
      >
        <SettingRow
          label={t("mcp.safety.readOnlyDefault")}
          description={t("mcp.safety.readOnlyDefaultDesc")}
        >
          <SettingToggle
            checked={readonlyDefault}
            onChange={(v) => updateSetting("mcpReadonlyDefault", v)}
          />
        </SettingRow>

        {connections.length > 0 && (
          <SettingRow
            label={
              readonlyDefault
                ? t("mcp.safety.allowList")
                : t("mcp.safety.readOnlyList")
            }
            description={
              readonlyDefault
                ? t("mcp.safety.allowListDesc")
                : t("mcp.safety.readOnlyListDesc")
            }
            vertical
          >
            <div className="space-y-1.5 max-h-48 overflow-auto pr-2">
              {connections.map((c) => {
                const checked = overrideList.includes(c.id);
                return (
                  <label
                    key={c.id}
                    className="flex items-center gap-2 text-sm text-secondary cursor-pointer hover:text-primary"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleConnection(c.id)}
                      className="accent-blue-500"
                    />
                    <span className="font-mono text-xs">{c.name}</span>
                  </label>
                );
              })}
            </div>
          </SettingRow>
        )}
      </SettingSection>

      <SettingSection
        title={t("mcp.safety.approvalTitle")}
        icon={<ShieldCheck size={14} className="text-purple-400" />}
      >
        <SettingRow
          label={t("mcp.safety.approvalMode")}
          description={t("mcp.safety.approvalModeDesc")}
        >
          <SettingButtonGroup<McpApprovalMode>
            value={approvalMode}
            onChange={(v) => updateSetting("mcpApprovalMode", v)}
            options={[
              { value: "off", label: t("mcp.safety.modeOff") },
              { value: "writes_only", label: t("mcp.safety.modeWritesOnly") },
              { value: "all", label: t("mcp.safety.modeAll") },
            ]}
          />
        </SettingRow>

        <SettingRow
          label={t("mcp.safety.approvalTimeout")}
          description={t("mcp.safety.approvalTimeoutDesc")}
        >
          <SettingNumberInput
            value={approvalTimeout}
            onChange={(v) => updateSetting("mcpApprovalTimeoutSeconds", v ?? 120)}
            min={10}
            max={600}
            suffix={t("settings.seconds")}
            fallback={120}
          />
        </SettingRow>

        <SettingRow
          label={t("mcp.safety.preflightExplain")}
          description={t("mcp.safety.preflightExplainDesc")}
        >
          <SettingToggle
            checked={preflightExplain}
            onChange={(v) => updateSetting("mcpPreflightExplain", v)}
          />
        </SettingRow>

        <SettingRow
          label={t("mcp.safety.approvalAlwaysOnTop")}
          description={t("mcp.safety.approvalAlwaysOnTopDesc")}
        >
          <SettingToggle
            checked={approvalAlwaysOnTop}
            onChange={(v) => updateSetting("mcpApprovalAlwaysOnTop", v)}
          />
        </SettingRow>

        <SettingRow
          label={t("mcp.safety.approvalNotifySound")}
          description={t("mcp.safety.approvalNotifySoundDesc")}
        >
          <SettingToggle
            checked={approvalNotifySound}
            onChange={(v) => updateSetting("mcpApprovalNotifySound", v)}
          />
        </SettingRow>
      </SettingSection>
    </>
  );
}
