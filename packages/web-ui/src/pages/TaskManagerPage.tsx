import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import {
  Activity,
  RefreshCw,
  Cpu,
  MemoryStick,
  HardDrive,
  Layers,
  Square,
  RotateCcw,
  Loader2,
  AlertCircle,
  Plug,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  X,
  TriangleAlert,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import clsx from "clsx";
import { useTaskManager } from "../hooks/useTaskManager";
import {
  formatBytes,
  formatCpuPercent,
  formatMemoryBar,
  getStatusBadgeColor,
  sortProcesses,
} from "../utils/taskManager";
import type { ProcessInfo, ProcessSortKey, TabularisSelfStats, ChildProcessInfo, TabularisChildProcess } from "../utils/taskManager";


// ---------------------------------------------------------------------------
// Kill confirm modal
// ---------------------------------------------------------------------------
interface KillConfirmModalProps {
  pluginName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const KillConfirmModal = ({ pluginName, onConfirm, onCancel }: KillConfirmModalProps) => {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[200] backdrop-blur-sm">
      <div className="bg-elevated border border-strong rounded-xl shadow-2xl w-[420px] overflow-hidden">
        <div className="flex items-center gap-3 p-4 border-b border-default bg-base">
          <div className="p-2 rounded-lg bg-red-500/20 border border-red-500/30">
            <TriangleAlert size={18} className="text-red-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-primary">{t("taskManager.killModal.title")}</h3>
            <p className="text-xs text-muted">{t("taskManager.killModal.subtitle")}</p>
          </div>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-surface-secondary/50 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-sm text-secondary">
            {t("taskManager.killModal.descriptionBefore")}{" "}
            <span className="font-semibold text-primary">{pluginName}</span>{" "}
            {t("taskManager.killModal.descriptionAfter")}
          </p>
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
            <TriangleAlert size={14} className="shrink-0 mt-0.5" />
            <span>{t("taskManager.killModal.warning")}</span>
          </div>
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-default bg-base/50">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm text-muted hover:text-primary hover:bg-surface-secondary/50 transition-colors"
          >
            {t("taskManager.killModal.cancel")}
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500/15 border border-red-500/25 text-red-400 hover:bg-red-500/25 transition-colors"
          >
            {t("taskManager.killModal.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Tabularis self stats panel
// ---------------------------------------------------------------------------
const TabularisSelfPanel = ({ stats }: { stats: TabularisSelfStats }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<TabularisChildProcess[]>([]);
  const [loadingChildren, setLoadingChildren] = useState(false);
  const hasChildren = stats.child_count > 0;

  const fetchChildren = useCallback(async () => {
    setLoadingChildren(true);
    try {
      const result = await invoke<TabularisChildProcess[]>("get_tabularis_children");
      setChildren(result);
    } finally {
      setLoadingChildren(false);
    }
  }, []);

  const handleToggle = useCallback(() => {
    if (!hasChildren) return;
    if (!expanded) {
      fetchChildren();
    }
    setExpanded((v) => !v);
  }, [expanded, hasChildren, fetchChildren]);

  return (
    <div className="bg-elevated border border-default rounded-xl p-5">
      <h2 className="text-sm font-semibold text-primary mb-4 flex items-center gap-2">
        <Activity size={15} className="text-blue-400" />
        {t("taskManager.tabularisProcess.title")}
        <span className="ml-auto text-xs text-muted font-mono">PID {stats.pid}</span>
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          icon={<Cpu size={14} className="text-blue-400" />}
          label={t("taskManager.tabularisProcess.cpu")}
          value={formatCpuPercent(stats.cpu_percent)}
        />
        <StatCard
          icon={<MemoryStick size={14} className="text-purple-400" />}
          label={t("taskManager.tabularisProcess.ram")}
          value={formatBytes(stats.self_memory_bytes)}
        />
        <StatCard
          icon={<HardDrive size={14} className="text-green-400" />}
          label={t("taskManager.tabularisProcess.diskRead")}
          value={formatBytes(stats.disk_read_bytes)}
          suffix="/s"
        />
        <StatCard
          icon={<HardDrive size={14} className="text-orange-400" />}
          label={t("taskManager.tabularisProcess.diskWrite")}
          value={formatBytes(stats.disk_write_bytes)}
          suffix="/s"
        />
      </div>

      {/* Footer: child count + expand toggle */}
      <button
        onClick={handleToggle}
        className={clsx(
          "mt-3 w-full flex items-center gap-1.5 text-xs text-muted",
          hasChildren && "hover:text-primary transition-colors cursor-pointer",
        )}
      >
        {hasChildren ? (
          expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />
        ) : (
          <Layers size={12} />
        )}
        {stats.child_count > 0
          ? t("taskManager.tabularisProcess.childCount", { count: stats.child_count })
          : t("taskManager.tabularisProcess.noChildren")}
        {stats.child_count > 0 && (
          <span
            className="ml-auto opacity-60"
            title={t("taskManager.tabularisProcess.treeTotalTooltip")}
          >
            {t("taskManager.tabularisProcess.treeTotal", { size: formatBytes(stats.total_memory_bytes) })}
          </span>
        )}
      </button>

      {/* Expanded child process list */}
      {expanded && (
        <div className="mt-3 rounded-lg border border-default overflow-hidden">
          {loadingChildren ? (
            <div className="flex items-center justify-center gap-2 py-6 text-muted text-xs">
              <Loader2 size={14} className="animate-spin" />
              {t("taskManager.tabularisProcess.loadingProcesses")}
            </div>
          ) : (
            <>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-default bg-base/50">
                    <th className="px-3 py-2 text-left font-medium text-muted uppercase tracking-wide">{t("taskManager.tabularisProcess.colPid")}</th>
                    <th className="px-3 py-2 text-left font-medium text-muted uppercase tracking-wide">{t("taskManager.tabularisProcess.colName")}</th>
                    <th className="px-3 py-2 text-left font-medium text-muted uppercase tracking-wide">{t("taskManager.tabularisProcess.colCpu")}</th>
                    <th className="px-3 py-2 text-left font-medium text-muted uppercase tracking-wide">{t("taskManager.tabularisProcess.colRam")}</th>
                    <th className="px-3 py-2 text-right font-medium text-muted uppercase tracking-wide">
                      <button
                        onClick={fetchChildren}
                        className="inline-flex items-center gap-1 hover:text-primary transition-colors"
                        title={t("taskManager.tabularisProcess.refresh")}
                      >
                        <RefreshCw size={11} className={clsx(loadingChildren && "animate-spin")} />
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-default">
                  {children.map((child: TabularisChildProcess) => (
                    <tr key={child.pid} className="hover:bg-surface-secondary/20 transition-colors">
                      <td className="px-3 py-1.5 font-mono text-muted">{child.pid}</td>
                      <td className="px-3 py-1.5 text-secondary max-w-[160px] truncate" title={child.name}>
                        {child.name}
                      </td>
                      <td className="px-3 py-1.5 text-secondary">{formatCpuPercent(child.cpu_percent)}</td>
                      <td className="px-3 py-1.5 text-secondary">{formatBytes(child.memory_bytes)}</td>
                      <td className="px-3 py-1.5" />
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
};

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  suffix?: string;
}

const StatCard = ({ icon, label, value, suffix }: StatCardProps) => (
  <div className="bg-base rounded-lg p-3 border border-default">
    <div className="flex items-center gap-2 mb-2">
      {icon}
      <span className="text-xs text-muted font-medium uppercase tracking-wide">{label}</span>
    </div>
    <p className="text-lg font-bold text-primary">
      {value}
      {suffix && <span className="text-xs font-normal text-muted ml-1">{suffix}</span>}
    </p>
  </div>
);

// ---------------------------------------------------------------------------
// Sort header cell
// ---------------------------------------------------------------------------
interface ThProps {
  label: string;
  col: ProcessSortKey;
  current: ProcessSortKey;
  asc: boolean;
  onClick: (col: ProcessSortKey) => void;
}

const Th = ({ label, col, current, asc, onClick }: ThProps) => (
  <th
    className="px-4 py-3 text-left text-xs font-medium text-muted uppercase tracking-wide cursor-pointer hover:text-primary select-none"
    onClick={() => onClick(col)}
  >
    <span className="flex items-center gap-1">
      {label}
      {current === col ? (
        asc ? (
          <ArrowUp size={12} className="text-blue-400" />
        ) : (
          <ArrowDown size={12} className="text-blue-400" />
        )
      ) : (
        <ArrowUpDown size={12} className="opacity-40" />
      )}
    </span>
  </th>
);

// ---------------------------------------------------------------------------
// Child process row
// ---------------------------------------------------------------------------
const ChildRow = ({ child }: { child: ChildProcessInfo }) => {
  const { t } = useTranslation();
  return (
    <tr className="bg-base/40">
      <td className="px-4 py-2 pl-8">
        <div className="flex items-center gap-1.5 text-xs text-muted">
          <span className="opacity-50">└</span>
          <span>{t("taskManager.pluginProcesses.childProcess")}</span>
        </div>
      </td>
      <td className="px-4 py-2 text-muted font-mono text-xs">{child.pid}</td>
      <td className="px-4 py-2 text-secondary text-xs">{formatCpuPercent(child.cpu_percent)}</td>
      <td className="px-4 py-2 text-secondary text-xs">{formatBytes(child.memory_bytes)}</td>
      <td className="px-4 py-2 text-secondary text-xs">
        <span className="text-green-400">{formatBytes(child.disk_read_bytes)}/s</span>
        {" / "}
        <span className="text-orange-400">{formatBytes(child.disk_write_bytes)}/s</span>
      </td>
      <td className="px-4 py-2">
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/20 text-green-400 border border-green-500/30">
          {t("taskManager.pluginProcesses.status.running")}
        </span>
      </td>
      <td className="px-4 py-2" />
    </tr>
  );
};

// ---------------------------------------------------------------------------
// Process table row
// ---------------------------------------------------------------------------
interface ProcessRowProps {
  proc: ProcessInfo;
  isKilling: boolean;
  isRestarting: boolean;
  onKillRequest: (proc: ProcessInfo) => void;
  onRestart: (id: string) => void;
}

const ProcessRow = ({
  proc,
  isKilling,
  isRestarting,
  onKillRequest,
  onRestart,
}: ProcessRowProps) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const busy = isKilling || isRestarting;
  const hasChildren = proc.children.length > 0;

  return (
    <>
      <tr className="hover:bg-surface-secondary/30 transition-colors">
        <td className="px-4 py-3 font-medium text-primary">
          <div className="flex items-center gap-1">
            {hasChildren ? (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="p-0.5 rounded text-muted hover:text-primary transition-colors shrink-0"
                title={
                  expanded
                    ? t("taskManager.pluginProcesses.collapseChildren")
                    : t("taskManager.pluginProcesses.childCount", { count: proc.children.length })
                }
              >
                {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>
            ) : (
              <span className="w-4 shrink-0" />
            )}
            {proc.plugin_name}
            {hasChildren && (
              <span className="ml-1.5 text-xs text-muted font-normal opacity-60">
                +{proc.children.length}
              </span>
            )}
          </div>
        </td>
        <td className="px-4 py-3 text-muted font-mono text-xs">{proc.pid ?? "—"}</td>
        <td className="px-4 py-3 text-secondary">{formatCpuPercent(proc.cpu_percent)}</td>
        <td className="px-4 py-3 text-secondary">{formatBytes(proc.memory_bytes)}</td>
        <td className="px-4 py-3 text-secondary text-xs">
          <span className="text-green-400">{formatBytes(proc.disk_read_bytes)}/s</span>
          {" / "}
          <span className="text-orange-400">{formatBytes(proc.disk_write_bytes)}/s</span>
        </td>
        <td className="px-4 py-3">
          <span
            className={clsx(
              "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
              getStatusBadgeColor(proc.status),
            )}
          >
            {t(`taskManager.pluginProcesses.status.${proc.status}`, proc.status)}
          </span>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => onRestart(proc.plugin_id)}
              disabled={busy}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs bg-blue-500/10 border border-blue-500/20 text-blue-400 hover:bg-blue-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={t("taskManager.pluginProcesses.restart")}
            >
              {isRestarting ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RotateCcw size={12} />
              )}
              {t("taskManager.pluginProcesses.restart")}
            </button>
            <button
              onClick={() => onKillRequest(proc)}
              disabled={busy}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={t("taskManager.killModal.confirm")}
            >
              {isKilling ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Square size={12} />
              )}
              {t("taskManager.pluginProcesses.kill")}
            </button>
          </div>
        </td>
      </tr>
      {expanded && proc.children.map((child) => (
        <ChildRow key={child.pid} child={child} />
      ))}
    </>
  );
};

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export const TaskManagerPage = () => {
  const { t } = useTranslation();
  const {
    processes,
    systemStats,
    loading,
    error,
    killing,
    restarting,
    refresh,
    killProcess,
    restartProcess,
  } = useTaskManager();

  const [sortKey, setSortKey] = useState<ProcessSortKey>("plugin_name");
  const [sortAsc, setSortAsc] = useState(true);
  const [killTarget, setKillTarget] = useState<ProcessInfo | null>(null);

  const handleSort = (key: ProcessSortKey) => {
    if (sortKey === key) {
      setSortAsc((prev) => !prev);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const handleKillRequest = (proc: ProcessInfo) => {
    setKillTarget(proc);
  };

  const handleKillConfirm = async () => {
    if (!killTarget) return;
    const id = killTarget.plugin_id;
    setKillTarget(null);
    await killProcess(id);
  };

  const sorted = sortProcesses(processes, sortKey, sortAsc);
  const memoryPercent = systemStats
    ? formatMemoryBar(systemStats.memory_used, systemStats.memory_total)
    : 0;

  return (
    <>
      {killTarget && (
        <KillConfirmModal
          pluginName={killTarget.plugin_name}
          onConfirm={handleKillConfirm}
          onCancel={() => setKillTarget(null)}
        />
      )}

      <div className="h-screen flex flex-col bg-base text-primary overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-default bg-elevated shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/20 border border-blue-500/30">
              <Activity size={18} className="text-blue-400" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-primary">{t("taskManager.header.title")}</h1>
              <p className="text-xs text-muted">{t("taskManager.header.subtitle")}</p>
            </div>
          </div>
          <button
            onClick={refresh}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-muted hover:text-primary hover:bg-surface-secondary/50 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={clsx(loading && "animate-spin")} />
            {t("taskManager.header.refresh")}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Error banner */}
          {error && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              <AlertCircle size={16} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* System stats */}
          <div className="bg-elevated border border-default rounded-xl p-5">
            <h2 className="text-sm font-semibold text-primary mb-4 flex items-center gap-2">
              <Cpu size={15} className="text-blue-400" />
              {t("taskManager.systemResources.title")}
            </h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {/* CPU */}
              <div className="bg-base rounded-lg p-3 border border-default">
                <div className="flex items-center gap-2 mb-2">
                  <Cpu size={14} className="text-blue-400" />
                  <span className="text-xs text-muted font-medium uppercase tracking-wide">{t("taskManager.systemResources.cpu")}</span>
                </div>
                <p className="text-xl font-bold text-primary">
                  {systemStats ? formatCpuPercent(systemStats.cpu_percent) : "—"}
                </p>
              </div>

              {/* RAM */}
              <div className="bg-base rounded-lg p-3 border border-default">
                <div className="flex items-center gap-2 mb-2">
                  <MemoryStick size={14} className="text-purple-400" />
                  <span className="text-xs text-muted font-medium uppercase tracking-wide">{t("taskManager.systemResources.ram")}</span>
                </div>
                <p className="text-xl font-bold text-primary">
                  {systemStats ? formatBytes(systemStats.memory_used) : "—"}
                </p>
                {systemStats && (
                  <div className="mt-2">
                    <div className="h-1.5 rounded-full bg-surface-secondary overflow-hidden">
                      <div
                        className="h-full rounded-full bg-purple-400 transition-all duration-300"
                        style={{ width: `${memoryPercent}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted mt-1">
                      {memoryPercent}% of {formatBytes(systemStats.memory_total)}
                    </p>
                  </div>
                )}
              </div>

              {/* Disk Read/s */}
              <div className="bg-base rounded-lg p-3 border border-default">
                <div className="flex items-center gap-2 mb-2">
                  <HardDrive size={14} className="text-green-400" />
                  <span className="text-xs text-muted font-medium uppercase tracking-wide">
                    {t("taskManager.systemResources.diskRead")}
                  </span>
                </div>
                <p className="text-xl font-bold text-primary">
                  {systemStats ? formatBytes(systemStats.disk_read_bytes) : "—"}
                  {systemStats && (
                    <span className="text-xs font-normal text-muted ml-1">/s</span>
                  )}
                </p>
              </div>

              {/* Disk Write/s */}
              <div className="bg-base rounded-lg p-3 border border-default">
                <div className="flex items-center gap-2 mb-2">
                  <HardDrive size={14} className="text-orange-400" />
                  <span className="text-xs text-muted font-medium uppercase tracking-wide">
                    {t("taskManager.systemResources.diskWrite")}
                  </span>
                </div>
                <p className="text-xl font-bold text-primary">
                  {systemStats ? formatBytes(systemStats.disk_write_bytes) : "—"}
                  {systemStats && (
                    <span className="text-xs font-normal text-muted ml-1">/s</span>
                  )}
                </p>
              </div>
            </div>

            {systemStats && (
              <div className="mt-3 flex items-center gap-2 text-xs text-muted">
                <Layers size={12} />
                <span>{t("taskManager.systemResources.processCount", { count: systemStats.process_count })}</span>
              </div>
            )}
          </div>

          {/* Tabularis self stats */}
          {systemStats?.tabularis && (
            <TabularisSelfPanel stats={systemStats.tabularis} />
          )}

          {/* Plugin processes table */}
          <div className="bg-elevated border border-default rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-default flex items-center gap-2">
              <Plug size={15} className="text-blue-400" />
              <h2 className="text-sm font-semibold text-primary">{t("taskManager.pluginProcesses.title")}</h2>
              {processes.length > 0 && (
                <span className="ml-auto text-xs text-muted bg-surface-secondary px-2 py-0.5 rounded-full">
                  {processes.length}
                </span>
              )}
            </div>

            {loading && processes.length === 0 ? (
              <div className="flex items-center justify-center gap-3 py-12 text-muted text-sm">
                <Loader2 size={18} className="animate-spin" />
                {t("taskManager.pluginProcesses.loading")}
              </div>
            ) : processes.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted">
                <Plug size={32} className="opacity-30" />
                <p className="text-sm">{t("taskManager.pluginProcesses.empty")}</p>
                <p className="text-xs opacity-60">{t("taskManager.pluginProcesses.emptyHint")}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-default bg-base/50">
                      <Th label={t("taskManager.pluginProcesses.colPlugin")} col="plugin_name" current={sortKey} asc={sortAsc} onClick={handleSort} />
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase tracking-wide">
                        {t("taskManager.pluginProcesses.colPid")}
                      </th>
                      <Th label={t("taskManager.pluginProcesses.colCpu")} col="cpu_percent" current={sortKey} asc={sortAsc} onClick={handleSort} />
                      <Th label={t("taskManager.pluginProcesses.colRam")} col="memory_bytes" current={sortKey} asc={sortAsc} onClick={handleSort} />
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase tracking-wide">
                        {t("taskManager.pluginProcesses.colDiskRw")}
                      </th>
                      <Th label={t("taskManager.pluginProcesses.colStatus")} col="status" current={sortKey} asc={sortAsc} onClick={handleSort} />
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted uppercase tracking-wide">
                        {t("taskManager.pluginProcesses.colActions")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-default">
                    {sorted.map((proc) => (
                      <ProcessRow
                        key={proc.plugin_id}
                        proc={proc}
                        isKilling={killing.has(proc.plugin_id)}
                        isRestarting={restarting.has(proc.plugin_id)}
                        onKillRequest={handleKillRequest}
                        onRestart={restartProcess}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

