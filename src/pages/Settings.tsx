import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation, Trans } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import {
  Github,
  CheckCircle2,
  Circle,
  Heart,
  Info,
  Code2,
  Database, Settings as SettingsIcon,
  Languages,
  Sparkles,
  Power,
  Palette,
  Type,
  ZoomIn,
  RefreshCw,
  AlertTriangle,
  Download,
  Loader2,
  ScrollText,
  Trash2,
  FileDown,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  Check,
  ExternalLink,
  Activity,
  Keyboard,
  Lock,
  X,
} from "lucide-react";
import clsx from "clsx";
import { useSettings } from "../hooks/useSettings";
import { useTheme } from "../hooks/useTheme";
import type { AppLanguage, AiProvider, PluginConfig } from "../contexts/SettingsContext";
import { DEFAULT_SETTINGS } from "../contexts/SettingsContext";
import { APP_VERSION } from "../version";
import { message, ask, save } from "@tauri-apps/plugin-dialog";
import { AVAILABLE_FONTS, ROADMAP } from "../utils/settings";
import { getProviderLabel } from "../utils/settingsUI";
import { useDrivers } from "../hooks/useDrivers";
import { usePluginRegistry } from "../hooks/usePluginRegistry";
import { useDatabase } from "../hooks/useDatabase";
import { findConnectionsForDrivers } from "../utils/connectionManager";
import { parseAuthor, versionGte } from "../utils/plugins";
import type { PluginManifest } from "../types/plugins";
import { Select } from "../components/ui/Select";
import { PluginInstallErrorModal } from "../components/modals/PluginInstallErrorModal";
import { PluginRemoveModal } from "../components/modals/PluginRemoveModal";
import { PluginSettingsModal } from "../components/modals/PluginSettingsModal";
import { SlotAnchor } from "../components/ui/SlotAnchor";
import { PluginStartErrorModal } from "../components/modals/PluginStartErrorModal";
import { useUpdate } from "../hooks/useUpdate";
import { useKeybindings } from "../hooks/useKeybindings";
import { formatEvent, formatMatch, parseCombo } from "../utils/keybindings";

interface AiKeyStatus {
  configured: boolean;
  fromEnv: boolean;
}

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  target?: string;
}


interface PluginCardProps {
  name: string;
  description: string;
  version?: string;
  author?: string;
  homepage?: string;
  status?: ReactNode;
  actions: ReactNode;
  dimmed?: boolean;
}

function PluginCard({ name, description, version, author, homepage, status, actions, dimmed }: PluginCardProps) {
  const { t } = useTranslation();
  const parsedAuthor = author ? parseAuthor(author) : null;
  return (
    <div className={`grid grid-cols-[1fr_auto] gap-x-6 px-5 py-4 rounded-xl border border-surface-tertiary bg-surface-secondary transition-colors hover:border-surface-quaternary${dimmed ? " opacity-50" : ""}`}>
      {/* Left: info */}
      <div className="min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-sm font-semibold text-primary">
            {homepage ? (
              <button
                type="button"
                onClick={() => openUrl(homepage)}
                className="hover:underline inline-flex items-center gap-1 text-primary"
              >
                {name}
                <ExternalLink size={10} className="text-muted shrink-0" />
              </button>
            ) : name}
          </span>
          {version && (
            <span className="text-[10px] font-mono text-muted bg-surface-tertiary px-1.5 py-px rounded">v{version}</span>
          )}
          {status}
        </div>
        <p className="text-xs text-secondary mt-1 leading-relaxed line-clamp-2">{description}</p>
        {parsedAuthor && (
          <p className="text-[10px] text-muted mt-1.5">
            {t("settings.plugins.by")}{" "}
            {(parsedAuthor.url ?? homepage) ? (
              <button
                type="button"
                onClick={() => openUrl((parsedAuthor.url ?? homepage)!)}
                className="hover:text-secondary underline-offset-2 hover:underline transition-colors"
              >
                {parsedAuthor.name}
              </button>
            ) : parsedAuthor.name}
          </p>
        )}
      </div>

      {/* Right: actions column */}
      <div className="flex flex-col items-end justify-center gap-2 shrink-0 min-w-[160px]">
        {actions}
      </div>
    </div>
  );
}

const LogsTab = () => {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();
  
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [levelFilter, setLevelFilter] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [logSettings, setLogSettings] = useState({ enabled: true, max_size: 1000, current_count: 0 });
  const [expandedLogs, setExpandedLogs] = useState<Set<number>>(new Set());

  const loadLogs = useCallback(async () => {
    try {
      setIsLoading(true);
      const entries = await invoke<LogEntry[]>("get_logs", {
        request: {
          limit: settings.maxLogEntries || 1000,
          level_filter: levelFilter || null,
        },
      });
      // Reverse to show newest logs first
      setLogs(entries.reverse());
      
      const settings_data = await invoke<{ enabled: boolean; max_size: number; current_count: number }>("get_log_settings");
      setLogSettings(settings_data);
    } catch (e) {
      console.error("Failed to load logs", e);
    } finally {
      setIsLoading(false);
    }
  }, [levelFilter, settings.maxLogEntries]);

  const handleClearLogs = async () => {
    try {
      const confirmed = await ask(t("settings.clearLogsConfirm"), { title: t("common.delete"), kind: "warning" });
      if (!confirmed) return;
      
      await invoke("clear_logs");
      await loadLogs();
    } catch (e) {
      console.error("Failed to clear logs", e);
    }
  };

  const handleExportLogs = async () => {
    try {
      const filePath = await save({
        filters: [{ name: "Log Files", extensions: ["log"] }],
        defaultPath: `tabularis_logs_${new Date().toISOString().split("T")[0]}.log`,
      });

      if (!filePath) return;

      await invoke("export_logs", { filePath });
      await message(t("settings.exportLogsSuccess"), { title: t("common.success"), kind: "info" });
    } catch (e) {
      console.error("Failed to export logs", e);
    }
  };

  const handleToggleLogging = async (enabled: boolean) => {
    try {
      await invoke("set_log_enabled", { enabled });
      updateSetting("loggingEnabled", enabled);
      await loadLogs();
    } catch (e) {
      console.error("Failed to toggle logging", e);
    }
  };

  const handleSetMaxSize = async (size: number) => {
    try {
      await invoke("set_log_max_size", { maxSize: size });
      updateSetting("maxLogEntries", size);
      await loadLogs();
    } catch (e) {
      console.error("Failed to set max size", e);
    }
  };

  useEffect(() => {
    loadLogs();
    const interval = setInterval(loadLogs, 5000);
    return () => clearInterval(interval);
  }, [loadLogs]);

  const getLevelColor = (level: string) => {
    switch (level.toUpperCase()) {
      case "ERROR": return "text-red-400";
      case "WARN": return "text-yellow-400";
      case "INFO": return "text-blue-400";
      case "DEBUG": return "text-green-400";
      default: return "text-muted";
    }
  };

  const toggleLogExpansion = (index: number) => {
    setExpandedLogs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  };

  const hasQuery = (message: string) => {
    return message.includes("| Query:");
  };

  const extractQuery = (message: string) => {
    const queryMatch = message.match(/\| Query:\s*([\s\S]*)$/);
    return queryMatch ? queryMatch[1].trim() : message;
  };

  return (
    <div className="space-y-6">
      {/* Log Settings */}
      <div className="bg-elevated border border-default rounded-xl p-6">
        <h3 className="text-lg font-semibold text-primary mb-4 flex items-center gap-2">
          <SettingsIcon size={20} className="text-blue-400" />
          {t("settings.logSettings")}
        </h3>

        <div className="space-y-4">
          {/* Enable Toggle */}
          <div className="flex items-center justify-between bg-base p-4 rounded-lg border border-default">
            <div>
              <div className="text-sm text-primary font-medium">
                {t("settings.enableLogging")}
              </div>
              <div className="text-xs text-muted mt-1">
                {t("settings.enableLoggingDesc")}
              </div>
            </div>
            <input
              type="checkbox"
              checked={settings.loggingEnabled !== false}
              onChange={(e) => handleToggleLogging(e.target.checked)}
              className="w-10 h-6 bg-base border border-strong rounded-full appearance-none cursor-pointer relative transition-colors checked:bg-blue-600 checked:border-blue-600 after:content-[''] after:absolute after:top-1 after:left-1 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-transform checked:after:translate-x-4"
            />
          </div>

          {/* Max Entries */}
          <div className="bg-base p-4 rounded-lg border border-default">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-sm text-primary font-medium">
                  {t("settings.maxLogEntries")}
                </div>
                <div className="text-xs text-muted mt-1">
                  {t("settings.maxLogEntriesDesc")}
                </div>
              </div>
              <input
                type="number"
                min={100}
                max={10000}
                step={100}
                value={settings.maxLogEntries || 1000}
                onChange={(e) => handleSetMaxSize(parseInt(e.target.value) || 1000)}
                className="bg-surface-secondary border border-strong rounded px-3 py-2 text-primary w-24 focus:outline-none focus:border-blue-500 transition-colors"
              />
            </div>
            <div className="text-xs text-muted">
              {t("settings.currentLogCount")}: <span className="text-primary font-medium">{logSettings.current_count}</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
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
              <RotateCcw size={16} className={isLoading ? "animate-spin" : ""} />
              {t("settings.refreshLogs")}
            </button>
          </div>
        </div>
      </div>

      {/* Logs Display */}
      <div className="bg-elevated border border-default rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-primary flex items-center gap-2">
            <ScrollText size={20} className="text-green-400" />
            {t("settings.logs")}
          </h3>
          
          {/* Level Filter */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-secondary">{t("settings.filterByLevel")}:</span>
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
        </div>

        {/* Log Table */}
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
                    <th className="text-left px-4 py-2 text-secondary font-medium">{t("settings.logTimestamp")}</th>
                    <th className="text-left px-4 py-2 text-secondary font-medium w-20">{t("settings.logLevel")}</th>
                    <th className="text-left px-4 py-2 text-secondary font-medium">{t("settings.logMessage")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-default">
                  {logs.map((log, i) => {
                    const isExpanded = expandedLogs.has(i);
                    const logHasQuery = hasQuery(log.message);
                    const queryContent = logHasQuery ? extractQuery(log.message) : log.message;
                    const previewMessage = logHasQuery 
                      ? log.message.substring(0, log.message.indexOf("| Query:")).trim() || "Executing query"
                      : log.message;
                    
                    return (
                      <tr key={i} className="hover:bg-surface-secondary/50">
                        <td className="px-4 py-2 text-muted font-mono text-xs whitespace-nowrap">
                          {log.timestamp}
                        </td>
                        <td className="px-4 py-2">
                          <span className={clsx("text-xs font-medium", getLevelColor(log.level))}>
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
                                  <ChevronDown size={14} className="shrink-0" />
                                ) : (
                                  <ChevronRight size={14} className="shrink-0" />
                                )}
                                <span className="break-all">{previewMessage}</span>
                              </button>
                              {isExpanded && (
                                <div className="mt-2 ml-5 p-2 bg-surface-secondary rounded border border-strong">
                                  <div className="text-xs text-muted mb-1">Query:</div>
                                  <pre className="text-xs text-primary whitespace-pre-wrap break-all">{queryContent}</pre>
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
      </div>
    </div>
  );
};

interface EditingShortcut {
  id: string;
  label: string;
  current: string;
}

const ShortcutsEditModal = ({
  editing,
  onClose,
  onSave,
  isMac,
}: {
  editing: EditingShortcut;
  onClose: () => void;
  onSave: (combo: string) => Promise<void>;
  isMac: boolean;
}) => {
  const { t } = useTranslation();
  const [combo, setCombo] = useState("");
  const [saving, setSaving] = useState(false);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") { onClose(); return; }
    if (["Control", "Meta", "Shift", "Alt"].includes(e.key)) return;
    setCombo(formatEvent(e.nativeEvent, isMac));
  }, [isMac, onClose]);

  const handleSave = async () => {
    if (!combo) return;
    setSaving(true);
    try { await onSave(combo); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-elevated border border-default rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/15 rounded-lg">
              <Keyboard size={18} className="text-blue-400" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-primary">{editing.label}</h3>
              <p className="text-xs text-muted mt-0.5">
                {editing.current}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-surface-secondary transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div
          className={clsx(
            "flex items-center justify-center h-24 rounded-xl border-2 text-sm font-mono cursor-default select-none transition-colors",
            combo
              ? "border-blue-500 bg-blue-500/10 text-blue-300"
              : "border-dashed border-default text-muted",
          )}
          tabIndex={0}
          autoFocus
          onKeyDown={handleKeyDown}
        >
          {combo ? (
            <kbd className="text-2xl font-semibold tracking-wide">{combo}</kbd>
          ) : (
            <span className="text-sm">{t("settings.shortcuts.pressKeys")}</span>
          )}
        </div>

        <p className="text-xs text-muted text-center mt-2">
          {combo ? t("common.save") + " / Esc" : "Esc " + t("common.cancel")}
        </p>

        <div className="flex gap-3 mt-5">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg text-sm border border-default text-muted hover:text-primary hover:border-blue-500/50 transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleSave}
            disabled={!combo || saving}
            className="flex-1 px-4 py-2 rounded-lg text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium transition-colors flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            {t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
};

const ShortcutsTab = () => {
  const { t } = useTranslation();
  const { shortcuts, saveOverride, resetOverride, overrides, isMac } = useKeybindings();
  const [editingShortcut, setEditingShortcut] = useState<EditingShortcut | null>(null);

  const categories = ["editor", "navigation", "data_grid"] as const;

  const openEdit = useCallback(
    (s: (typeof shortcuts)[number]) => {
      const hasOverride = !!overrides[s.id];
      setEditingShortcut({
        id: s.id,
        label: t(s.i18nKey as Parameters<typeof t>[0]),
        current: isMac
          ? (hasOverride ? formatMatch(overrides[s.id].mac, true) : s.defaultMac)
          : (hasOverride ? formatMatch(overrides[s.id].win, false) : s.defaultWin),
      });
    },
    [t, overrides, isMac],
  );

  const handleSave = useCallback(
    async (combo: string) => {
      if (!editingShortcut) return;
      const match = parseCombo(combo.replace("⌘", "Meta").replace("⌥", "Alt"));
      if (isMac) {
        await saveOverride(editingShortcut.id, match, overrides[editingShortcut.id]?.win ?? match);
      } else {
        await saveOverride(editingShortcut.id, overrides[editingShortcut.id]?.mac ?? match, match);
      }
      setEditingShortcut(null);
    },
    [editingShortcut, isMac, saveOverride, overrides],
  );

  return (
    <>
      {editingShortcut && (
        <ShortcutsEditModal
          editing={editingShortcut}
          onClose={() => setEditingShortcut(null)}
          onSave={handleSave}
          isMac={isMac}
        />
      )}

      <div className="space-y-6">
        <div className="bg-elevated border border-default rounded-xl p-6">
          <h3 className="text-lg font-semibold text-primary mb-1 flex items-center gap-2">
            <Keyboard size={20} className="text-blue-400" />
            {t("settings.shortcuts.title")}
          </h3>
          <p className="text-sm text-muted">
            {isMac
              ? "Use ⌘ (Cmd) as the main modifier. Shortcuts with a lock icon are built-in and cannot be changed."
              : "Use Ctrl as the main modifier. Shortcuts with a lock icon are built-in and cannot be changed."}
          </p>
        </div>

        {categories.map((cat) => {
          const items = shortcuts.filter((s) => s.category === cat);
          if (!items.length) return null;
          return (
            <div key={cat} className="bg-elevated border border-default rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-default bg-surface-secondary/20">
                <h3 className="text-xs font-semibold text-muted uppercase tracking-widest">
                  {t(`settings.shortcuts.categories.${cat}` as const)}
                </h3>
              </div>
              <div className="divide-y divide-default">
                {items.map((s) => {
                  const hasOverride = !!overrides[s.id];
                  const label = isMac
                    ? (hasOverride ? formatMatch(overrides[s.id].mac, true) : s.defaultMac)
                    : (hasOverride ? formatMatch(overrides[s.id].win, false) : s.defaultWin);
                  return (
                    <div
                      key={s.id}
                      className="flex items-center px-5 py-3.5 gap-4 hover:bg-surface-secondary/20 transition-colors"
                    >
                      {/* Icon */}
                      <div className="shrink-0">
                        {s.overridable ? (
                          <Keyboard size={14} className="text-blue-400" />
                        ) : (
                          <span title={t("settings.shortcuts.notOverridable")}>
                            <Lock size={14} className="text-muted/50" />
                          </span>
                        )}
                      </div>

                      {/* Label */}
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-primary">
                          {t(s.i18nKey as Parameters<typeof t>[0])}
                        </span>
                        {hasOverride && (
                          <span className="ml-2 text-xs text-blue-400 font-medium">
                            customized
                          </span>
                        )}
                      </div>

                      {/* Actions + shortcut badge */}
                      <div className="flex items-center gap-2 shrink-0">
                        {s.overridable ? (
                          <>
                            <button
                              onClick={() => openEdit(s)}
                              className="px-2.5 py-1 text-xs rounded-lg border border-default text-muted hover:text-primary hover:border-blue-500/60 hover:bg-blue-500/5 transition-colors"
                            >
                              {t("common.edit")}
                            </button>
                            {hasOverride && (
                              <button
                                onClick={() => resetOverride(s.id)}
                                title={t("settings.shortcuts.resetToDefault")}
                                className="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-surface-secondary transition-colors"
                              >
                                <RotateCcw size={13} />
                              </button>
                            )}
                          </>
                        ) : null}

                        <kbd className="px-2.5 py-1 text-xs font-mono bg-surface-secondary border border-default rounded-lg text-secondary min-w-[100px] text-center">
                          {label}
                        </kbd>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
};

interface VersionOption {
  version: string;
  isInstalled: boolean;
  isLatest: boolean;
}

const VersionDropdown = ({
  options,
  value,
  onChange,
  isDowngrade,
  label,
}: {
  options: VersionOption[];
  value: string;
  onChange: (v: string) => void;
  isDowngrade: boolean;
  label: string;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, minWidth: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const updatePos = () => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left, minWidth: Math.max(r.width, 160) });
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!btnRef.current?.contains(e.target as Node) && !dropRef.current?.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setIsOpen(false); };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [isOpen]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => { updatePos(); setIsOpen((o) => !o); }}
        className={clsx(
          "flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] bg-surface-tertiary transition-colors cursor-pointer select-none",
          isDowngrade
            ? "border-amber-500/30 text-amber-400/80 hover:border-amber-500/60 hover:text-amber-400"
            : isOpen
            ? "border-blue-500/60 text-primary"
            : "border-surface-quaternary text-secondary hover:border-blue-500/50 hover:text-primary"
        )}
      >
        <RotateCcw size={9} />
        <span>{label}</span>
        <ChevronDown size={9} className={clsx("transition-transform duration-150", isOpen && "rotate-180")} />
      </button>

      {isOpen && createPortal(
        <div
          ref={dropRef}
          style={{ top: pos.top, left: pos.left, minWidth: pos.minWidth }}
          className="fixed z-[200] bg-elevated border border-strong rounded-lg shadow-xl overflow-hidden"
        >
          {options.map((opt) => (
            <button
              key={opt.version}
              type="button"
              onClick={() => { onChange(opt.version); setIsOpen(false); }}
              className={clsx(
                "w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors",
                opt.isInstalled
                  ? "bg-green-500/10 hover:bg-green-500/20"
                  : opt.version === value
                  ? "bg-surface-secondary"
                  : "hover:bg-surface-secondary"
              )}
            >
              <span className="w-3 shrink-0 flex items-center justify-center">
                {opt.isInstalled && <Check size={10} className="text-green-400" />}
              </span>
              <span className={clsx("font-mono", opt.isInstalled ? "text-green-300" : "text-primary")}>
                v{opt.version}
              </span>
              <span className="ml-auto flex items-center gap-1">
                {opt.isInstalled && (
                  <span className="text-[9px] font-medium bg-green-500/20 text-green-400 px-1.5 py-px rounded">
                    installed
                  </span>
                )}
                {opt.isLatest && (
                  <span className="text-[9px] font-medium bg-blue-500/20 text-blue-400 px-1.5 py-px rounded">
                    latest
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
};

type SettingsTab = "general" | "appearance" | "localization" | "ai" | "logs" | "shortcuts" | "plugins" | "info";

const tabItems: Array<{ id: SettingsTab; icon: React.ComponentType<{ size: number }>; labelKey: string }> = [
  { id: "general", icon: SettingsIcon, labelKey: "settings.general" },
  { id: "appearance", icon: Palette, labelKey: "settings.appearance" },
  { id: "localization", icon: Languages, labelKey: "settings.localization" },
  { id: "ai", icon: Sparkles, labelKey: "settings.ai.tab" },
  { id: "logs", icon: ScrollText, labelKey: "settings.logs" },
  { id: "shortcuts", icon: Keyboard, labelKey: "settings.shortcuts.title" },
  { id: "plugins", icon: Database, labelKey: "settings.plugins.title" },
  { id: "info", icon: Info, labelKey: "settings.info" },
];

export const Settings = () => {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();
  const { checkForUpdates, isChecking, updateInfo, error: updateError, isUpToDate, installationSource } = useUpdate();
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    "general",
  );
  const [aiKeyStatus, setAiKeyStatus] = useState<Record<string, AiKeyStatus>>({});
  const [availableModels, setAvailableModels] = useState<Record<string, string[]>>({});
  const [keyInput, setKeyInput] = useState("");
  const { allDrivers, installedPlugins, refresh: refreshDrivers } = useDrivers();
  const { plugins: registryPlugins, loading: registryLoading, error: registryError, refresh: refreshRegistry } = usePluginRegistry();
  const { openConnectionIds, connectionDataMap, disconnect } = useDatabase();
  const [installingPluginId, setInstallingPluginId] = useState<string | null>(null);
  const [pluginInstallError, setPluginInstallError] = useState<{ pluginId: string; error: string } | null>(null);
  const [pluginSettingsModal, setPluginSettingsModal] = useState<{ pluginId: string; pluginName: string } | null>(null);
  const [openModalManifest, setOpenModalManifest] = useState<PluginManifest | undefined>(undefined);
  const [pluginStartError, setPluginStartError] = useState<{ pluginId: string; pluginName: string; error: string } | null>(null);
  const [selectedVersions, setSelectedVersions] = useState<Record<string, string>>({});
  const [uninstallingPluginId, setUninstallingPluginId] = useState<string | null>(null);
  const [pluginRemoveConfirm, setPluginRemoveConfirm] = useState<{ pluginId: string; pluginName: string; onConfirm: () => Promise<void> } | null>(null);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [explainPrompt, setExplainPrompt] = useState("");
  
  const { currentTheme, allThemes, setTheme } = useTheme();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const updateSettingRef = useRef(updateSetting);
  updateSettingRef.current = updateSetting;
  
  // Initialize customFont from settings if it's a custom font
  const [customFont, setCustomFont] = useState(() => {
    const isPredefinedFont = AVAILABLE_FONTS.some(f => f.name === settings.fontFamily);
    return !isPredefinedFont && settings.fontFamily ? settings.fontFamily : "";
  });

  const handleSavePluginConfig = useCallback(async (pluginId: string, pluginName: string, config: PluginConfig) => {
    const current = settings.plugins ?? {};
    updateSetting("plugins", { ...current, [pluginId]: config });
    const isRunning = allDrivers.some(d => d.id === pluginId);
    if (isRunning) {
      try {
        await invoke("disable_plugin", { pluginId });
        await invoke("enable_plugin", { pluginId });
        refreshDrivers();
      } catch (err) {
        const activeExt = settings.activeExternalDrivers ?? [];
        updateSetting("activeExternalDrivers", activeExt.filter(id => id !== pluginId));
        refreshDrivers();
        setPluginStartError({ pluginId, pluginName, error: String(err) });
      }
    }
  }, [settings.plugins, settings.activeExternalDrivers, updateSetting, allDrivers, refreshDrivers]);

  const handleOpenPluginSettings = useCallback(async (pluginId: string, pluginName: string) => {
    setPluginSettingsModal({ pluginId, pluginName });
    const runningDriver = allDrivers.find((d) => d.id === pluginId);
    if (runningDriver) {
      setOpenModalManifest(runningDriver);
    } else {
      try {
        const manifest = await invoke<PluginManifest>("get_plugin_manifest", { pluginId });
        setOpenModalManifest(manifest);
      } catch {
        setOpenModalManifest(undefined);
      }
    }
  }, [allDrivers]);

  const loadModels = useCallback(async (force: boolean = false) => {
    try {
      const models = await invoke<Record<string, string[]>>("get_ai_models", { forceRefresh: force });
      setAvailableModels(models);
      if (force) {
          await message(t("settings.ai.refreshSuccess"), { title: t("common.success"), kind: "info" });
      }
    } catch (e) {
      console.error("Failed to load AI models", e);
      await message(t("settings.ai.refreshError") + ": " + String(e), { title: t("common.error"), kind: "error" });
    }
  }, [t]);
  
  const loadSystemPrompt = async () => {
    try {
      const prompt = await invoke<string>("get_system_prompt");
      setSystemPrompt(prompt);
    } catch (e) {
      console.error("Failed to load system prompt", e);
    }
  };

  const loadExplainPrompt = async () => {
    try {
      const prompt = await invoke<string>("get_explain_prompt");
      setExplainPrompt(prompt);
    } catch (e) {
      console.error("Failed to load explain prompt", e);
    }
  };

  const handleSavePrompt = async () => {
    try {
      await invoke("save_system_prompt", { prompt: systemPrompt });
      await message("System prompt saved successfully", {
        title: "Success",
        kind: "info",
      });
    } catch (e) {
      await message(String(e), { title: "Error", kind: "error" });
    }
  };

  const handleSaveExplainPrompt = async () => {
    try {
      await invoke("save_explain_prompt", { prompt: explainPrompt });
      await message("Explain prompt saved successfully", {
        title: "Success",
        kind: "info",
      });
    } catch (e) {
      await message(String(e), { title: "Error", kind: "error" });
    }
  };

  const handleResetPrompt = async () => {
    try {
      const defaultPrompt = await invoke<string>("reset_system_prompt");
      setSystemPrompt(defaultPrompt);
      await message("System prompt reset to default", {
        title: "Success",
        kind: "info",
      });
    } catch (e) {
      await message(String(e), { title: "Error", kind: "error" });
    }
  };

  const handleResetExplainPrompt = async () => {
    try {
      const defaultPrompt = await invoke<string>("reset_explain_prompt");
      setExplainPrompt(defaultPrompt);
      await message("Explain prompt reset to default", {
        title: "Success",
        kind: "info",
      });
    } catch (e) {
      await message(String(e), { title: "Error", kind: "error" });
    }
  };

  const checkKeys = async () => {
    try {
      const openai = await invoke<AiKeyStatus>("check_ai_key_status", {
        provider: "openai",
      });
      const anthropic = await invoke<AiKeyStatus>("check_ai_key_status", {
        provider: "anthropic",
      });
      const openrouter = await invoke<AiKeyStatus>("check_ai_key_status", {
        provider: "openrouter",
      });
      const customOpenai = await invoke<AiKeyStatus>("check_ai_key_status", {
        provider: "custom-openai",
      });
      const ollama = { configured: true, fromEnv: false }; // Ollama is always "configured" as it's local
      setAiKeyStatus({ openai, anthropic, openrouter, "custom-openai": customOpenai, ollama });
    } catch (e) {
      console.error("Failed to check keys", e);
    }
  };

  const handleSaveKey = async (provider: string) => {
    if (!keyInput.trim()) return;
    try {
      await invoke("set_ai_key", { provider, key: keyInput });
      await checkKeys();
      setKeyInput("");
      await message("API Key saved securely", {
        title: "Success",
        kind: "info",
      });
    } catch (e) {
      await message(String(e), { title: "Error", kind: "error" });
    }
  };


  useEffect(() => {
    // Initialize settings on mount
    checkKeys();
    loadSystemPrompt();
    loadExplainPrompt();
    loadModels(false);
    invoke<Array<{ plugin_id: string; error: string }>>("get_plugin_startup_errors").then((errors) => {
      if (errors.length > 0) {
        const failedIds = errors.map(e => e.plugin_id);
        const activeExt = settingsRef.current.activeExternalDrivers ?? [];
        const cleaned = activeExt.filter(id => !failedIds.includes(id));
        if (cleaned.length !== activeExt.length) {
          updateSettingRef.current("activeExternalDrivers", cleaned);
        }
        const first = errors[0];
        setPluginStartError({ pluginId: first.plugin_id, pluginName: first.plugin_id, error: first.error });
      }
    }).catch(() => {/* ignore */});
  }, [loadModels]);


  const availableLanguages: Array<{
    id: AppLanguage;
    label: string;
  }> = [
    { id: "auto", label: t("settings.auto") },
    { id: "en", label: t("settings.english") },
    { id: "it", label: t("settings.italian") },
    { id: "es", label: t("settings.spanish") },
  ];

  const providers: Array<{ id: AiProvider; label: string }> = [
    { id: "openai", label: "OpenAI" },
    { id: "anthropic", label: "Anthropic" },
    { id: "openrouter", label: "OpenRouter" },
    { id: "ollama", label: "Ollama" },
    { id: "custom-openai", label: "OpenAI Compatible" },
  ];

  return (
    <div className="h-full flex flex-col bg-base">
      {/* Header Tabs */}
      <div className="flex items-center gap-1 p-2 border-b border-default bg-elevated">
        {tabItems.map(({ id, icon: Icon, labelKey }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={clsx(
              "px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors",
              activeTab === id
                ? "bg-surface-secondary text-primary"
                : "text-muted hover:text-primary hover:bg-surface-secondary/50",
            )}
          >
            <Icon size={16} />
            {t(labelKey)}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-8">
        <div className="max-w-3xl mx-auto">
          {/* General Tab */}
          {activeTab === "general" && (
            <div className="space-y-6">
              <div className="bg-elevated border border-default rounded-xl p-6">
                <h3 className="text-lg font-semibold text-primary mb-4 flex items-center gap-2">
                  <SettingsIcon size={20} className="text-blue-400" />
                  {t("settings.dataEditor")}
                </h3>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-secondary mb-1">
                      {t("settings.pageSize")}
                    </label>
                    <p className="text-xs text-muted mb-2">
                      {t("settings.pageSizeDesc")}
                    </p>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={settings.resultPageSize ?? DEFAULT_SETTINGS.resultPageSize}
                        onChange={(e) =>
                          updateSetting(
                            "resultPageSize",
                            parseInt(e.target.value) || DEFAULT_SETTINGS.resultPageSize,
                          )
                        }
                        min="0"
                        className="bg-base border border-strong rounded px-3 py-2 text-primary w-32 focus:outline-none focus:border-blue-500 transition-colors"
                      />
                      <span className="text-sm text-muted">
                        {t("settings.rows")}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* ER Diagram Settings */}
              <div className="bg-elevated border border-default rounded-xl p-6">
                <h3 className="text-lg font-semibold text-primary mb-4 flex items-center gap-2">
                  <Code2 size={20} className="text-orange-400" />
                  {t("settings.erDiagram")}
                </h3>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-secondary mb-1">
                      {t("settings.erDiagramDefaultLayout")}
                    </label>
                    <p className="text-xs text-muted mb-3">
                      {t("settings.erDiagramDefaultLayoutDesc")}
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => updateSetting("erDiagramDefaultLayout", "LR")}
                        className={clsx(
                          "px-4 py-2 rounded-lg text-sm font-medium transition-all border",
                          (settings.erDiagramDefaultLayout ?? DEFAULT_SETTINGS.erDiagramDefaultLayout) === "LR"
                            ? "bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-900/20"
                            : "bg-base border-default text-muted hover:border-strong hover:text-primary",
                        )}
                      >
                        {t("erDiagram.horizontal")}
                      </button>
                      <button
                        onClick={() => updateSetting("erDiagramDefaultLayout", "TB")}
                        className={clsx(
                          "px-4 py-2 rounded-lg text-sm font-medium transition-all border",
                          (settings.erDiagramDefaultLayout ?? DEFAULT_SETTINGS.erDiagramDefaultLayout) === "TB"
                            ? "bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-900/20"
                            : "bg-base border-default text-muted hover:border-strong hover:text-primary",
                        )}
                      >
                        {t("erDiagram.vertical")}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* Localization Tab */}
          {activeTab === "localization" && (
            <div className="space-y-6">
              <div className="bg-elevated border border-default rounded-xl p-6">
                <h3 className="text-lg font-semibold text-primary mb-4 flex items-center gap-2">
                  <Languages size={20} className="text-purple-400" />
                  {t("settings.localization")}
                </h3>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-secondary mb-1">
                      {t("settings.language")}
                    </label>
                    <p className="text-xs text-muted mb-3">
                      {t("settings.languageDesc")}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {availableLanguages.map((lang) => (
                        <button
                          key={lang.id}
                          onClick={() => updateSetting("language", lang.id)}
                          className={clsx(
                            "px-4 py-2 rounded-lg text-sm font-medium transition-all border",
                            settings.language === lang.id
                              ? "bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-900/20"
                              : "bg-base border-default text-muted hover:border-strong hover:text-primary",
                          )}
                        >
                          {lang.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Appearance Tab */}
          {activeTab === "appearance" && (
            <div className="space-y-6">
              <div className="bg-elevated border border-default rounded-xl p-6">
                <h3 className="text-lg font-semibold text-primary mb-4 flex items-center gap-2">
                  <Palette size={20} className="text-pink-400" />
                  {t("settings.themeSelection")}
                </h3>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                  {allThemes.map((theme) => (
                    <button
                      key={theme.id}
                      onClick={() => setTheme(theme.id)}
                      className={clsx(
                        "p-4 rounded-xl border transition-all text-left",
                        currentTheme.id === theme.id
                          ? "bg-surface-secondary border-blue-500 shadow-lg shadow-blue-900/20"
                          : "bg-base border-default hover:border-strong",
                      )}
                    >
                      <div className="flex items-center gap-2 mb-3">
                        <div
                          className="w-6 h-6 rounded-full border border-strong"
                          style={{
                            background: `linear-gradient(135deg, ${theme.colors.accent.primary} 50%, ${theme.colors.accent.secondary} 50%)`,
                          }}
                        />
                        <span className="text-sm font-medium text-primary">
                          {theme.name}
                        </span>
                      </div>
                      <div className="flex gap-1">
                        <div
                          className="w-4 h-4 rounded"
                          style={{ backgroundColor: theme.colors.bg.base }}
                        />
                        <div
                          className="w-4 h-4 rounded"
                          style={{ backgroundColor: theme.colors.surface.primary }}
                        />
                        <div
                          className="w-4 h-4 rounded"
                          style={{ backgroundColor: theme.colors.accent.primary }}
                        />
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Font Family Selection */}
              <div className="bg-elevated border border-default rounded-xl p-6">
                <h3 className="text-lg font-semibold text-primary mb-4 flex items-center gap-2">
                  <Type size={20} className="text-blue-400" />
                  {t("settings.fontFamily")}
                </h3>

                {/* Font Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
                  {AVAILABLE_FONTS.map((font) => (
                    <button
                      key={font.name}
                      onClick={() => updateSetting("fontFamily", font.name)}
                      className={clsx(
                        "p-4 rounded-xl border transition-all text-left",
                        settings.fontFamily === font.name
                          ? "bg-surface-secondary border-blue-500 shadow-lg shadow-blue-900/20"
                          : "bg-base border-default hover:border-strong"
                      )}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-primary">
                          {font.label}
                        </span>
                        {settings.fontFamily === font.name && (
                          <CheckCircle2 size={16} className="text-blue-500" />
                        )}
                      </div>
                      <p
                        className="text-xs text-muted truncate"
                        style={{ fontFamily: font.name === "System" ? "system-ui, -apple-system, sans-serif" : `"${font.name}", ${font.name}` }}
                      >
                        Aa Bb Cc 123
                      </p>
                    </button>
                  ))}

                  {/* Custom Font Box */}
                  <button
                    onClick={() => {
                      const input = document.getElementById("custom-font-input") as HTMLInputElement;
                      input?.focus();
                    }}
                    className={clsx(
                      "p-4 rounded-xl border transition-all text-left relative",
                      !AVAILABLE_FONTS.some(f => f.name === settings.fontFamily)
                        ? "bg-surface-secondary border-blue-500 shadow-lg shadow-blue-900/20"
                        : "bg-base border-default hover:border-strong"
                    )}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-medium text-primary">
                        {t("settings.fonts.custom")}
                      </span>
                      {!AVAILABLE_FONTS.some(f => f.name === settings.fontFamily) && (
                        <CheckCircle2 size={16} className="text-blue-500" />
                      )}
                    </div>
                    <div className="space-y-2">
                      <input
                        id="custom-font-input"
                        type="text"
                        placeholder={t("settings.fonts.customPlaceholder")}
                        value={customFont}
                        onChange={(e) => setCustomFont(e.target.value)}
                        onBlur={() => {
                          if (customFont.trim()) {
                            updateSetting("fontFamily", customFont.trim());
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && customFont.trim()) {
                            updateSetting("fontFamily", customFont.trim());
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                        className={clsx(
                          "w-full bg-base border rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-blue-500 transition-colors",
                          !AVAILABLE_FONTS.some(f => f.name === settings.fontFamily) && customFont === settings.fontFamily
                            ? "border-blue-500"
                            : "border-strong"
                        )}
                      />
                      <p
                        className="text-xs text-muted truncate"
                        style={{ fontFamily: customFont || "inherit" }}
                      >
                        {customFont || t("settings.fonts.enterFontName")}
                      </p>
                    </div>
                  </button>
                </div>
              </div>

              {/* Font Size Selection */}
              <div className="bg-elevated border border-default rounded-xl p-6">
                <h3 className="text-lg font-semibold text-primary mb-4 flex items-center gap-2">
                  <ZoomIn size={20} className="text-green-400" />
                  {t("settings.fontSize")}
                </h3>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-secondary mb-2">
                      {t("settings.fontSizeLabel")}
                    </label>
                    <p className="text-xs text-muted mb-3">
                      {t("settings.fontSizeDesc")}
                    </p>
                    
                    <div className="flex items-center gap-4">
                      <input
                        type="range"
                        min="10"
                        max="20"
                        step="1"
                        value={settings.fontSize || 14}
                        onChange={(e) => updateSetting("fontSize", parseInt(e.target.value))}
                        className="flex-1 h-2 bg-surface-tertiary rounded-lg appearance-none cursor-pointer accent-blue-500"
                      />
                      <span className="text-sm font-mono text-primary w-16 text-right">
                        {settings.fontSize || 14}px
                      </span>
                    </div>
                  </div>

                  {/* Preview */}
                  <div className="bg-base border border-default rounded-lg p-4">
                    <p className="text-xs text-muted mb-2">{t("settings.preview")}:</p>
                    <p 
                      className="text-primary"
                      style={{ fontSize: `${settings.fontSize || 14}px` }}
                    >
                      Aa Bb Cc 123 - {t("settings.fontPreviewText")}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* AI Tab */}
          {activeTab === "ai" && (
            <div className="space-y-6">
              <div className="bg-elevated border border-default rounded-xl p-6">
                <h3 className="text-lg font-semibold text-primary mb-4 flex items-center gap-2">
                  <Sparkles size={20} className="text-yellow-400" />
                  AI Configuration
                </h3>
                <p className="text-sm text-secondary mb-6">
                  Configure AI providers to enable natural language to SQL
                  generation. Keys are stored securely in your system's
                  keychain.
                </p>

                {/* Enable/Disable Toggle */}
                <div className="flex items-center justify-between bg-base/50 p-4 rounded-lg border border-default mb-6">
                  <div className="flex items-center gap-3">
                    <div className={clsx("p-2 rounded-full", settings.aiEnabled ? "bg-green-900/20 text-green-400" : "bg-surface-secondary text-muted")}>
                        <Power size={18} />
                    </div>
                    <div>
                        <div className="text-sm font-medium text-primary">{t("settings.ai.enable")}</div>
                        <div className="text-xs text-muted">{t("settings.ai.enableDesc")}</div>
                    </div>
                  </div>
                  <button
                    onClick={() => updateSetting("aiEnabled", !settings.aiEnabled)}
                    className={clsx(
                        "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-elevated",
                        settings.aiEnabled ? "bg-blue-600" : "bg-surface-secondary"
                    )}
                  >
                    <span
                        className={clsx(
                            "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                            settings.aiEnabled ? "translate-x-6" : "translate-x-1"
                        )}
                    />
                  </button>
                </div>

                <div className={clsx("space-y-6 transition-opacity", !settings.aiEnabled && "opacity-50 pointer-events-none")}>
                  {/* Default Provider Selection */}
                  <div>
                    <label className="block text-sm font-medium text-secondary mb-2">
                      {t("settings.ai.defaultProvider")}
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {providers.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => {
                            updateSetting("aiProvider", p.id);
                            setKeyInput("");
                          }}
                          className={clsx(
                            "px-4 py-2 rounded-lg text-sm font-medium transition-all border flex items-center gap-2",
                            settings.aiProvider === p.id
                              ? "bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-900/20"
                              : "bg-base border-default text-muted hover:border-strong hover:text-primary",
                          )}
                        >
                          {p.label}
                          {aiKeyStatus[p.id]?.configured && (
                            <CheckCircle2
                              size={14}
                              className="text-green-400"
                            />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Active Provider Configuration */}
                  {settings.aiProvider && (
                    <div className="bg-base/50 border border-default rounded-lg p-6 space-y-6">
                      <div className="flex items-center gap-2 border-b border-default pb-4">
                        <h4 className="font-semibold text-primary">
                          {getProviderLabel(settings.aiProvider)}
                        </h4>
                        {aiKeyStatus[settings.aiProvider]?.configured ? (
                            <div className="flex items-center gap-2">
                                <span className="text-green-400 flex items-center gap-1 text-xs bg-green-900/10 px-2 py-0.5 rounded-full border border-green-900/20">
                                    <CheckCircle2 size={12} /> {t("settings.ai.configured")}
                                </span>
                                {aiKeyStatus[settings.aiProvider]?.fromEnv && (
                                    <span className="text-blue-400 flex items-center gap-1 text-xs bg-blue-900/10 px-2 py-0.5 rounded-full border border-blue-900/20" title={t("settings.ai.fromEnvTooltip")}>
                                        <Code2 size={12} /> {t("settings.ai.fromEnv")}
                                    </span>
                                )}
                            </div>
                        ) : settings.aiProvider !== 'ollama' && (
                            <span className="text-muted text-xs bg-surface-secondary px-2 py-0.5 rounded-full border border-default">
                            {t("settings.ai.notConfigured")}
                            </span>
                        )}
                      </div>

                      {/* API Key Input (Non-Ollama) */}
                      {settings.aiProvider !== 'ollama' && (
                        <div>
                            <label className="block text-sm font-medium text-secondary mb-1">
                                {t("settings.ai.apiKey", { provider: getProviderLabel(settings.aiProvider) })}
                            </label>
                            
                            <div className="flex gap-2">
                                <input
                                type="password"
                                value={keyInput}
                                placeholder={t("settings.ai.enterKey", { provider: getProviderLabel(settings.aiProvider) })}
                                className="flex-1 bg-base border border-strong rounded px-3 py-2 text-primary text-sm focus:outline-none focus:border-blue-500"
                                onChange={(e) => setKeyInput(e.target.value)}
                                />
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => handleSaveKey(settings.aiProvider!)}
                                        disabled={!keyInput.trim()}
                                        className="px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-surface-secondary disabled:text-muted text-white rounded text-sm font-medium transition-colors whitespace-nowrap"
                                    >
                                        {t("common.save")}
                                    </button>
                                    
                                    {aiKeyStatus[settings.aiProvider]?.configured && !aiKeyStatus[settings.aiProvider]?.fromEnv && (
                                        <button
                                            onClick={async () => {
                                                try {
                                                    await invoke("delete_ai_key", { provider: settings.aiProvider });
                                                    await checkKeys();
                                                    await message(t("settings.ai.keyResetSuccess"), { title: t("common.success"), kind: "info" });
                                                } catch (e) {
                                                    await message(String(e), { title: t("common.error"), kind: "error" });
                                                }
                                            }}
                                            className="px-3 py-2 bg-surface-secondary hover:bg-red-900/20 text-secondary hover:text-red-400 border border-strong hover:border-red-900/30 rounded text-sm font-medium transition-colors whitespace-nowrap"
                                            title={t("settings.ai.resetKey")}
                                        >
                                            {t("settings.ai.reset")}
                                        </button>
                                    )}
                                </div>
                            </div>
                            
                            {aiKeyStatus[settings.aiProvider]?.fromEnv && (
                                <p className="text-xs text-blue-400 mt-2 flex items-center gap-1.5">
                                    <Info size={12} />
                                    {t("settings.ai.envVariableDetected")}
                                </p>
                            )}
                            
                            <p className="text-xs text-muted mt-1">
                                {t("settings.ai.keyStoredSecurely")}
                            </p>
                        </div>
                      )}

                       {/* Custom OpenAI Endpoint URL */}
                       {settings.aiProvider === "custom-openai" && (
                           <div>
                               <label className="block text-sm font-medium text-secondary mb-1">
                                   {t("settings.ai.endpointUrl")}
                               </label>
                               <input
                                   type="text"
                                   value={settings.aiCustomOpenaiUrl || ""}
                                   onChange={(e) => updateSetting("aiCustomOpenaiUrl", e.target.value)}
                                   placeholder="https://api.example.com/v1"
                                   className="flex-1 bg-base border border-strong rounded px-3 py-2 text-primary text-sm focus:outline-none focus:border-blue-500 w-full"
                               />
                               <p className="text-xs text-muted mt-1">
                                   {t("settings.ai.endpointUrlDesc")}
                               </p>
                           </div>
                       )}

                        {/* Ollama Configuration */}
                       {settings.aiProvider === 'ollama' && (
                            <div className="space-y-4">
                                <div className={clsx(
                                   "border rounded px-3 py-2 text-sm italic flex items-center gap-2",
                                   (settings.aiCustomModels?.['ollama'] || availableModels['ollama'] || []).length > 0 
                                       ? "bg-green-900/10 border-green-900/20 text-green-400" 
                                       : "bg-red-900/10 border-red-900/20 text-red-400"
                                )}>
                                   {(settings.aiCustomModels?.['ollama'] || availableModels['ollama'] || []).length > 0 ? (
                                       <>
                                           <CheckCircle2 size={14} />
                                           <span>{t("settings.ai.ollamaConnected", { count: (settings.aiCustomModels?.['ollama'] || availableModels['ollama'] || []).length })}</span>
                                       </>
                                   ) : (
                                       <>
                                           <AlertTriangle size={14} />
                                           <span>{t("settings.ai.ollamaNotDetected", { port: settings.aiOllamaPort || 11434 })}</span>
                                       </>
                                   )}
                                </div>
                                
                                <div className="flex items-center gap-2">
                                   <label className="text-sm text-secondary whitespace-nowrap">
                                       {t("settings.ai.ollamaPort")}:
                                   </label>
                                   <input 
                                       type="number" 
                                       value={settings.aiOllamaPort || 11434}
                                       onChange={(e) => updateSetting("aiOllamaPort", parseInt(e.target.value) || 11434)}
                                       className="w-24 bg-base border border-strong rounded px-2 py-1.5 text-sm text-primary focus:outline-none focus:border-blue-500 transition-colors"
                                   />
                                   <p className="text-xs text-muted">
                                       (Default: 11434)
                                   </p>
                                </div>
                            </div>
                       )}
                    </div>
                  )}

                  {/* Model Selection */}
                  <div>
                    <label className="block text-sm font-medium text-secondary mb-1">
                      {t("settings.ai.defaultModel")}
                    </label>
                    {settings.aiProvider ? (
                        (() => {
                            const currentModels = settings.aiCustomModels?.[settings.aiProvider] || availableModels[settings.aiProvider] || [];
                            const isModelValid = !settings.aiModel || currentModels.includes(settings.aiModel);

                            return (
                                <>
                                    <div className="flex gap-2">
                                        <div className="flex-1">
                                            <Select
                                                value={settings.aiModel}
                                                onChange={(val) => updateSetting("aiModel", val)}
                                                options={currentModels}
                                                placeholder={t("settings.ai.modelPlaceholder")}
                                                searchPlaceholder={t("settings.ai.searchPlaceholder")}
                                                noResultsLabel={t("settings.ai.noResults")}
                                                hasError={!isModelValid && !!settings.aiModel}
                                            />
                                        </div>
                                        <button
                                            onClick={() => loadModels(true)}
                                            className="px-3 py-2 bg-surface-secondary hover:bg-surface-tertiary border border-default text-secondary hover:text-primary rounded transition-colors"
                                            title={t("settings.ai.refresh")}
                                        >
                                            <RefreshCw size={18} />
                                        </button>
                                    </div>
                                    {!isModelValid && settings.aiModel && (
                                        <div className="flex items-center gap-1.5 mt-2 text-xs text-red-400 bg-red-900/10 p-2 rounded border border-red-900/20">
                                            <AlertTriangle size={12} className="shrink-0" />
                                            <span>
                                                <Trans
                                                    i18nKey="settings.ai.modelNotFound"
                                                    values={{ model: settings.aiModel, provider: getProviderLabel(settings.aiProvider) }}
                                                    components={{ strong: <strong className="font-semibold" /> }}
                                                />
                                            </span>
                                        </div>
                                    )}
                                </>
                            );
                        })()
                    ) : (
                        <div className="text-sm text-muted italic px-3 py-2 border border-default rounded bg-base">
                            {t("settings.ai.selectProviderFirst")}
                        </div>
                    )}
                    <div className="flex justify-between items-center mt-1">
                        <p className="text-xs text-muted">
                            {settings.aiProvider === "custom-openai" 
                                ? t("settings.ai.customOpenaiModelHelp") 
                                : t("settings.ai.modelDesc")}
                        </p>
                    </div>
                  </div>

                  {/* System Prompt Configuration */}
                  <div className="border-t border-default pt-6 mt-6">
                    <h4 className="text-md font-medium text-primary mb-4 flex items-center gap-2">
                      <Code2 size={16} /> {t("settings.ai.systemPrompt")}
                    </h4>
                    <p className="text-xs text-secondary mb-4">
                      {t("settings.ai.systemPromptDesc")}
                    </p>

                    <div className="space-y-4">
                      <textarea
                        value={systemPrompt}
                        onChange={(e) => setSystemPrompt(e.target.value)}
                        className="w-full h-40 bg-base border border-strong rounded-lg p-3 text-primary text-sm font-mono focus:outline-none focus:border-blue-500 transition-colors resize-y"
                        placeholder={t("settings.ai.enterSystemPrompt")}
                      />
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={handleResetPrompt}
                                className="px-3 py-2 bg-surface-secondary hover:bg-surface-tertiary text-secondary rounded text-sm font-medium transition-colors border border-strong"
                            >
                                {t("settings.ai.resetDefault")}
                            </button>
                            <button
                                onClick={handleSavePrompt}
                                className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-medium transition-colors"
                            >
                                {t("settings.ai.savePrompt")}
                            </button>
                        </div>
                     </div>
                  </div>

                  {/* Explain Prompt Configuration */}
                  <div className="border-t border-default pt-6 mt-6">
                     <h4 className="text-md font-medium text-primary mb-4 flex items-center gap-2">
                        <Code2 size={16} /> {t("settings.ai.explainPrompt")}
                     </h4>
                     <p className="text-xs text-secondary mb-4">
                        {t("settings.ai.explainPromptDesc")}
                     </p>
                     
                     <div className="space-y-4">
                        <textarea 
                           value={explainPrompt}
                           onChange={(e) => setExplainPrompt(e.target.value)}
                           className="w-full h-40 bg-base border border-strong rounded-lg p-3 text-primary text-sm font-mono focus:outline-none focus:border-blue-500 transition-colors resize-y"
                           placeholder={t("settings.ai.enterExplainPrompt")}
                        />
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={handleResetExplainPrompt}
                                className="px-3 py-2 bg-surface-secondary hover:bg-surface-tertiary text-secondary rounded text-sm font-medium transition-colors border border-strong"
                            >
                                {t("settings.ai.resetDefault")}
                            </button>
                            <button
                                onClick={handleSaveExplainPrompt}
                                className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-medium transition-colors"
                            >
                                {t("settings.ai.savePrompt")}
                            </button>
                        </div>
                     </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Logs Tab */}
          {activeTab === "logs" && <LogsTab />}

          {/* Shortcuts Tab */}
          {activeTab === "shortcuts" && <ShortcutsTab />}

          {/* Plugins Tab */}
          {activeTab === "plugins" && (
          <div className="space-y-8">
            {/* Available Plugins */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-primary">{t("settings.plugins.available")}</h2>
                <button
                  onClick={() => refreshRegistry()}
                  className="text-xs text-muted hover:text-primary flex items-center gap-1 transition-colors"
                >
                  <RefreshCw size={12} />
                  {t("settings.plugins.refresh")}
                </button>
              </div>
              <p className="text-xs text-muted mb-4">
                {t("settings.plugins.availableDesc")}
              </p>

              {registryLoading && (
                <div className="flex items-center gap-2 text-muted text-sm py-4">
                  <Loader2 size={16} className="animate-spin" />
                  {t("settings.plugins.loadingRegistry")}
                </div>
              )}

              {registryError && (
                <div className="bg-red-900/20 border border-red-900/50 text-red-400 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
                  <AlertTriangle size={16} />
                  {t("settings.plugins.registryError")}: {registryError}
                </div>
              )}

              {!registryLoading && !registryError && (
                <div className="space-y-3">
                  {registryPlugins.map((plugin) => {
                    const platformReleases = plugin.releases.filter((r) => r.platform_supported);
                    // Versions that can actually be installed: exclude the one already installed
                    const installableReleases = platformReleases.filter((r) => r.version !== plugin.installed_version);
                    const isAtLatest = !!plugin.installed_version && plugin.installed_version === plugin.latest_version;
                    // selectedVer: when already at latest, default to latest (shows "up to date");
                    // otherwise default to the latest installable version
                    const defaultVer = isAtLatest
                      ? plugin.latest_version
                      : installableReleases.find((r) => r.version === plugin.latest_version)?.version
                        ?? installableReleases[0]?.version
                        ?? plugin.latest_version;
                    const selectedVer = selectedVersions[plugin.id] ?? defaultVer;
                    const selectedRelease = plugin.releases.find((r) => r.version === selectedVer);
                    const selectedPlatformSupported = selectedRelease?.platform_supported ?? false;
                    const isSelectedInstalled = plugin.installed_version === selectedVer;
                    const minVersion = selectedRelease?.min_tabularis_version ?? null;
                    const isCompatible = !minVersion || versionGte(APP_VERSION, minVersion);
                    const isUpdate = !!plugin.installed_version && !isSelectedInstalled;
                    const isDowngrade = isUpdate && !versionGte(selectedVer, plugin.installed_version!);
                    // Show version picker: always when at latest (for optional downgrade),
                    // otherwise only when 2+ installable versions exist
                    const showVersionPicker = isAtLatest ? installableReleases.length >= 1 : installableReleases.length > 1;

                    const doInstall = async () => {
                      setInstallingPluginId(plugin.id);
                      try {
                        await invoke("install_plugin", { pluginId: plugin.id, version: selectedVer });
                        refreshRegistry();
                        refreshDrivers();
                      } catch (err) {
                        setPluginInstallError({ pluginId: plugin.id, error: String(err) });
                      } finally {
                        setInstallingPluginId(null);
                      }
                    };

                    // The installed version badge shown inline with the name
                    const installedBadge = plugin.installed_version ? (
                      <span className="text-[10px] font-medium bg-green-500/10 text-green-400 border border-green-500/20 px-1.5 py-px rounded-md">
                        {t("settings.plugins.installed")} v{plugin.installed_version}
                      </span>
                    ) : undefined;

                    return (
                      <PluginCard
                        key={plugin.id}
                        name={plugin.name}
                        description={plugin.description}
                        version={undefined}
                        author={plugin.author}
                        homepage={plugin.homepage}
                        status={installedBadge}
                        actions={
                          !selectedPlatformSupported ? (
                            <span className="text-xs text-muted italic text-right">{t("settings.plugins.platformNotSupported")}</span>
                          ) : (
                            <>
                              {/* Up to date indicator */}
                              {isSelectedInstalled && selectedVer === plugin.latest_version && (
                                <div className="flex items-center justify-center gap-1.5">
                                  <CheckCircle2 size={12} className="text-green-400" />
                                  <span className="text-xs text-green-400 font-medium">{t("settings.plugins.upToDate")}</span>
                                </div>
                              )}

                              {/* Action button — only when a non-installed version is selected */}
                              {!isSelectedInstalled && (
                                isCompatible ? (
                                  <button
                                    onClick={doInstall}
                                    disabled={installingPluginId === plugin.id}
                                    className={`w-full flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium text-white transition-colors disabled:opacity-50 ${
                                      isDowngrade
                                        ? "bg-amber-600 hover:bg-amber-500"
                                        : isUpdate
                                        ? "bg-green-600 hover:bg-green-500"
                                        : "bg-blue-600 hover:bg-blue-500"
                                    }`}
                                  >
                                    {installingPluginId === plugin.id ? (
                                      <Loader2 size={12} className="animate-spin" />
                                    ) : isDowngrade ? (
                                      <RotateCcw size={12} />
                                    ) : isUpdate ? (
                                      <RefreshCw size={12} />
                                    ) : (
                                      <Download size={12} />
                                    )}
                                    {isDowngrade
                                      ? `${t("settings.plugins.downgrade")} v${selectedVer}`
                                      : isUpdate
                                      ? `${t("settings.plugins.update")} v${selectedVer}`
                                      : `${t("settings.plugins.install")} v${selectedVer}`}
                                  </button>
                                ) : (
                                  /* Incompatible: disabled button + requirement note */
                                  <div className="w-full flex flex-col items-end gap-1">
                                    <button
                                      disabled
                                      title={t("settings.plugins.requiresVersion", { version: minVersion })}
                                      className="w-full flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium text-muted bg-surface-tertiary cursor-not-allowed opacity-50"
                                    >
                                      <Download size={12} />
                                      {t("settings.plugins.install")} v{selectedVer}
                                    </button>
                                    <span className="text-[10px] text-amber-400/80 text-right">
                                      {t("settings.plugins.requiresVersion", { version: minVersion })}
                                    </span>
                                  </div>
                                )
                              )}

                              {/* Version picker — for downgrades when at latest, or between multiple installable versions */}
                              {showVersionPicker && (() => {
                                const dropdownOptions: VersionOption[] = [
                                  ...(isAtLatest ? [{ version: plugin.latest_version!, isInstalled: true, isLatest: true }] : []),
                                  ...[...installableReleases].reverse().map((r) => ({
                                    version: r.version,
                                    isInstalled: false,
                                    isLatest: r.version === plugin.latest_version,
                                  })),
                                ];
                                return (
                                  <VersionDropdown
                                    options={dropdownOptions}
                                    value={selectedVer}
                                    onChange={(v) => setSelectedVersions((prev) => ({ ...prev, [plugin.id]: v }))}
                                    isDowngrade={isDowngrade}
                                    label={isAtLatest && isSelectedInstalled ? t("settings.plugins.olderVersions") : `v${selectedVer}`}
                                  />
                                );
                              })()}
                            </>
                          )
                        }
                      />
                    );
                  })}
                  {registryPlugins.length === 0 && (
                    <p className="text-sm text-muted py-4">{t("settings.plugins.noPlugins")}</p>
                  )}
                </div>
              )}
            </div>

            {/* Installed Plugins */}
            <div>
              <h2 className="text-xl font-semibold text-primary mb-4">{t("settings.plugins.installedPlugins")}</h2>
              <p className="text-xs text-muted mb-4">
                {t("settings.plugins.installedDesc")}
              </p>

              <div className="space-y-3">
                {allDrivers.map((driver: PluginManifest) => {
                  const isBuiltin = driver.is_builtin === true;
                  const registryPlugin = registryPlugins.find(p => p.id === driver.id);
                  const activeExt = settings.activeExternalDrivers || [];
                  const isEnabled = isBuiltin || activeExt.includes(driver.id);

                  const builtinBadge = isBuiltin ? (
                    <span className="text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20 px-1.5 py-px rounded-md">Built-in</span>
                  ) : undefined;

                  return (
                    <PluginCard
                      key={driver.id}
                      name={driver.name}
                      description={driver.description}
                      version={driver.version}
                      author={!isBuiltin ? registryPlugin?.author : undefined}
                      homepage={!isBuiltin ? registryPlugin?.homepage : undefined}
                      dimmed={isBuiltin}
                      status={builtinBadge}
                      actions={
                        <div className="flex flex-col items-end gap-2 w-full">
                          {/* Enable / Disable toggle */}
                          <button
                              onClick={async () => {
                                if (isBuiltin) return;
                                try {
                                  if (isEnabled) {
                                    await invoke("disable_plugin", { pluginId: driver.id });
                                    updateSetting("activeExternalDrivers", activeExt.filter(id => id !== driver.id));
                                  } else {
                                    await invoke("enable_plugin", { pluginId: driver.id });
                                    updateSetting("activeExternalDrivers", [...activeExt, driver.id]);
                                  }
                                } catch (err) {
                                  setPluginStartError({ pluginId: driver.id, pluginName: driver.name, error: String(err) });
                                }
                              }}
                              disabled={isBuiltin}
                              aria-label={isEnabled ? "Disable plugin" : "Enable plugin"}
                              className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                                isEnabled ? "bg-blue-600" : "bg-surface-tertiary"
                              } ${isBuiltin ? "cursor-not-allowed" : "cursor-pointer"}`}
                            >
                              <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition duration-200 ease-in-out ${isEnabled ? "translate-x-4" : "translate-x-0"}`} />
                            </button>
                          {/* Plugin settings */}
                          {!isBuiltin && (
                            <button
                              onClick={() => handleOpenPluginSettings(driver.id, driver.name)}
                              className="p-1.5 text-secondary hover:text-primary transition-colors"
                              title={t("settings.plugins.pluginSettings.title")}
                            >
                              <SettingsIcon size={15} />
                            </button>
                          )}
                          {/* Plugin UI extension slot */}
                          {!isBuiltin && (
                            <SlotAnchor
                              name="settings.plugin.actions"
                              context={{ targetPluginId: driver.id }}
                              className="flex flex-col items-end gap-1"
                            />
                          )}
                          {/* Remove link */}
                          {!isBuiltin && (
                            <button
                              onClick={() => setPluginRemoveConfirm({
                                pluginId: driver.id,
                                pluginName: driver.name,
                                onConfirm: async () => {
                                  setUninstallingPluginId(driver.id);
                                  setPluginRemoveConfirm(null);
                                  try {
                                    const toDisconnect = findConnectionsForDrivers(openConnectionIds, connectionDataMap, [driver.id]);
                                    await Promise.all(toDisconnect.map(id => disconnect(id)));
                                    await invoke("uninstall_plugin", { pluginId: driver.id });
                                    refreshDrivers();
                                    refreshRegistry();
                                  } catch (err) {
                                    setPluginInstallError({ pluginId: driver.id, error: String(err) });
                                  } finally {
                                    setUninstallingPluginId(null);
                                  }
                                },
                              })}
                              disabled={uninstallingPluginId === driver.id}
                              className="flex items-center gap-1 text-[11px] text-red-500/70 hover:text-red-400 disabled:opacity-50 transition-colors"
                            >
                              {uninstallingPluginId === driver.id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                              {t("settings.plugins.remove")}
                            </button>
                          )}
                        </div>
                      }
                    />
                  );
                })}

                {/* Disabled (installed but not running) external plugins */}
                {installedPlugins
                  .filter(p => !allDrivers.some(d => d.id === p.id))
                  .map(plugin => {
                    const activeExt = settings.activeExternalDrivers || [];
                    const registryPlugin = registryPlugins.find(r => r.id === plugin.id);
                    return (
                      <PluginCard
                        key={plugin.id}
                        name={plugin.name}
                        description={plugin.description}
                        version={plugin.version}
                        author={registryPlugin?.author}
                        homepage={registryPlugin?.homepage}
                        actions={
                          <div className="flex flex-col items-end gap-2 w-full">
                            {/* Enable toggle */}
                              <button
                                onClick={async () => {
                                  try {
                                    await invoke("enable_plugin", { pluginId: plugin.id });
                                    updateSetting("activeExternalDrivers", [...activeExt, plugin.id]);
                                    refreshDrivers();
                                  } catch (err) {
                                    setPluginStartError({ pluginId: plugin.id, pluginName: plugin.name, error: String(err) });
                                  }
                                }}
                                aria-label="Enable plugin"
                                className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-surface-tertiary transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                              >
                                <span className="pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition duration-200 ease-in-out translate-x-0" />
                              </button>
                            {/* Plugin settings */}
                            <button
                              onClick={() => handleOpenPluginSettings(plugin.id, plugin.name)}
                              className="p-1.5 text-secondary hover:text-primary transition-colors"
                              title={t("settings.plugins.pluginSettings.title")}
                            >
                              <SettingsIcon size={15} />
                            </button>
                            {/* Plugin UI extension slot */}
                            <SlotAnchor
                              name="settings.plugin.actions"
                              context={{ targetPluginId: plugin.id }}
                              className="flex flex-col items-end gap-1"
                            />
                            {/* Remove link */}
                            <button
                              onClick={() => setPluginRemoveConfirm({
                                pluginId: plugin.id,
                                pluginName: plugin.name,
                                onConfirm: async () => {
                                  setUninstallingPluginId(plugin.id);
                                  setPluginRemoveConfirm(null);
                                  try {
                                    await invoke("uninstall_plugin", { pluginId: plugin.id });
                                    updateSetting("activeExternalDrivers", activeExt.filter(id => id !== plugin.id));
                                    refreshDrivers();
                                    refreshRegistry();
                                  } catch (err) {
                                    setPluginInstallError({ pluginId: plugin.id, error: String(err) });
                                  } finally {
                                    setUninstallingPluginId(null);
                                  }
                                },
                              })}
                              disabled={uninstallingPluginId === plugin.id}
                              className="flex items-center gap-1 text-[11px] text-red-500/70 hover:text-red-400 disabled:opacity-50 transition-colors"
                            >
                              {uninstallingPluginId === plugin.id ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                              {t("settings.plugins.remove")}
                            </button>
                          </div>
                        }
                      />
                    );
                  })}

              </div>
            </div>
          </div>
        )}

        {activeTab === "info" && (
            <div className="space-y-8">
              {/* Header / Hero */}
              <div className="bg-gradient-to-br from-blue-900/20 to-elevated border border-blue-500/20 rounded-2xl p-8 text-center relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10">
                  <Code2 size={120} />
                </div>

                <div className="p-2">
                  <img
                    src="/logo.png"
                    alt="tabularis"
                    className="w-16 h-16 rounded-2xl mx-auto mb-4 shadow-lg shadow-blue-500/30"
                    style={{
                      backgroundColor: !currentTheme?.id?.includes('-light')
                        ? currentTheme?.colors?.surface?.secondary || '#334155'
                        : currentTheme?.colors?.bg?.elevated || '#f8fafc'
                    }}
                  />
                </div>

                <h1 className="text-3xl font-bold text-primary mb-2">
                  tabularis
                </h1>
                <p className="text-secondary max-w-lg mx-auto mb-6">
                  A lightweight, developer-focused database manager built with
                  Tauri, Rust, and React. Born from a "vibe coding" experiment
                  to create a modern, native tool in record time.
                </p>

                <div className="flex justify-center gap-4">
                  <button
                    onClick={() =>
                      openUrl("https://github.com/debba/tabularis")
                    }
                    className="flex items-center gap-2 bg-surface-secondary hover:bg-surface-tertiary text-primary px-4 py-2 rounded-lg font-medium transition-colors border border-strong"
                  >
                    <Github size={18} />
                    {t("settings.starOnGithub")}
                  </button>
                  <div className="flex items-center gap-2 bg-accent/10 text-accent px-4 py-2 rounded-lg border border-accent/30">
                    <span className="text-xs font-bold uppercase tracking-wider">
                      {t("settings.version")}
                    </span>
                    <span className="font-mono font-bold">
                      {APP_VERSION} (Beta)
                    </span>
                  </div>
                </div>
              </div>

              {/* Updates */}
              <div className="bg-elevated border border-default rounded-xl p-6">
                <h3 className="text-lg font-semibold text-primary mb-4 flex items-center gap-2">
                  <Download size={20} className="text-blue-400" />
                  {t("settings.updates")}
                </h3>

                <div className="space-y-4">
                  {/* Current Version */}
                  <div className="bg-base p-4 rounded-lg border border-default">
                    <div className="text-sm text-secondary">{t("settings.currentVersion")}</div>
                    <div className="text-lg font-mono text-primary mt-1">v{APP_VERSION}</div>
                  </div>

                  {installationSource ? (
                    /* Managed package: AUR, Snap, Flatpak — disable built-in update UI */
                    <div className="bg-yellow-900/20 border border-yellow-900/50 text-yellow-400 px-4 py-3 rounded-lg">
                      <div className="text-sm font-medium">
                        {t("update.managedByPackageManager", { source: { aur: "AUR", snap: "Snap Store", flatpak: "Flathub" }[installationSource] ?? installationSource })}
                      </div>
                      <div className="text-xs mt-1 text-yellow-400/70">
                        {t("update.managedByPackageManagerDesc")}
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Auto Check Toggle */}
                      <div className="flex items-center justify-between bg-base p-4 rounded-lg border border-default">
                        <div>
                          <div className="text-sm text-primary font-medium">
                            {t("settings.autoCheckUpdates")}
                          </div>
                          <div className="text-xs text-muted mt-1">
                            {t("settings.autoCheckUpdatesDesc")}
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={settings.autoCheckUpdatesOnStartup !== false}
                          onChange={(e) => updateSetting("autoCheckUpdatesOnStartup", e.target.checked)}
                          className="w-10 h-6 bg-base border border-strong rounded-full appearance-none cursor-pointer relative transition-colors checked:bg-blue-600 checked:border-blue-600 after:content-[''] after:absolute after:top-1 after:left-1 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-transform checked:after:translate-x-4"
                        />
                      </div>

                      {/* Manual Check Button */}
                      <button
                        onClick={() => checkForUpdates(true)}
                        disabled={isChecking}
                        className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                      >
                        {isChecking ? (
                          <>
                            <Loader2 size={16} className="animate-spin" />
                            {t("settings.checking")}
                          </>
                        ) : (
                          <>
                            <Download size={16} />
                            {t("settings.checkNow")}
                          </>
                        )}
                      </button>

                      {/* Up to Date Message */}
                      {isUpToDate && !updateInfo && (
                        <div className="bg-blue-900/20 border border-blue-900/50 text-blue-400 px-4 py-3 rounded-lg flex items-center gap-2">
                          <CheckCircle2 size={16} />
                          <span className="text-sm">
                            {t("update.upToDate")}
                          </span>
                        </div>
                      )}

                      {/* Update Available Message */}
                      {updateInfo && (
                        <div className="bg-green-900/20 border border-green-900/50 text-green-400 px-4 py-3 rounded-lg flex items-center gap-2">
                          <CheckCircle2 size={16} />
                          <span className="text-sm">
                            {t("update.updateAvailable", { version: updateInfo.latestVersion })}
                          </span>
                        </div>
                      )}

                      {/* Error Message */}
                      {updateError && (
                        <div className="bg-red-900/20 border border-red-900/50 text-red-400 px-4 py-3 rounded-lg text-sm">
                          {updateError}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Roadmap / Status */}
              <div>
                <h2 className="text-xl font-bold text-primary mb-4 flex items-center gap-2">
                  <Info size={20} className="text-blue-400" />
                  {t("settings.projectStatus")}
                </h2>
                <div className="bg-elevated border border-default rounded-xl overflow-hidden">
                  <div className="p-4 border-b border-default bg-surface-secondary/50">
                    <p className="text-sm text-secondary">
                      {t("settings.roadmapDesc")}
                    </p>
                  </div>
                  <div className="divide-y divide-default">
                    {ROADMAP.map((item, i) => {
                      const content = (
                        <>
                          {item.done ? (
                            <CheckCircle2 size={18} className="text-green-500 shrink-0" />
                          ) : (
                            <Circle size={18} className="text-surface-tertiary shrink-0" />
                          )}
                          <span
                            className={clsx(
                              "flex-1 text-left",
                              item.done ? "text-primary" : "text-muted"
                            )}
                          >
                            {item.label}
                          </span>
                          {item.url && (
                            <ExternalLink size={14} className="text-surface-tertiary opacity-0 group-hover:opacity-100 transition-opacity" />
                          )}
                        </>
                      );

                      if (item.url) {
                        return (
                          <button
                            key={i}
                            onClick={() => openUrl(item.url!)}
                            className="w-full p-4 flex items-center gap-3 hover:bg-surface-secondary/30 transition-colors group cursor-pointer"
                          >
                            {content}
                          </button>
                        );
                      }

                      return (
                        <div
                          key={i}
                          className="p-4 flex items-center gap-3 hover:bg-surface-secondary/30 transition-colors group"
                        >
                          {content}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Task Manager */}
              <div className="bg-elevated border border-default rounded-xl p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-blue-500/20 border border-blue-500/30">
                      <Activity size={18} className="text-blue-400" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-primary">
                        {t("taskManager.header.title")}
                      </h3>
                      <p className="text-xs text-muted">
                        {t("taskManager.header.description")}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => invoke("open_task_manager_window")}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-blue-500/15 border border-blue-500/25 text-blue-400 hover:bg-blue-500/25 transition-colors"
                  >
                    <Activity size={14} />
                    {t("taskManager.header.open")}
                  </button>
                </div>
              </div>

              {/* Support */}

              <div className="bg-elevated/50 border border-default rounded-xl p-6 flex flex-col items-center text-center">
                <Heart size={32} className="text-red-500 mb-3 animate-pulse" />
                <h3 className="text-lg font-semibold text-primary mb-2">
                  {t("settings.support")}
                </h3>
                <p className="text-secondary text-sm mb-4 max-w-md">
                  {t("settings.supportDesc")}
                </p>
                <button
                  onClick={() => openUrl("https://github.com/debba/tabularis")}
                  className="text-blue-400 hover:text-blue-300 font-medium text-sm hover:underline"
                >
                  github.com/debba/tabularis
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <PluginInstallErrorModal
        isOpen={pluginInstallError !== null}
        onClose={() => setPluginInstallError(null)}
        pluginId={pluginInstallError?.pluginId ?? ""}
        error={pluginInstallError?.error ?? ""}
      />
      <PluginRemoveModal
        isOpen={pluginRemoveConfirm !== null}
        onClose={() => setPluginRemoveConfirm(null)}
        pluginName={pluginRemoveConfirm?.pluginName ?? ""}
        onConfirm={() => pluginRemoveConfirm?.onConfirm()}
      />
      <PluginSettingsModal
        key={pluginSettingsModal?.pluginId}
        isOpen={pluginSettingsModal !== null}
        onClose={() => { setPluginSettingsModal(null); setOpenModalManifest(undefined); }}
        pluginId={pluginSettingsModal?.pluginId ?? ""}
        pluginName={pluginSettingsModal?.pluginName ?? ""}
        currentConfig={settings.plugins?.[pluginSettingsModal?.pluginId ?? ""]}
        manifest={openModalManifest}
        onSave={(config) => handleSavePluginConfig(pluginSettingsModal?.pluginId ?? "", pluginSettingsModal?.pluginName ?? "", config)}
      />
      <PluginStartErrorModal
        isOpen={pluginStartError !== null}
        onClose={() => setPluginStartError(null)}
        pluginId={pluginStartError?.pluginId ?? ""}
        error={pluginStartError?.error ?? ""}
        onConfigureInterpreter={pluginStartError ? () => handleOpenPluginSettings(pluginStartError.pluginId, pluginStartError.pluginName) : undefined}
      />
    </div>
  );
};
