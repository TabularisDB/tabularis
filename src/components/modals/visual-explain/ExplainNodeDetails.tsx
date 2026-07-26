import { useTranslation } from "react-i18next";
import type { ExplainNode } from "../../../types/explain";
import type { ExplainNodeMetrics } from "../../../utils/explainMetrics";
import type { ExplainDiagnostic } from "../../../utils/explainDiagnostics";
import { formatCost, formatRows, formatTime } from "../../../utils/explainPlan";
import { ExplainDiagnosticList } from "../../ui/ExplainDiagnosticChips";

interface ExplainNodeDetailsProps {
  node: ExplainNode | null;
  hasAnalyzeData: boolean;
  /** Derived exclusive metrics for `node`, when the caller has them. */
  metrics?: ExplainNodeMetrics | null;
  diagnostics?: ExplainDiagnostic[];
}

export function ExplainNodeDetails({
  node,
  hasAnalyzeData,
  metrics = null,
  diagnostics = [],
}: ExplainNodeDetailsProps) {
  const { t } = useTranslation();

  if (!node) {
    return (
      <div className="p-4 text-xs text-muted">
        {t("editor.visualExplain.selectNode")}
      </div>
    );
  }

  const generalEntries: [string, string][] = [
    [t("editor.visualExplain.nodeType"), node.node_type],
    ...(node.relation
      ? [[t("editor.visualExplain.relation"), node.relation] as [string, string]]
      : []),
    ...(node.startup_cost != null && node.total_cost != null
      ? [
          [
            t("editor.visualExplain.cost"),
            `${formatCost(node.startup_cost)} - ${formatCost(node.total_cost)}`,
          ] as [string, string],
        ]
      : node.total_cost != null
        ? [[t("editor.visualExplain.cost"), formatCost(node.total_cost)] as [string, string]]
        : []),
    ...(metrics?.exclusiveCost != null
      ? [
          [
            t("editor.visualExplain.selfCost"),
            formatCost(metrics.exclusiveCost),
          ] as [string, string],
        ]
      : []),
    ...(node.plan_rows != null
      ? [[t("editor.visualExplain.estRows"), formatRows(node.plan_rows)] as [string, string]]
      : []),
    ...(node.filter
      ? [[t("editor.visualExplain.filter"), node.filter] as [string, string]]
      : []),
    ...(node.index_condition
      ? [[t("editor.visualExplain.indexCondition"), node.index_condition] as [string, string]]
      : []),
    ...(node.join_type
      ? [[t("editor.visualExplain.joinType"), node.join_type] as [string, string]]
      : []),
    ...(node.hash_condition
      ? [[t("editor.visualExplain.hashCondition"), node.hash_condition] as [string, string]]
      : []),
  ];

  const analyzeEntries: [string, string][] = hasAnalyzeData
    ? [
        ...(node.actual_rows != null
          ? [[t("editor.visualExplain.actualRows"), formatRows(node.actual_rows)] as [string, string]]
          : []),
        ...(metrics?.totalRows != null &&
        node.actual_loops != null &&
        node.actual_loops > 1
          ? [
              [
                t("editor.visualExplain.rowsAllLoops"),
                formatRows(metrics.totalRows),
              ] as [string, string],
            ]
          : []),
        ...(metrics?.exclusiveTimeMs != null
          ? [
              [
                t("editor.visualExplain.selfTime"),
                metrics.timeShare != null
                  ? `${formatTime(metrics.exclusiveTimeMs)} (${Math.round(metrics.timeShare * 100)}%)`
                  : formatTime(metrics.exclusiveTimeMs),
              ] as [string, string],
            ]
          : []),
        ...(metrics?.inclusiveTimeMs != null
          ? [
              [
                t("editor.visualExplain.totalTime"),
                formatTime(metrics.inclusiveTimeMs),
              ] as [string, string],
            ]
          : []),
        ...(node.actual_time_ms != null
          ? [
              [
                t("editor.visualExplain.timePerLoop"),
                formatTime(node.actual_time_ms),
              ] as [string, string],
            ]
          : []),
        ...(node.actual_loops != null
          ? [[t("editor.visualExplain.loops"), String(node.actual_loops)] as [string, string]]
          : []),
        ...(node.buffers_hit != null
          ? [[t("editor.visualExplain.buffersHit"), String(node.buffers_hit)] as [string, string]]
          : []),
        ...(node.buffers_read != null
          ? [[t("editor.visualExplain.buffersRead"), String(node.buffers_read)] as [string, string]]
          : []),
      ]
    : [];

  const extraEntries: [string, string][] = Object.entries(node.extra).map(
    ([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)],
  );

  return (
    <div className="text-xs">
      {diagnostics.length > 0 && (
        <div className="border-b border-default/60">
          <div className="bg-base/60 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted">
            {t("editor.visualExplain.diagnostics.title")}
          </div>
          <ExplainDiagnosticList diagnostics={diagnostics} />
        </div>
      )}
      <DetailSection
        title={t("editor.visualExplain.general")}
        entries={generalEntries}
      />
      {analyzeEntries.length > 0 && (
        <DetailSection
          title={t("editor.visualExplain.analyzeData")}
          entries={analyzeEntries}
        />
      )}
      {extraEntries.length > 0 && (
        <DetailSection
          title={t("editor.visualExplain.extraDetails")}
          entries={extraEntries}
        />
      )}
    </div>
  );
}

interface DetailSectionProps {
  title: string;
  entries: [string, string][];
}

function DetailSection({ title, entries }: DetailSectionProps) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="border-b border-default/60 last:border-b-0">
      <div className="px-4 py-3 text-[11px] uppercase tracking-wide text-muted font-semibold bg-base/60">
        {title}
      </div>
      <div className="divide-y divide-default/40">
        {entries.map(([label, value]) => (
          <div key={label} className="px-4 py-2.5">
            <div className="text-[11px] text-muted mb-1">{label}</div>
            <div className="text-secondary break-words font-mono leading-relaxed">
              {value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
