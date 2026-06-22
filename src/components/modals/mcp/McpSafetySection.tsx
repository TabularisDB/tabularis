import { useEffect, useState } from "react";
import { useLingui } from "@lingui/react/macro";
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
  const { t } = useLingui();
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
        title={t`Read-only mode`}
        icon={<Lock size={14} className="text-yellow-400" />}
      >
        <SettingRow
          label={t`Make all MCP queries read-only`}
          description={t`Block any non-SELECT statement coming through MCP unless the connection is explicitly allowed below.`}
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
                ? t`Allow writes from MCP`
                : t`Read-only connections`
            }
            description={
              readonlyDefault
                ? t`All other connections stay read-only. Only the connections checked here may execute writes.`
                : t`These connections will reject writes from MCP. Other connections behave normally.`
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
        title={t`Approval gate`}
        icon={<ShieldCheck size={14} className="text-purple-400" />}
      >
        <SettingRow
          label={t`Approval required`}
          description={t`Pause writes (or every query) and ask the user to approve them inside Tabularis before they hit the database.`}
        >
          <SettingButtonGroup<McpApprovalMode>
            value={approvalMode}
            onChange={(v) => updateSetting("mcpApprovalMode", v)}
            options={[
              { value: "off", label: t`Off` },
              { value: "writes_only", label: t`Writes only` },
              { value: "all", label: t`All queries` },
            ]}
          />
        </SettingRow>

        <SettingRow
          label={t({ message: "Timeout", context: "mcp" })}
          description={t`How long the MCP subprocess will wait for the user's decision before failing the request.`}
        >
          <SettingNumberInput
            value={approvalTimeout}
            onChange={(v) => updateSetting("mcpApprovalTimeoutSeconds", v ?? 120)}
            min={10}
            max={600}
            suffix={t`seconds`}
            fallback={120}
          />
        </SettingRow>

        <SettingRow
          label={t`Pre-flight EXPLAIN`}
          description={t`Run an EXPLAIN against the query before showing the approval modal so the user sees the execution plan.`}
        >
          <SettingToggle
            checked={preflightExplain}
            onChange={(v) => updateSetting("mcpPreflightExplain", v)}
          />
        </SettingRow>

        <SettingRow
          label={t`Bring approval dialog to the front`}
          description={t`When a non-read MCP action needs approval, bring Tabularis to the front and keep it temporarily above other windows.`}
        >
          <SettingToggle
            checked={approvalAlwaysOnTop}
            onChange={(v) => updateSetting("mcpApprovalAlwaysOnTop", v)}
          />
        </SettingRow>

        <SettingRow
          label={t`Send notification and play sound`}
          description={t`Show a native system notification and play a short alert sound when a new MCP approval request arrives.`}
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
