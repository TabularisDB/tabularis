import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import type { ExplainNode } from "../../types/explain";
import {
  getNodeCostStyle,
  formatCost,
  formatRatio,
  getRowEstimateRatio,
  formatTime,
  formatRows,
} from "../../utils/explainPlan";
import clsx from "clsx";

export interface ExplainPlanNodeData extends Record<string, unknown> {
  node: ExplainNode;
  maxCost: number;
  maxTime: number;
  hasAnalyzeData: boolean;
  isSelected: boolean;
}

export type ExplainPlanNodeType = Node<ExplainPlanNodeData, "explainPlan">;

export const ExplainPlanNodeComponent = memo(
  ({ data }: NodeProps<ExplainPlanNodeType>) => {
    const { t } = useTranslation();
    const { node, maxCost, hasAnalyzeData, isSelected } = data;
    const costStyle = getNodeCostStyle(node.total_cost ?? 0, maxCost);
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
          <div className="text-sm font-bold text-primary">{node.node_type}</div>
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

          {node.total_cost != null && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted">
                {t("editor.visualExplain.cost")}
              </span>
              <span className="text-secondary font-mono">
                {formatCost(node.total_cost)}
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

          {hasAnalyzeData && node.actual_time_ms != null && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted">
                {t("editor.visualExplain.time")}
              </span>
              <span className="text-primary font-mono font-semibold">
                {formatTime(node.actual_time_ms)}
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

          {mismatch && (
            <div className="text-[10px] text-amber-300 font-mono truncate">
              {mismatch.label}
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
