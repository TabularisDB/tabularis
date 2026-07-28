import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import type { ExplainPlan } from "../types";
import type { ExplainMetrics } from "../metrics";
import { getExplainPlanStats } from "../stats";
import { formatRows, formatTime } from "../plan";

interface ExplainStatsViewProps {
  plan: ExplainPlan;
  metrics: ExplainMetrics;
}

/**
 * Plan-wide aggregates: where the time goes by node type, which relations are
 * read and how often, and which indexes the planner picked.
 */
export function ExplainStatsView({ plan, metrics }: ExplainStatsViewProps) {
  const { t } = useTranslation();
  const stats = useMemo(
    () => getExplainPlanStats(plan, metrics),
    [plan, metrics],
  );

  return (
    <div className="h-full overflow-y-auto px-4 py-3 text-xs">
      <div className="mb-4 flex flex-wrap gap-2">
        <StatTile
          label={t("editor.visualExplain.stats.nodeCount")}
          value={String(stats.nodeCount)}
        />
        <StatTile
          label={t("editor.visualExplain.stats.maxDepth")}
          value={String(stats.maxDepth)}
        />
        {stats.totalExclusiveTimeMs != null && (
          <StatTile
            label={t("editor.visualExplain.stats.totalSelfTime")}
            value={formatTime(stats.totalExclusiveTimeMs)}
          />
        )}
        {stats.neverExecutedCount > 0 && (
          <StatTile
            label={t("editor.visualExplain.stats.neverExecutedNodes")}
            value={String(stats.neverExecutedCount)}
          />
        )}
      </div>

      <StatsSection title={t("editor.visualExplain.stats.byNodeType")}>
        <table className="w-full">
          <thead>
            <StatsHeaderRow
              columns={[
                { key: "type", label: t("editor.visualExplain.nodeType") },
                { key: "count", label: t("editor.visualExplain.stats.count"), align: "right" },
                { key: "time", label: t("editor.visualExplain.selfTime"), align: "right" },
                { key: "share", label: t("editor.visualExplain.stats.share") },
              ]}
            />
          </thead>
          <tbody>
            {stats.nodeTypes.map((entry) => (
              <tr key={entry.nodeType} className="border-b border-default/25">
                <td className="px-3 py-1.5 text-primary">{entry.nodeType}</td>
                <td className="px-3 py-1.5 text-right font-mono text-secondary">
                  {entry.count}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-secondary">
                  {entry.exclusiveTimeMs != null
                    ? formatTime(entry.exclusiveTimeMs)
                    : "-"}
                </td>
                <td className="w-1/3 px-3 py-1.5">
                  <ShareBar share={entry.timeShare} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </StatsSection>

      {stats.relations.length > 0 && (
        <StatsSection title={t("editor.visualExplain.stats.byRelation")}>
          <table className="w-full">
            <thead>
              <StatsHeaderRow
                columns={[
                  { key: "relation", label: t("editor.visualExplain.relation") },
                  {
                    key: "accesses",
                    label: t("editor.visualExplain.stats.accesses"),
                    align: "right",
                  },
                  { key: "ops", label: t("editor.visualExplain.stats.operations") },
                  {
                    key: "rows",
                    label: t("editor.visualExplain.actualRows"),
                    align: "right",
                  },
                  {
                    key: "time",
                    label: t("editor.visualExplain.selfTime"),
                    align: "right",
                  },
                ]}
              />
            </thead>
            <tbody>
              {stats.relations.map((entry) => (
                <tr key={entry.relation} className="border-b border-default/25">
                  <td className="px-3 py-1.5 font-mono text-primary">
                    {entry.relation}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-secondary">
                    {entry.accessCount}
                  </td>
                  <td className="px-3 py-1.5 text-muted">
                    {entry.nodeTypes.join(", ")}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-secondary">
                    {entry.totalRows != null ? formatRows(entry.totalRows) : "-"}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-secondary">
                    {entry.exclusiveTimeMs != null
                      ? formatTime(entry.exclusiveTimeMs)
                      : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StatsSection>
      )}

      {stats.indexes.length > 0 && (
        <StatsSection title={t("editor.visualExplain.stats.byIndex")}>
          <table className="w-full">
            <thead>
              <StatsHeaderRow
                columns={[
                  { key: "index", label: t("editor.visualExplain.stats.indexName") },
                  { key: "relation", label: t("editor.visualExplain.relation") },
                  {
                    key: "scans",
                    label: t("editor.visualExplain.stats.scans"),
                    align: "right",
                  },
                  {
                    key: "time",
                    label: t("editor.visualExplain.selfTime"),
                    align: "right",
                  },
                ]}
              />
            </thead>
            <tbody>
              {stats.indexes.map((entry) => (
                <tr key={entry.indexName} className="border-b border-default/25">
                  <td className="px-3 py-1.5 font-mono text-primary">
                    {entry.indexName}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-secondary">
                    {entry.relation ?? "-"}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-secondary">
                    {entry.scanCount}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-secondary">
                    {entry.exclusiveTimeMs != null
                      ? formatTime(entry.exclusiveTimeMs)
                      : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StatsSection>
      )}
    </div>
  );
}

interface StatTileProps {
  label: string;
  value: string;
}

function StatTile({ label, value }: StatTileProps) {
  return (
    <div className="min-w-[130px] rounded-xl border border-default bg-surface-secondary/20 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted">
        {label}
      </div>
      <div className="mt-1 font-mono text-sm font-semibold text-primary">
        {value}
      </div>
    </div>
  );
}

interface StatsSectionProps {
  title: string;
  children: ReactNode;
}

function StatsSection({ title, children }: StatsSectionProps) {
  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-default">
      <div className="border-b border-default bg-base/60 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {title}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

interface StatsColumn {
  key: string;
  label: string;
  align?: "left" | "right";
}

function StatsHeaderRow({ columns }: { columns: StatsColumn[] }) {
  return (
    <tr className="border-b border-default/60">
      {columns.map((column) => (
        <th
          key={column.key}
          className={clsx(
            "whitespace-nowrap px-3 py-1.5 font-semibold text-muted",
            column.align === "right" ? "text-right" : "text-left",
          )}
        >
          {column.label}
        </th>
      ))}
    </tr>
  );
}

function ShareBar({ share }: { share: number | null }) {
  if (share == null) {
    return <span className="text-muted">-</span>;
  }

  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded bg-surface-secondary/60">
        <div
          className="h-full rounded bg-blue-500/70"
          style={{ width: `${Math.min(100, share * 100)}%` }}
        />
      </div>
      <span className="w-10 shrink-0 text-right font-mono text-[11px] text-muted">
        {Math.round(share * 100)}%
      </span>
    </div>
  );
}
