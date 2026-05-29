import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
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
import {
  formatDurationMs,
  formatLocalTimestamp,
  sortAiEvents,
  truncateQuery,
  type EventSortField,
  type SortDirection,
} from "../../../utils/aiActivity";
import type { AiActivityEvent, AiEventFilter } from "../../../types/ai";
import { useAlert } from "../../../hooks/useAlert";
import { useSettings } from "../../../hooks/useSettings";
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
        refreshing={loading}
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
  onRefresh: () => void | Promise<void>;
  onClear: () => void;
  onExportJson: () => void;
  onExportCsv: () => void;
  refreshing: boolean;
}

function FiltersBar({
  filter,
  onFilterChange,
  onRefresh,
  onClear,
  onExportJson,
  onExportCsv,
  refreshing,
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
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1 lg:max-w-md">
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
        <div className="grid grid-cols-2 gap-2 lg:flex lg:flex-1 lg:items-center lg:gap-2">
          <Select
            value={filter.tool ?? ""}
            options={toolOptions}
            labels={toolLabels}
            onChange={(value) => update({ tool: value || undefined })}
            placeholder={t("aiActivity.allTools")}
            searchable={false}
            className="min-w-0 lg:w-[180px]"
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
            className="min-w-0 lg:w-[190px]"
          />
        </div>
        <div className="flex items-center justify-end gap-1 lg:ml-auto">
          <button
            onClick={() => onRefresh()}
            disabled={refreshing}
            className="flex h-9 w-9 items-center justify-center rounded border border-strong bg-base text-muted transition-colors hover:bg-surface-tertiary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
            title={t("common.refresh", { defaultValue: "Refresh" })}
            aria-label={t("common.refresh", { defaultValue: "Refresh" })}
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
          </button>
          <div className="mx-1 h-6 w-px bg-default" aria-hidden />
          <div className="flex items-center overflow-hidden rounded border border-strong bg-base">
            <button
              onClick={onExportCsv}
              className="flex h-9 items-center gap-1.5 px-2.5 text-xs text-muted transition-colors hover:bg-surface-tertiary hover:text-primary"
              title={t("aiActivity.exportCsv", { defaultValue: "Export CSV" })}
            >
              <Download size={12} /> CSV
            </button>
            <div className="h-5 w-px bg-default" aria-hidden />
            <button
              onClick={onExportJson}
              className="flex h-9 items-center gap-1.5 px-2.5 text-xs text-muted transition-colors hover:bg-surface-tertiary hover:text-primary"
              title={t("aiActivity.exportJson", { defaultValue: "Export JSON" })}
            >
              <Download size={12} /> JSON
            </button>
          </div>
          <div className="mx-1 h-6 w-px bg-default" aria-hidden />
          <button
            onClick={onClear}
            className="flex h-9 items-center gap-1.5 rounded border border-red-900/40 bg-red-900/10 px-2.5 text-xs text-red-400 transition-colors hover:bg-red-900/30 hover:text-red-300"
            title={t("aiActivity.clearAll")}
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
  const { settings } = useSettings();
  const [sortField, setSortField] = useState<EventSortField>("timestamp");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");

  const sortedEvents = useMemo(
    () => sortAiEvents(events, sortField, sortDir),
    [events, sortField, sortDir],
  );

  const toggleSort = (field: EventSortField) => {
    if (field === sortField) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir(field === "timestamp" || field === "duration" ? "desc" : "asc");
    }
  };

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
              <SortableHeader
                field="timestamp"
                label={t("aiActivity.col.timestamp")}
                activeField={sortField}
                direction={sortDir}
                onToggle={toggleSort}
                className="w-[9.5rem]"
              />
              <SortableHeader
                field="tool"
                label={t("aiActivity.col.tool")}
                activeField={sortField}
                direction={sortDir}
                onToggle={toggleSort}
                className="w-[8.5rem]"
              />
              <SortableHeader
                field="connection"
                label={t("aiActivity.col.connection")}
                activeField={sortField}
                direction={sortDir}
                onToggle={toggleSort}
                className="w-[8rem]"
              />
              <th className="px-3 py-2 font-medium">
                {t("aiActivity.col.query")}
              </th>
              <SortableHeader
                field="kind"
                label={t("aiActivity.col.kind")}
                activeField={sortField}
                direction={sortDir}
                onToggle={toggleSort}
                className="w-[5.5rem]"
              />
              <SortableHeader
                field="duration"
                label={t("aiActivity.col.duration")}
                activeField={sortField}
                direction={sortDir}
                onToggle={toggleSort}
                className="w-[5.5rem]"
                align="right"
              />
              <SortableHeader
                field="status"
                label={t("aiActivity.col.status")}
                activeField={sortField}
                direction={sortDir}
                onToggle={toggleSort}
                className="w-[9.5rem]"
              />
              <th className="w-[5.25rem] px-3 py-2 text-right font-medium">
                {t("aiActivity.col.actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedEvents.map((ev) => (
              <tr
                key={ev.id}
                className="border-t border-default transition-colors hover:bg-surface-tertiary/25"
              >
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-muted">
                  {formatLocalTimestamp(ev.timestamp, settings.displayTimezone)}
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

interface SortableHeaderProps {
  field: EventSortField;
  label: string;
  activeField: EventSortField;
  direction: SortDirection;
  onToggle: (field: EventSortField) => void;
  className?: string;
  align?: "left" | "right";
}

function SortableHeader({
  field,
  label,
  activeField,
  direction,
  onToggle,
  className,
  align = "left",
}: SortableHeaderProps) {
  const { t } = useTranslation();
  const isActive = field === activeField;
  const Icon = isActive ? (direction === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  const ariaSort = isActive
    ? direction === "asc"
      ? "ascending"
      : "descending"
    : "none";
  const nextLabel = isActive
    ? direction === "asc"
      ? t("aiActivity.sort.toggleDescending", { defaultValue: "Sort descending" })
      : t("aiActivity.sort.toggleAscending", { defaultValue: "Sort ascending" })
    : t("aiActivity.sort.sortBy", { defaultValue: "Sort by {{field}}", field: label });
  return (
    <th
      className={`${className ?? ""} px-3 py-2 font-medium ${
        align === "right" ? "text-right" : "text-left"
      }`}
      aria-sort={ariaSort}
    >
      <button
        type="button"
        onClick={() => onToggle(field)}
        title={nextLabel}
        className={`inline-flex items-center gap-1 rounded px-1 py-0.5 -mx-1 transition-colors hover:text-primary ${
          isActive ? "text-primary" : ""
        } ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        <span>{label}</span>
        <Icon size={11} className={isActive ? "" : "opacity-60"} />
      </button>
    </th>
  );
}
