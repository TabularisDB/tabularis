import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Trash2,
  FileDown,
  RotateCcw,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import clsx from "clsx";
import { useSettings } from "../../hooks/useSettings";
import { useAlert } from "../../hooks/useAlert";
import { usePlatformCapabilities } from "../../hooks/usePlatformCapabilities";
import { useTabularisClient } from "../../hooks/useTabularisClient";
import { downloadGeneratedFile } from "../../utils/fileDownloads";
import type { LogEntry, LogSettings } from "../../types/operations";
import { ConfirmModal } from "../modals/ConfirmModal";
import {
  SettingSection,
  SettingRow,
  SettingToggle,
  SettingNumberInput,
} from "./SettingControls";

const LOG_LEVEL_COLORS: Record<string, string> = {
  ERROR: "text-red-400",
  WARN: "text-yellow-400",
  INFO: "text-blue-400",
  DEBUG: "text-green-400",
};

export function LogsTab() {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();
  const { showAlert } = useAlert();
  const client = useTabularisClient();
  const platform = usePlatformCapabilities();

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [levelFilter, setLevelFilter] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [logSettings, setLogSettings] = useState<LogSettings>({
    enabled: true,
    max_size: 1000,
    current_count: 0,
  });
  const [expandedLogs, setExpandedLogs] = useState<Set<number>>(new Set());
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  const loadLogs = useCallback(async () => {
    try {
      setIsLoading(true);
      const entries = await client.call("get_logs", {
        request: {
          limit: settings.maxLogEntries || 1000,
          level_filter: levelFilter || null,
        },
      });
      setLogs([...entries].reverse());

      setLogSettings(await client.call("get_log_settings", undefined));
    } catch (e) {
      console.error("Failed to load logs", e);
    } finally {
      setIsLoading(false);
    }
  }, [client, levelFilter, settings.maxLogEntries]);

  const handleClearLogs = useCallback(() => {
    setClearConfirmOpen(true);
  }, []);

  const confirmClearLogs = useCallback(async () => {
    try {
      await client.call("clear_logs", undefined);
      await loadLogs();
    } catch (e) {
      console.error("Failed to clear logs", e);
    } finally {
      setClearConfirmOpen(false);
    }
  }, [client, loadLogs]);

  const handleExportLogs = useCallback(async () => {
    try {
      const fileName = `tabularis_logs_${new Date().toISOString().split("T")[0]}.log`;
      const target = platform.supports("chooseSaveTarget")
        ? await platform.chooseSaveTarget({
            suggestedName: fileName,
            filters: [{ name: "Log Files", extensions: ["log"] }],
          })
        : null;
      if (platform.supports("chooseSaveTarget") && !target) return;
      const generated = await client.call("export_logs", {
        ...(target ? { filePath: target.reference } : {}),
      });
      await downloadGeneratedFile(client, platform, generated);
      showAlert(t("settings.exportLogsSuccess"), {
        title: t("common.success"),
        kind: "info",
      });
    } catch (e) {
      console.error("Failed to export logs", e);
    }
  }, [client, platform, showAlert, t]);

  const handleToggleLogging = useCallback(
    async (enabled: boolean) => {
      try {
        await client.call("set_log_enabled", { enabled });
        updateSetting("loggingEnabled", enabled);
        await loadLogs();
      } catch (e) {
        console.error("Failed to toggle logging", e);
      }
    },
    [client, updateSetting, loadLogs],
  );

  const handleSetMaxSize = useCallback(
    async (size: number) => {
      try {
        await client.call("set_log_max_size", { maxSize: size });
        updateSetting("maxLogEntries", size);
        await loadLogs();
      } catch (e) {
        console.error("Failed to set max size", e);
      }
    },
    [client, updateSetting, loadLogs],
  );

  useEffect(() => {
    loadLogs();
    const interval = setInterval(loadLogs, 5000);
    return () => clearInterval(interval);
  }, [loadLogs]);

  const toggleLogExpansion = (index: number) => {
    setExpandedLogs((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const hasQuery = (msg: string) => msg.includes("| Query:");
  const extractQuery = (msg: string) => {
    const m = msg.match(/\| Query:\s*([\s\S]*)$/);
    return m ? m[1].trim() : msg;
  };

  return (
    <div>
      <ConfirmModal
        isOpen={clearConfirmOpen}
        onClose={() => setClearConfirmOpen(false)}
        title={t("common.delete")}
        message={t("settings.clearLogsConfirm")}
        confirmLabel={t("settings.clearLogs")}
        onConfirm={() => void confirmClearLogs()}
        variant="warning"
      />

      {/* Settings */}
      <SettingSection title={t("settings.logSettings")}>
        <SettingRow
          label={t("settings.enableLogging")}
          description={t("settings.enableLoggingDesc")}
        >
          <SettingToggle
            checked={settings.loggingEnabled !== false}
            onChange={handleToggleLogging}
          />
        </SettingRow>

        <SettingRow
          label={t("settings.maxLogEntries")}
          description={`${t("settings.maxLogEntriesDesc")} — ${t("settings.currentLogCount")}: ${logSettings.current_count}`}
        >
          <SettingNumberInput
            value={settings.maxLogEntries || 1000}
            onChange={handleSetMaxSize}
            min={100}
            max={10000}
            step={100}
            fallback={1000}
          />
        </SettingRow>

        <div className="flex gap-2 py-3">
          <button
            onClick={handleClearLogs}
            className="flex items-center gap-2 px-4 py-2 bg-surface-secondary hover:bg-red-900/20 text-secondary hover:text-red-400 border border-strong hover:border-red-900/30 rounded-lg text-sm font-medium transition-colors"
          >
            <Trash2 size={16} />
            {t("settings.clearLogs")}
          </button>
          <button
            onClick={handleExportLogs}
            className="flex items-center gap-2 px-4 py-2 bg-surface-secondary hover:bg-surface-tertiary text-secondary hover:text-primary border border-strong rounded-lg text-sm font-medium transition-colors"
          >
            <FileDown size={16} />
            {t("settings.exportLogs")}
          </button>
          <button
            onClick={loadLogs}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <RotateCcw
              size={16}
              className={isLoading ? "animate-spin" : ""}
            />
            {t("settings.refreshLogs")}
          </button>
        </div>
      </SettingSection>

      {/* Log viewer */}
      <SettingSection title={t("settings.logs")}>
        <div className="flex items-center justify-end gap-2 py-2">
          <span className="text-sm text-secondary">
            {t("settings.filterByLevel")}:
          </span>
          <select
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value)}
            className="bg-base border border-strong rounded px-3 py-1.5 text-sm text-primary focus:outline-none focus:border-blue-500"
          >
            <option value="">{t("settings.allLevels")}</option>
            <option value="DEBUG">{t("settings.debug")}</option>
            <option value="INFO">{t("settings.info")}</option>
            <option value="WARN">{t("settings.warn")}</option>
            <option value="ERROR">{t("settings.error")}</option>
          </select>
        </div>

        <div className="bg-base border border-default rounded-lg overflow-hidden">
          {logs.length === 0 ? (
            <div className="p-8 text-center text-muted">
              {t("settings.noLogs")}
            </div>
          ) : (
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-secondary sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-2 text-secondary font-medium">
                      {t("settings.logTimestamp")}
                    </th>
                    <th className="text-left px-4 py-2 text-secondary font-medium w-20">
                      {t("settings.logLevel")}
                    </th>
                    <th className="text-left px-4 py-2 text-secondary font-medium">
                      {t("settings.logMessage")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-default">
                  {logs.map((log, i) => {
                    const isExpanded = expandedLogs.has(i);
                    const logHasQuery = hasQuery(log.message);
                    const queryContent = logHasQuery
                      ? extractQuery(log.message)
                      : log.message;
                    const previewMessage = logHasQuery
                      ? log.message
                          .substring(0, log.message.indexOf("| Query:"))
                          .trim() || "Executing query"
                      : log.message;

                    return (
                      <tr key={i} className="hover:bg-surface-secondary/50">
                        <td className="px-4 py-2 text-muted font-mono text-xs whitespace-nowrap">
                          {log.timestamp}
                        </td>
                        <td className="px-4 py-2">
                          <span
                            className={clsx(
                              "text-xs font-medium",
                              LOG_LEVEL_COLORS[log.level.toUpperCase()] ??
                                "text-muted",
                            )}
                          >
                            {log.level.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-primary font-mono text-xs">
                          {logHasQuery ? (
                            <div>
                              <button
                                onClick={() => toggleLogExpansion(i)}
                                className="flex items-center gap-1 hover:text-blue-400 transition-colors text-left"
                              >
                                {isExpanded ? (
                                  <ChevronDown
                                    size={14}
                                    className="shrink-0"
                                  />
                                ) : (
                                  <ChevronRight
                                    size={14}
                                    className="shrink-0"
                                  />
                                )}
                                <span className="break-all">
                                  {previewMessage}
                                </span>
                              </button>
                              {isExpanded && (
                                <div className="mt-2 ml-5 p-2 bg-surface-secondary rounded border border-strong">
                                  <div className="text-xs text-muted mb-1">
                                    Query:
                                  </div>
                                  <pre className="text-xs text-primary whitespace-pre-wrap break-all">
                                    {queryContent}
                                  </pre>
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="break-all">{log.message}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </SettingSection>
    </div>
  );
}
