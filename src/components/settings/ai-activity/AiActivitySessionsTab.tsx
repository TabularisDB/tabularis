import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  FileDown,
  RefreshCw,
  Search,
} from "lucide-react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import {
  exportSessionAsNotebook,
  useAiSessionEvents,
  useAiSessions,
} from "../../../hooks/useAiActivity";
import { useAlert } from "../../../hooks/useAlert";
import { useSettings } from "../../../hooks/useSettings";
import {
  defaultExportFilename,
  formatDurationMs,
  formatLocalTime,
  formatLocalTimestamp,
  notebookFileFromExport,
  sessionMatchesSearch,
  sortAiSessions,
  truncateQuery,
  type SessionSortField,
  type SortDirection,
} from "../../../utils/aiActivity";
import type { AiSessionSummary } from "../../../types/ai";
import { StatusBadge } from "./StatusBadge";
import { Select } from "../../ui/Select";

export function AiActivitySessionsTab() {
  const { t } = useTranslation();
  const { sessions, loading, refetch } = useAiSessions();
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SessionSortField>("started");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");

  const sortOptions: SessionSortField[] = ["started", "events", "runQueries"];
  const sortLabels: Record<SessionSortField, string> = {
    started: t("aiActivity.sort.started", { defaultValue: "Started" }),
    events: t("aiActivity.sort.eventCount", { defaultValue: "Events" }),
    runQueries: t("aiActivity.sort.runQueries", { defaultValue: "Run queries" }),
  };

  const visibleSessions = useMemo(() => {
    const filtered = sessions.filter((s) => sessionMatchesSearch(s, search));
    return sortAiSessions(filtered, sortField, sortDir);
  }, [sessions, search, sortField, sortDir]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-default bg-surface-secondary/25 p-3">
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(220px,1fr)_180px_auto_auto]">
          <div className="relative min-w-0">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              type="text"
              placeholder={t("aiActivity.searchSessions", {
                defaultValue: "Search session, client, connection…",
              })}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded border border-strong bg-base pl-9 pr-3 text-sm text-primary placeholder:text-muted focus:border-blue-500 focus:outline-none"
            />
          </div>
          <Select
            value={sortField}
            options={sortOptions}
            labels={sortLabels}
            onChange={(value) => setSortField(value as SessionSortField)}
            placeholder={t("aiActivity.sort.sortByPlaceholder", {
              defaultValue: "Sort by…",
            })}
            searchable={false}
            className="min-w-0"
          />
          <button
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            className="flex h-9 items-center gap-1.5 rounded border border-strong bg-base px-2.5 text-xs text-muted transition-colors hover:bg-surface-tertiary hover:text-primary"
            title={
              sortDir === "asc"
                ? t("aiActivity.sort.toggleDescending", {
                    defaultValue: "Sort descending",
                  })
                : t("aiActivity.sort.toggleAscending", {
                    defaultValue: "Sort ascending",
                  })
            }
            aria-label={
              sortDir === "asc"
                ? t("aiActivity.sort.toggleDescending", {
                    defaultValue: "Sort descending",
                  })
                : t("aiActivity.sort.toggleAscending", {
                    defaultValue: "Sort ascending",
                  })
            }
          >
            {sortDir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
            {sortDir === "asc"
              ? t("aiActivity.sort.ascending", { defaultValue: "Asc" })
              : t("aiActivity.sort.descending", { defaultValue: "Desc" })}
          </button>
          <button
            onClick={refetch}
            className="flex h-9 w-9 items-center justify-center rounded text-muted transition-colors hover:bg-surface-tertiary hover:text-primary"
            title={t("common.refresh", { defaultValue: "Refresh" })}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs">
        <span className="inline-flex items-center rounded-full border border-default bg-base/50 px-2.5 py-1 text-muted">
          {t("aiActivity.sessionsCount", { count: visibleSessions.length })}
        </span>
        {search && visibleSessions.length !== sessions.length && (
          <span className="text-muted">
            {t("aiActivity.filteredFrom", {
              defaultValue: "of {{total}}",
              total: sessions.length,
            })}
          </span>
        )}
      </div>

      {loading && sessions.length === 0 ? (
        <div className="text-center py-12 text-muted text-sm">
          {t("common.loading")}
        </div>
      ) : visibleSessions.length === 0 ? (
        <div className="text-center py-12 text-muted text-sm">
          {sessions.length === 0
            ? t("aiActivity.empty")
            : t("aiActivity.noMatches", {
                defaultValue: "No sessions match the current filters.",
              })}
        </div>
      ) : (
        <div className="space-y-2">
          {visibleSessions.map((s) => (
            <SessionCard
              key={s.sessionId}
              session={s}
              expanded={activeSessionId === s.sessionId}
              onToggle={() =>
                setActiveSessionId((cur) =>
                  cur === s.sessionId ? null : s.sessionId,
                )
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface SessionCardProps {
  session: AiSessionSummary;
  expanded: boolean;
  onToggle: () => void;
}

function SessionCard({ session, expanded, onToggle }: SessionCardProps) {
  const { t } = useTranslation();
  const { showAlert } = useAlert();
  const { settings } = useSettings();

  const handleExport = async () => {
    try {
      const exp = await exportSessionAsNotebook(session.sessionId);
      const file = notebookFileFromExport(exp);
      const target = await saveDialog({
        defaultPath: defaultExportFilename(session.sessionId, exp, settings.displayTimezone),
        filters: [
          {
            name: "Tabularis Notebook",
            extensions: ["tabularis-notebook"],
          },
        ],
      });
      if (typeof target === "string" && target.length > 0) {
        await writeTextFile(target, JSON.stringify(file, null, 2));
        showAlert(t("aiActivity.exportSuccess", { path: target }), {
          kind: "info",
        });
      }
    } catch (err) {
      showAlert(String(err), { kind: "error", title: t("common.error") });
    }
  };

  return (
    <div className="border border-default rounded-lg overflow-hidden bg-surface-secondary/30">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 hover:bg-surface-tertiary/30 transition-colors text-left"
      >
        <div className="flex items-start gap-3 min-w-0">
          <ChevronRight
            size={14}
            className={`mt-0.5 text-muted shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-mono text-primary truncate">
                {session.sessionId.slice(0, 8)}…
              </span>
              {session.clientHint && (
                <span className="px-1.5 py-0.5 text-[10px] uppercase font-medium rounded bg-blue-900/20 text-blue-400 border border-blue-900/40">
                  {session.clientHint}
                </span>
              )}
            </div>
            <div className="text-xs text-muted mt-1 flex flex-wrap gap-x-3">
              <span>
                {t("aiActivity.events")}: {session.eventCount}
              </span>
              <span>
                {t("aiActivity.runQueries")}: {session.runQueryCount}
              </span>
              {session.connectionNames.length > 0 && (
                <span className="truncate max-w-[260px]">
                  {t("aiActivity.connections")}:{" "}
                  {session.connectionNames.join(", ")}
                </span>
              )}
              <span>
                {formatLocalTimestamp(session.startedAt, settings.displayTimezone)}
              </span>
            </div>
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleExport();
          }}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-muted hover:text-primary hover:bg-surface-tertiary rounded transition-colors shrink-0"
        >
          <FileDown size={12} />
          {t("aiActivity.exportNotebook")}
        </button>
      </button>
      {expanded && <SessionEventList sessionId={session.sessionId} />}
    </div>
  );
}

function SessionEventList({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const { events, loading } = useAiSessionEvents(sessionId);
  if (loading) {
    return (
      <div className="px-4 py-3 text-xs text-muted">{t("common.loading")}</div>
    );
  }
  if (events.length === 0) {
    return (
      <div className="px-4 py-3 text-xs text-muted">
        {t("aiActivity.empty")}
      </div>
    );
  }
  return (
    <div className="border-t border-default bg-base/40">
      {events.map((ev) => (
        <div
          key={ev.id}
          className="flex items-center gap-3 px-4 py-2 text-xs border-b border-default last:border-b-0"
        >
          <span className="text-muted font-mono whitespace-nowrap w-32">
            {formatLocalTime(ev.timestamp, settings.displayTimezone)}
          </span>
          <span className="text-primary font-mono w-32 shrink-0">{ev.tool}</span>
          <span className="text-secondary font-mono truncate flex-1">
            {truncateQuery(ev.query, 100) || ev.connectionName || "—"}
          </span>
          <span className="text-muted whitespace-nowrap">
            {formatDurationMs(ev.durationMs)}
          </span>
          <StatusBadge status={ev.status} />
        </div>
      ))}
    </div>
  );
}
