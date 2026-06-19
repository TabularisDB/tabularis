import { memo } from "react";
import { useLingui } from "@lingui/react/macro";
import { FileText, Sparkles, TableProperties, Network } from "lucide-react";
import type { ExplainPlan } from "../../../types/explain";
import { formatTime, formatCost, getMaxCost } from "../../../utils/explainPlan";

export type ExplainViewMode = "graph" | "table" | "raw" | "ai";

interface ExplainSummaryBarProps {
  plan: ExplainPlan | null;
  viewMode: ExplainViewMode;
  onViewModeChange: (mode: ExplainViewMode) => void;
  aiEnabled: boolean;
}

export const ExplainSummaryBar = memo(
  ({ plan, viewMode, onViewModeChange, aiEnabled }: ExplainSummaryBarProps) => {
    const { t } = useLingui();

    if (!plan) return null;

    const maxCost = getMaxCost(plan.root);

    const toggleButtonClass = (mode: ExplainViewMode) =>
      `flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
        viewMode === mode
          ? mode === "ai"
            ? "bg-purple-900/40 text-purple-300"
            : "bg-blue-900/40 text-blue-300"
          : "text-muted hover:text-primary"
      }`;

    return (
      <div className="flex items-center gap-4 px-4 py-2 border-b border-default bg-base/50 text-xs">
        {plan.planning_time_ms != null && (
          <div className="flex items-center gap-1.5">
            <span className="text-muted">
              {t`Planning`}:
            </span>
            <span className="text-primary font-mono font-semibold">
              {formatTime(plan.planning_time_ms)}
            </span>
          </div>
        )}

        {plan.execution_time_ms != null && (
          <div className="flex items-center gap-1.5">
            <span className="text-muted">
              {t`Execution`}:
            </span>
            <span className="text-primary font-mono font-semibold">
              {formatTime(plan.execution_time_ms)}
            </span>
          </div>
        )}

        {maxCost > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-muted">
              {t`Total Cost`}:
            </span>
            <span className="text-primary font-mono font-semibold">
              {formatCost(maxCost)}
            </span>
          </div>
        )}

        <div className="flex-1" />

        <div className="flex items-center gap-1 bg-surface-secondary rounded-lg p-0.5">
          <button
            onClick={() => onViewModeChange("graph")}
            className={toggleButtonClass("graph")}
          >
            <Network size={12} />
            {t`Graph`}
          </button>
          <button
            onClick={() => onViewModeChange("table")}
            className={toggleButtonClass("table")}
          >
            <TableProperties size={12} />
            {t({ message: "Table", context: "editor" })}
          </button>
          <button
            onClick={() => onViewModeChange("raw")}
            className={toggleButtonClass("raw")}
          >
            <FileText size={12} />
            {t`Raw Output`}
          </button>
          {aiEnabled && (
            <button
              onClick={() => onViewModeChange("ai")}
              className={toggleButtonClass("ai")}
            >
              <Sparkles size={12} />
              {t`AI Analysis`}
            </button>
          )}
        </div>
      </div>
    );
  },
);
