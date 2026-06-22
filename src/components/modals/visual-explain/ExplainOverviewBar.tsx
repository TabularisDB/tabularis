import { useMemo, useState } from "react";
import { useLingui } from "@lingui/react/macro";
import {
  AlertTriangle,
  BookOpenText,
  ChevronDown,
  ChevronRight,
  Clock3,
  Database,
  LayoutDashboard,
  Layers2,
  ScanSearch,
} from "lucide-react";
import clsx from "clsx";
import type { ExplainPlan } from "../../../types/explain";
import {
  formatCost,
  formatRatio,
  formatTime,
  getExplainDriverLegend,
  getExplainPlanSummary,
} from "../../../utils/explainPlan";

interface ExplainOverviewBarProps {
  plan: ExplainPlan;
  onSelectNode: (nodeId: string) => void;
}

export function ExplainOverviewBar({
  plan,
  onSelectNode,
}: ExplainOverviewBarProps) {
  const { t, i18n } = useLingui();
  const summary = useMemo(() => getExplainPlanSummary(plan), [plan]);
  const legend = useMemo(() => getExplainDriverLegend(plan), [plan]);
  const [overviewExpanded, setOverviewExpanded] = useState(true);

  const findings = [
    summary.highestCostNode && {
      key: "highest-cost",
      label: t`Highest Cost`,
      value: formatCost(summary.highestCostNode.value),
      description: formatNodeLabel(
        summary.highestCostNode.nodeType,
        summary.highestCostNode.relation,
      ),
      nodeId: summary.highestCostNode.nodeId,
      icon: Layers2,
      tone: "blue" as const,
    },
    summary.slowestNode && {
      key: "slowest-step",
      label: t`Slowest Step`,
      value: formatTime(summary.slowestNode.value),
      description: formatNodeLabel(
        summary.slowestNode.nodeType,
        summary.slowestNode.relation,
      ),
      nodeId: summary.slowestNode.nodeId,
      icon: Clock3,
      tone: "amber" as const,
    },
    summary.largestRowMismatchNode?.ratio != null && {
      key: "estimate-gap",
      label: t`Estimate Gap`,
      value: formatRatio(summary.largestRowMismatchNode.value),
      description:
        summary.largestRowMismatchNode.ratio >= 1
          ? t`Actual rows exceed estimate`
          : t`Estimate exceeds actual rows`,
      nodeId: summary.largestRowMismatchNode.nodeId,
      icon: AlertTriangle,
      tone: "red" as const,
    },
    summary.sequentialScans > 0 && {
      key: "sequential-scans",
      label: t`Sequential Scans`,
      value: String(summary.sequentialScans),
      description: t`Scan-heavy operations detected`,
      nodeId: summary.highestCostNode?.nodeId ?? plan.root.id,
      icon: ScanSearch,
      tone: "amber" as const,
    },
    summary.tempOperations > 0 && {
      key: "temp-operations",
      label: t`Temp or Sort Ops`,
      value: String(summary.tempOperations),
      description: t`Sort or temp work detected`,
      nodeId: summary.slowestNode?.nodeId ?? plan.root.id,
      icon: Database,
      tone: "purple" as const,
    },
  ].filter(Boolean);

  return (
    <div className="border-b border-default bg-base/40 px-4 py-2">
      <div className="rounded-xl border border-default bg-surface-secondary/20 overflow-hidden">
        <button
          onClick={() => setOverviewExpanded((prev) => !prev)}
          className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-surface-secondary/35 transition-colors"
        >
          <div className="p-1.5 rounded-md bg-blue-900/25 text-blue-300">
            <LayoutDashboard size={13} />
          </div>
          <div className="min-w-0 text-left">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted font-semibold">
              {t`Overview`}
            </div>
            <div className="text-xs text-secondary">
              {findings.length} {t`Top Issues`.toLowerCase()}
              {legend.length > 0
                ? ` • ${legend.length} ${t`Driver Notes`.toLowerCase()}`
                : ""}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2 text-[11px] text-muted">
            <span>
              {overviewExpanded
                ? t`Hide overview`
                : t`Show overview`}
            </span>
            {overviewExpanded ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} />
            )}
          </div>
        </button>

        {overviewExpanded && (
          <div className="px-3 pb-3 space-y-3">
            <div className="flex flex-wrap gap-2">
              {findings.length === 0 ? (
                <div className="text-xs text-secondary">
                  {t`No major issues detected in the current plan summary.`}
                </div>
              ) : (
                findings.map((finding) => {
                  if (!finding) {
                    return null;
                  }

                  const Icon = finding.icon;

                  return (
                    <button
                      key={finding.key}
                      onClick={() => onSelectNode(finding.nodeId)}
                      className={clsx(
                        "min-w-[170px] flex items-start gap-2 rounded-xl border px-3 py-2 text-left transition-colors",
                        getToneClass(finding.tone),
                      )}
                    >
                      <Icon size={14} className="mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-[10px] uppercase tracking-[0.14em] opacity-80">
                          {finding.label}
                        </div>
                        <div className="text-sm font-semibold leading-tight mt-1">
                          {finding.value}
                        </div>
                        <div className="text-[11px] opacity-80 mt-1">
                          {finding.description}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {legend.length > 0 && (
              <div className="rounded-xl border border-default bg-base/45 px-3 py-2.5">
                <div className="flex items-center gap-2 mb-2">
                  <div className="p-1.5 rounded-md bg-cyan-900/30 text-cyan-300">
                    <BookOpenText size={13} />
                  </div>
                  <span className="text-[11px] uppercase tracking-[0.14em] text-muted font-semibold">
                    {t`Driver Notes`}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {legend.map((entry, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-2 text-xs text-secondary leading-relaxed max-w-[720px]"
                    >
                      <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400/80" />
                      <span>{i18n._(entry)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function formatNodeLabel(nodeType: string, relation: string | null): string {
  return relation ? `${nodeType} · ${relation}` : nodeType;
}

function getToneClass(tone: "blue" | "amber" | "red" | "purple"): string {
  switch (tone) {
    case "blue":
      return "border-blue-500/30 bg-blue-950/20 text-blue-200 hover:bg-blue-950/30";
    case "amber":
      return "border-amber-500/30 bg-amber-950/20 text-amber-200 hover:bg-amber-950/30";
    case "red":
      return "border-red-500/30 bg-red-950/20 text-red-200 hover:bg-red-950/30";
    case "purple":
      return "border-fuchsia-500/30 bg-fuchsia-950/20 text-fuchsia-200 hover:bg-fuchsia-950/30";
  }
}
