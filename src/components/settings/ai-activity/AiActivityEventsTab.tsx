import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Copy,
  Download,
  Eye,
  GitGraph,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import {
  clearAiActivity,
  exportAiActivityCsv,
  exportAiActivityJson,
  useAiActivityEvents,
} from "../../../hooks/useAiActivity";
import { formatDurationMs, truncateQuery } from "../../../utils/aiActivity";
import type { AiActivityEvent, AiEventFilter } from "../../../types/ai";
import { useAlert } from "../../../hooks/useAlert";
import { StatusBadge } from "./StatusBadge";
import { QueryKindBadge } from "./QueryKindBadge";
import { EventDetailModal } from "./EventDetailModal";
import { VisualExplainModal } from "../../modals/VisualExplainModal";
import { Select } from "../../ui/Select";

interface ExplainTarget {
  query: string;
  connectionId: string;
  connectionName: string | null;
}

export function AiActivityEventsTab() {
  const { t } = useTranslation();
  const { showAlert } = useAlert();
  const [filter, setFilter] = useState<AiEventFilter>({});
  const [detail, setDetail] = useState<AiActivityEvent | null>(null);
  const [explainTarget, setExplainTarget] = useState<ExplainTarget | null>(
    null,
  );
  const { events, loading, refetch } = useAiActivityEvents(filter);

  const stats = useMemo(() => {
    const errors = events.filter(
      (e) =>
        e.status === "error" ||
        e.status === "denied" ||
        e.status === "timeout",
    ).length;
    const blocked = events.filter((e) =>
      e.status.startsWith("blocked"),
    ).length;
    return { total: events.length, errors, blocked };
  }, [events]);

  const handleClear = async () => {
    if (!confirm(t("aiActivity.clearConfirm"))) return;
    try {
      await clearAiActivity();
      await refetch();
    } catch (err) {
      showAlert(String(err), { kind: "error", title: t("common.error") });
    }
  };

  const handleExport = async (format: "json" | "csv") => {
    try {
      const content =
        format === "json" ? await exportAiActivityJson() : await exportAiActivityCsv();
      const target = await saveDialog({
        defaultPath:
          format === "json" ? "ai-activity.jsonl" : "ai-activity.csv",
        filters: [
          {
            name: format === "json" ? "JSON Lines" : "CSV",
            extensions: [format === "json" ? "jsonl" : "csv"],
          },
        ],
      });
      if (typeof target === "string" && target.length > 0) {
        await writeTextFile(target, content);
        showAlert(t("aiActivity.exportSuccess", { path: target }), {
          kind: "info",
        });
      }
    } catch (err) {
      showAlert(String(err), { kind: "error", title: t("common.error") });
    }
  };

  const handleOpenInVisualExplain = (ev: AiActivityEvent) => {
    if (!ev.query || !ev.connectionId) return;
    setExplainTarget({
      query: ev.query,
      connectionId: ev.connectionId,
      connectionName: ev.connectionName,
    });
  };

  return (
    <div className="space-y-4 min-w-0">
      <FiltersBar
        filter={filter}
        onFilterChange={setFilter}
        onRefresh={refetch}
        onClear={handleClear}
        onExportJson={() => handleExport("json")}
        onExportCsv={() => handleExport("csv")}
      />

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center rounded-full border border-default bg-base/50 px-2.5 py-1 text-muted">
          {t("aiActivity.eventsCount", { count: stats.total })}
        </span>
        {stats.blocked > 0 && (
          <span className="inline-flex items-center rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2.5 py-1 text-yellow-300">
            {t("aiActivity.blockedCount", { count: stats.blocked })}
          </span>
        )}
        {stats.errors > 0 && (
          <span className="inline-flex items-center rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-red-300">
            {t("aiActivity.errorsCount", { count: stats.errors })}
          </span>
        )}
      </div>

      <EventsTable
        events={events}
        loading={loading}
        onView={setDetail}
        onCopyQuery={(q) => {
          navigator.clipboard.writeText(q);
          showAlert(t("aiActivity.copied"), { kind: "info" });
        }}
        onOpenInVisualExplain={handleOpenInVisualExplain}
      />

      {detail && (
        <EventDetailModal event={detail} onClose={() => setDetail(null)} />
      )}

      <VisualExplainModal
        isOpen={explainTarget !== null}
        onClose={() => setExplainTarget(null)}
        query={explainTarget?.query ?? ""}
        connectionId={explainTarget?.connectionId ?? ""}
        connectionLabel={explainTarget?.connectionName ?? undefined}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components — kept inside the file because they only make sense inside
// the events tab and never get reused.
// ---------------------------------------------------------------------------

interface FiltersBarProps {
  filter: AiEventFilter;
  onFilterChange: (f: AiEventFilter) => void;
  onRefresh: () => void;
  onClear: () => void;
  onExportJson: () => void;
  onExportCsv: () => void;
}

function FiltersBar({
  filter,
  onFilterChange,
  onRefresh,
  onClear,
  onExportJson,
  onExportCsv,
}: FiltersBarProps) {
  const { t } = useTranslation();
  const update = (patch: Partial<AiEventFilter>) =>
    onFilterChange({ ...filter, ...patch });
  const toolOptions = [
    "",
    "list_connections",
    "list_tables",
    "describe_table",
    "run_query",
  ];
  const statusOptions = [
    "",
    "success",
    "error",
    "denied",
    "timeout",
    "blocked_readonly",
  ];
  const toolLabels = { "": t("aiActivity.allTools") };
  const statusLabels = {
    "": t("aiActivity.allStatuses"),
    success: t("aiActivity.status.success"),
    error: t("aiActivity.status.error"),
    denied: t("aiActivity.status.denied"),
    timeout: t("aiActivity.status.timeout"),
    blocked_readonly: t("aiActivity.status.blocked_readonly"),
  };

  return (
    <div className="rounded-lg border border-default bg-surface-secondary/25 p-3">
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(220px,1fr)_180px_190px_auto]">
        <div className="relative min-w-0">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            type="text"
            placeholder={t("aiActivity.searchQuery")}
            value={filter.queryContains ?? ""}
            onChange={(e) =>
              update({ queryContains: e.target.value || undefined })
            }
            className="h-9 w-full rounded border border-strong bg-base pl-9 pr-3 text-sm text-primary placeholder:text-muted focus:border-blue-500 focus:outline-none"
          />
        </div>
        <Select
          value={filter.tool ?? ""}
          options={toolOptions}
          labels={toolLabels}
          onChange={(value) => update({ tool: value || undefined })}
          placeholder={t("aiActivity.allTools")}
          searchable={false}
          className="min-w-0"
        />
        <Select
          value={filter.status ?? ""}
          options={statusOptions}
          labels={statusLabels}
          onChange={(value) =>
            update({
              status: (value || undefined) as AiEventFilter["status"],
            })
          }
          placeholder={t("aiActivity.allStatuses")}
          searchable={false}
          className="min-w-0"
        />
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={onRefresh}
            className="flex h-9 w-9 items-center justify-center rounded text-muted transition-colors hover:bg-surface-tertiary hover:text-primary"
            title={t("common.refresh", { defaultValue: "Refresh" })}
          >
            <RefreshCw size={14} />
          </button>
          <button
            onClick={onExportCsv}
            className="flex h-9 items-center gap-1.5 rounded px-2.5 text-xs text-muted transition-colors hover:bg-surface-tertiary hover:text-primary"
          >
            <Download size={12} /> CSV
          </button>
          <button
            onClick={onExportJson}
            className="flex h-9 items-center gap-1.5 rounded px-2.5 text-xs text-muted transition-colors hover:bg-surface-tertiary hover:text-primary"
          >
            <Download size={12} /> JSON
          </button>
          <button
            onClick={onClear}
            className="flex h-9 items-center gap-1.5 rounded px-2.5 text-xs text-red-400 transition-colors hover:bg-red-900/20 hover:text-red-300"
          >
            <Trash2 size={12} /> {t("aiActivity.clearAll")}
          </button>
        </div>
      </div>
    </div>
  );
}

interface EventsTableProps {
  events: AiActivityEvent[];
  loading: boolean;
  onView: (event: AiActivityEvent) => void;
  onCopyQuery: (query: string) => void;
  onOpenInVisualExplain: (event: AiActivityEvent) => void;
}

function EventsTable({
  events,
  loading,
  onView,
  onCopyQuery,
  onOpenInVisualExplain,
}: EventsTableProps) {
  const { t } = useTranslation();
  if (loading && events.length === 0) {
    return (
      <div className="text-center py-12 text-muted text-sm">
        {t("common.loading")}
      </div>
    );
  }
  if (events.length === 0) {
    return (
      <div className="text-center py-12 text-muted text-sm">
        {t("aiActivity.empty")}
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-default bg-base/30">
      <div className="max-h-[500px] overflow-auto">
        <table className="w-full table-fixed text-xs">
          <thead className="sticky top-0 z-10 bg-surface-secondary">
            <tr className="text-left text-muted">
              <th className="w-[9.5rem] px-3 py-2 font-medium">
                {t("aiActivity.col.timestamp")}
              </th>
              <th className="w-[8.5rem] px-3 py-2 font-medium">
                {t("aiActivity.col.tool")}
              </th>
              <th className="w-[8rem] px-3 py-2 font-medium">
                {t("aiActivity.col.connection")}
              </th>
              <th className="px-3 py-2 font-medium">
                {t("aiActivity.col.query")}
              </th>
              <th className="w-[5.5rem] px-3 py-2 font-medium">
                {t("aiActivity.col.kind")}
              </th>
              <th className="w-[5.5rem] px-3 py-2 text-right font-medium">
                {t("aiActivity.col.duration")}
              </th>
              <th className="w-[9.5rem] px-3 py-2 font-medium">
                {t("aiActivity.col.status")}
              </th>
              <th className="w-[5.25rem] px-3 py-2 text-right font-medium">
                {t("aiActivity.col.actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {events.map((ev) => (
              <tr
                key={ev.id}
                className="border-t border-default transition-colors hover:bg-surface-tertiary/25"
              >
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-muted">
                  {ev.timestamp.replace("T", " ").slice(0, 19)}
                </td>
                <td className="truncate px-3 py-2.5 font-mono text-primary">
                  {ev.tool}
                </td>
                <td className="truncate px-3 py-2.5 text-muted">
                  {ev.connectionName ?? "—"}
                </td>
                <td
                  className="truncate px-3 py-2.5 font-mono text-secondary"
                  title={ev.query ?? undefined}
                >
                  {truncateQuery(ev.query, 80) || "—"}
                </td>
                <td className="px-3 py-2.5">
                  <QueryKindBadge kind={ev.queryKind} />
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right text-muted">
                  {formatDurationMs(ev.durationMs)}
                </td>
                <td className="px-3 py-2.5">
                  <StatusBadge status={ev.status} />
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => onView(ev)}
                      className="rounded p-1 text-muted hover:bg-surface-tertiary hover:text-primary"
                      title={t("aiActivity.viewDetails")}
                    >
                      <Eye size={12} />
                    </button>
                    {ev.query && (
                      <button
                        onClick={() => onCopyQuery(ev.query!)}
                        className="rounded p-1 text-muted hover:bg-surface-tertiary hover:text-primary"
                        title={t("aiActivity.copyQuery")}
                      >
                        <Copy size={12} />
                      </button>
                    )}
                    {ev.tool === "run_query" && ev.query && ev.connectionId && (
                      <button
                        onClick={() => onOpenInVisualExplain(ev)}
                        className="rounded p-1 text-muted hover:bg-green-900/20 hover:text-green-400"
                        title={t("aiActivity.openVisualExplain")}
                      >
                        <GitGraph size={12} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
