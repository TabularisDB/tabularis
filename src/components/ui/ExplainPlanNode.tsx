import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import type { ExplainNode } from "../../types/explain";
import type { ExplainNodeMetrics } from "../../utils/explainMetrics";
import type { ExplainDiagnostic } from "../../utils/explainDiagnostics";
import {
  getNodeCostStyle,
  formatCost,
  formatRatio,
  getRowEstimateRatio,
  formatTime,
  formatRows,
} from "../../utils/explainPlan";
import { ExplainDiagnosticChips } from "./ExplainDiagnosticChips";
import clsx from "clsx";

export interface ExplainPlanNodeData extends Record<string, unknown> {
  node: ExplainNode;
  metrics: ExplainNodeMetrics | null;
  /** Largest exclusive cost in the plan, used to scale the heat colour. */
  maxExclusiveCost: number;
  /** Largest exclusive time in the plan, used to scale the heat colour. */
  maxExclusiveTimeMs: number;
  diagnostics: ExplainDiagnostic[];
  hasAnalyzeData: boolean;
  isSelected: boolean;
}

export type ExplainPlanNodeType = Node<ExplainPlanNodeData, "explainPlan">;

export const ExplainPlanNodeComponent = memo(
  ({ data }: NodeProps<ExplainPlanNodeType>) => {
    const { t } = useTranslation();
    const {
      node,
      metrics,
      maxExclusiveCost,
      maxExclusiveTimeMs,
      diagnostics,
      hasAnalyzeData,
      isSelected,
    } = data;

    // Colour by measured self time when the plan was run with ANALYZE, and by
    // self cost otherwise. Both are exclusive, so the heat points at the step
    // doing the work instead of at the plan root.
    const useTimeHeat = hasAnalyzeData && maxExclusiveTimeMs > 0;
    const costStyle = useTimeHeat
      ? getNodeCostStyle(metrics?.exclusiveTimeMs ?? 0, maxExclusiveTimeMs)
      : getNodeCostStyle(metrics?.exclusiveCost ?? 0, maxExclusiveCost);

    const rowRatio = getRowEstimateRatio(node);
    const mismatch =
      rowRatio != null && (rowRatio >= 4 || rowRatio <= 0.25)
        ? rowRatio >= 1
          ? {
              value: formatRatio(rowRatio),
              label: t("editor.visualExplain.overEstimate"),
            }
          : {
              value: formatRatio(1 / rowRatio),
              label: t("editor.visualExplain.underEstimate"),
            }
        : null;

    return (
      <div
        className={clsx(
          "bg-elevated border border-strong rounded shadow-xl min-w-[260px] max-w-[300px] overflow-hidden transition-all",
          "border-l-4",
          costStyle.border,
          isSelected && "ring-2 ring-blue-400/70 border-blue-400/70",
        )}
      >
        {/* Header */}
        <div className={clsx("px-3 py-2 border-b border-default", costStyle.headerBg)}>
          <div className="flex items-center gap-2">
            {metrics && (
              <span className="shrink-0 rounded bg-surface-secondary/70 px-1.5 py-0.5 font-mono text-[10px] text-muted">
                #{metrics.index}
              </span>
            )}
            <div className="text-sm font-bold text-primary">{node.node_type}</div>
          </div>
          {node.relation && (
            <div className="text-xs text-muted mt-0.5">
              {t("editor.visualExplain.relation")}: {node.relation}
            </div>
          )}
        </div>

        {/* Metrics */}
        <div className="px-3 py-2 space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted">
              {t("editor.visualExplain.estRows")}
            </span>
            <span className="text-secondary font-mono">
              {node.plan_rows != null ? formatRows(node.plan_rows) : "-"}
            </span>
          </div>

          {metrics?.exclusiveCost != null && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted">
                {t("editor.visualExplain.selfCost")}
              </span>
              <span className="text-secondary font-mono">
                {formatCost(metrics.exclusiveCost)}
              </span>
            </div>
          )}

          {mismatch && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted">
                {t("editor.visualExplain.largestEstimateGap")}
              </span>
              <span className="text-amber-300 font-mono font-semibold">
                {mismatch.value}
              </span>
            </div>
          )}

          {hasAnalyzeData && node.actual_rows != null && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted">
                {t("editor.visualExplain.actualRows")}
              </span>
              <span className="text-primary font-mono font-semibold">
                {formatRows(node.actual_rows)}
              </span>
            </div>
          )}

          {hasAnalyzeData && metrics?.exclusiveTimeMs != null && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted">
                {t("editor.visualExplain.selfTime")}
              </span>
              <span className="text-primary font-mono font-semibold">
                {formatTime(metrics.exclusiveTimeMs)}
                {metrics.timeShare != null && (
                  <span className="ml-1 text-muted font-normal">
                    ({Math.round(metrics.timeShare * 100)}%)
                  </span>
                )}
              </span>
            </div>
          )}

          {hasAnalyzeData && metrics?.inclusiveTimeMs != null && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted">
                {t("editor.visualExplain.totalTime")}
              </span>
              <span className="text-secondary font-mono">
                {formatTime(metrics.inclusiveTimeMs)}
              </span>
            </div>
          )}

          {hasAnalyzeData && node.actual_loops != null && node.actual_loops > 1 && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted">
                {t("editor.visualExplain.loops")}
              </span>
              <span className="text-secondary font-mono">
                {node.actual_loops}
              </span>
            </div>
          )}

          {diagnostics.length > 0 && (
            <ExplainDiagnosticChips
              diagnostics={diagnostics}
              className="border-t border-default/50 pt-1.5"
            />
          )}

          {node.filter && (
            <div className="text-[10px] text-muted mt-1 font-mono truncate border-t border-default/50 pt-1">
              {t("editor.visualExplain.filter")}: {node.filter}
            </div>
          )}

          {node.index_condition && (
            <div className="text-[10px] text-muted font-mono truncate">
              {t("editor.visualExplain.indexCondition")}: {node.index_condition}
            </div>
          )}
        </div>

        <Handle
          type="target"
          position={Position.Top}
          className="!w-2 !h-2 !bg-indigo-500 !border-strong"
        />
        <Handle
          type="source"
          position={Position.Bottom}
          className="!w-2 !h-2 !bg-indigo-500 !border-strong"
        />
      </div>
    );
  },
);
