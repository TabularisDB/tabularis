import { useLingui } from "@lingui/react/macro";
import type { ExplainNode } from "../../../types/explain";
import { formatCost, formatRows, formatTime } from "../../../utils/explainPlan";

interface ExplainNodeDetailsProps {
  node: ExplainNode | null;
  hasAnalyzeData: boolean;
}

export function ExplainNodeDetails({
  node,
  hasAnalyzeData,
}: ExplainNodeDetailsProps) {
  const { t } = useLingui();

  if (!node) {
    return (
      <div className="p-4 text-xs text-muted">
        {t`Select a node to view details`}
      </div>
    );
  }

  const generalEntries: [string, string][] = [
    [t`Operation`, node.node_type],
    ...(node.relation
      ? [[t({ message: "Table", context: "editor" }), node.relation] as [string, string]]
      : []),
    ...(node.startup_cost != null && node.total_cost != null
      ? [
          [
            t`Cost`,
            `${formatCost(node.startup_cost)} - ${formatCost(node.total_cost)}`,
          ] as [string, string],
        ]
      : node.total_cost != null
        ? [[t`Cost`, formatCost(node.total_cost)] as [string, string]]
        : []),
    ...(node.plan_rows != null
      ? [[t`Est. Rows`, formatRows(node.plan_rows)] as [string, string]]
      : []),
    ...(node.filter
      ? [[t`Filter`, node.filter] as [string, string]]
      : []),
    ...(node.index_condition
      ? [[t`Index Cond.`, node.index_condition] as [string, string]]
      : []),
    ...(node.join_type
      ? [[t`Join Type`, node.join_type] as [string, string]]
      : []),
    ...(node.hash_condition
      ? [[t`Hash Cond.`, node.hash_condition] as [string, string]]
      : []),
  ];

  const analyzeEntries: [string, string][] = hasAnalyzeData
    ? [
        ...(node.actual_rows != null
          ? [[t`Actual Rows`, formatRows(node.actual_rows)] as [string, string]]
          : []),
        ...(node.actual_time_ms != null
          ? [[t({ message: "Time", context: "editor" }), formatTime(node.actual_time_ms)] as [string, string]]
          : []),
        ...(node.actual_loops != null
          ? [[t`Loops`, String(node.actual_loops)] as [string, string]]
          : []),
        ...(node.buffers_hit != null
          ? [[t`Buffers Hit`, String(node.buffers_hit)] as [string, string]]
          : []),
        ...(node.buffers_read != null
          ? [[t`Buffers Read`, String(node.buffers_read)] as [string, string]]
          : []),
      ]
    : [];

  const extraEntries: [string, string][] = Object.entries(node.extra).map(
    ([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)],
  );

  return (
    <div className="text-xs">
      <DetailSection
        title={t({ message: "General", context: "editor" })}
        entries={generalEntries}
      />
      {analyzeEntries.length > 0 && (
        <DetailSection
          title={t`Analyze Data`}
          entries={analyzeEntries}
        />
      )}
      {extraEntries.length > 0 && (
        <DetailSection
          title={t`Extra`}
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
