import { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, ChevronDown } from "lucide-react";
import clsx from "clsx";
import type { ExplainNode, ExplainPlan } from "../types";
import type {
  ExplainMetrics,
  ExplainNodeMetrics,
} from "../metrics";
import type { ExplainDiagnostic } from "../diagnostics";
import {
  findExplainNode,
  formatCost,
  formatRatio,
  formatRows,
  formatTime,
  getRowEstimateRatio,
} from "../plan";
import { ExplainDiagnosticChips } from "./ExplainDiagnosticChips";
import { ExplainNodeDetails } from "./ExplainNodeDetails";

interface ExplainTableViewProps {
  plan: ExplainPlan;
  metrics: ExplainMetrics;
  diagnostics: Map<string, ExplainDiagnostic[]>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function ExplainTableView({
  plan,
  metrics,
  diagnostics,
  selectedId,
  onSelect,
}: ExplainTableViewProps) {
  const { t } = useTranslation();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() =>
    collectExpandedIds(plan.root),
  );

  useEffect(() => {
    setExpandedIds(collectExpandedIds(plan.root));
  }, [plan]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectedNode = findExplainNode(plan.root, selectedId);

  return (
    <div className="flex h-full">
      <div className="flex-1 overflow-auto border-r border-default min-w-0">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-base border-b border-default">
            <tr>
              <th className="text-left px-3 py-2 text-muted font-semibold whitespace-nowrap">
                #
              </th>
              <th className="text-left px-3 py-2 text-muted font-semibold whitespace-nowrap">
                {t("editor.visualExplain.nodeType")}
              </th>
              <th className="text-left px-3 py-2 text-muted font-semibold whitespace-nowrap">
                {t("editor.visualExplain.relation")}
              </th>
              <th className="text-right px-3 py-2 text-muted font-semibold whitespace-nowrap">
                {t("editor.visualExplain.cost")}
              </th>
              <th className="text-right px-3 py-2 text-muted font-semibold whitespace-nowrap">
                {t("editor.visualExplain.estRows")}
              </th>
              {plan.has_analyze_data && (
                <th className="text-right px-3 py-2 text-muted font-semibold whitespace-nowrap">
                  {t("editor.visualExplain.actualRows")}
                </th>
              )}
              <th className="text-right px-3 py-2 text-muted font-semibold whitespace-nowrap">
                {t("editor.visualExplain.selfTime")}
              </th>
              <th className="text-right px-3 py-2 text-muted font-semibold whitespace-nowrap">
                {t("editor.visualExplain.largestEstimateGap")}
              </th>
              <th className="text-left px-3 py-2 text-muted font-semibold whitespace-nowrap">
                {t("editor.visualExplain.filter")}
              </th>
            </tr>
          </thead>
          <tbody>
            <TreeRows
              node={plan.root}
              depth={0}
              expandedIds={expandedIds}
              selectedId={selectedId}
              onToggle={toggleExpand}
              onSelect={onSelect}
              hasAnalyzeData={plan.has_analyze_data}
              metrics={metrics}
              diagnostics={diagnostics}
            />
          </tbody>
        </table>
      </div>

      <div className="w-[320px] shrink-0 overflow-y-auto bg-base/50">
        <ExplainNodeDetails
          node={selectedNode}
          hasAnalyzeData={plan.has_analyze_data}
          metrics={
            selectedNode ? metrics.byId.get(selectedNode.id) ?? null : null
          }
          diagnostics={selectedNode ? diagnostics.get(selectedNode.id) ?? [] : []}
        />
      </div>
    </div>
  );
}

interface TreeRowsProps {
  node: ExplainNode;
  depth: number;
  expandedIds: Set<string>;
  selectedId: string | null;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  hasAnalyzeData: boolean;
  metrics: ExplainMetrics;
  diagnostics: Map<string, ExplainDiagnostic[]>;
}

function TreeRows({
  node,
  depth,
  expandedIds,
  selectedId,
  onToggle,
  onSelect,
  hasAnalyzeData,
  metrics,
  diagnostics,
}: TreeRowsProps) {
  const isExpanded = expandedIds.has(node.id);
  const hasChildren = node.children.length > 0;
  const isSelected = selectedId === node.id;
  const nodeMetrics: ExplainNodeMetrics | undefined = metrics.byId.get(node.id);
  const nodeDiagnostics = diagnostics.get(node.id) ?? [];

  const costStr =
    node.startup_cost != null && node.total_cost != null
      ? `${formatCost(node.startup_cost)} - ${formatCost(node.total_cost)}`
      : node.total_cost != null
        ? formatCost(node.total_cost)
        : "-";

  const timeStr =
    hasAnalyzeData && nodeMetrics?.exclusiveTimeMs != null
      ? formatTime(nodeMetrics.exclusiveTimeMs)
      : "-";

  const rowsStr = node.plan_rows != null ? formatRows(node.plan_rows) : "-";
  const actualRowsStr =
    hasAnalyzeData && node.actual_rows != null
      ? formatRows(node.actual_rows)
      : "-";
  const rowRatio = getRowEstimateRatio(node);
  const ratioStr =
    rowRatio != null
      ? rowRatio >= 1
        ? formatRatio(rowRatio)
        : formatRatio(1 / rowRatio)
      : "-";

  return (
    <>
      <tr
        className={clsx(
          "cursor-pointer transition-colors border-b border-default/30",
          isSelected ? "bg-blue-900/30" : "hover:bg-surface-hover",
        )}
        onClick={() => onSelect(node.id)}
      >
        <td className="px-3 py-1.5 font-mono text-[10px] text-muted whitespace-nowrap">
          {nodeMetrics ? `#${nodeMetrics.index}` : ""}
        </td>
        <td className="px-3 py-1.5 whitespace-nowrap">
          <div
            className="flex items-center gap-1"
            style={{ paddingLeft: `${depth * 20}px` }}
          >
            {hasChildren ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(node.id);
                }}
                className="p-0.5 text-muted hover:text-primary"
              >
                {isExpanded ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )}
              </button>
            ) : (
              <span className="w-4" />
            )}
            <span className="text-primary font-medium">{node.node_type}</span>
            {nodeDiagnostics.length > 0 && (
              <ExplainDiagnosticChips diagnostics={nodeDiagnostics} iconsOnly />
            )}
          </div>
        </td>
        <td className="px-3 py-1.5 text-secondary whitespace-nowrap">
          {node.relation ?? ""}
        </td>
        <td className="px-3 py-1.5 text-right text-secondary font-mono whitespace-nowrap">
          {costStr}
        </td>
        <td className="px-3 py-1.5 text-right text-secondary font-mono whitespace-nowrap">
          {rowsStr}
        </td>
        {hasAnalyzeData && (
          <td className="px-3 py-1.5 text-right text-secondary font-mono whitespace-nowrap">
            {actualRowsStr}
          </td>
        )}
        <td className="px-3 py-1.5 text-right text-secondary font-mono whitespace-nowrap">
          {timeStr}
        </td>
        <td className="px-3 py-1.5 text-right whitespace-nowrap">
          <span
            className={clsx(
              "font-mono",
              rowRatio == null
                ? "text-secondary"
                : rowRatio >= 4 || rowRatio <= 0.25
                  ? "text-amber-300"
                  : "text-secondary",
            )}
          >
            {ratioStr}
          </span>
        </td>
        <td className="px-3 py-1.5 text-muted truncate max-w-[200px]">
          {node.filter ?? ""}
        </td>
      </tr>
      {isExpanded &&
        node.children.map((child) => (
          <TreeRows
            key={child.id}
            node={child}
            depth={depth + 1}
            expandedIds={expandedIds}
            selectedId={selectedId}
            onToggle={onToggle}
            onSelect={onSelect}
            hasAnalyzeData={hasAnalyzeData}
            metrics={metrics}
            diagnostics={diagnostics}
          />
        ))}
    </>
  );
}

function collectExpandedIds(root: ExplainNode): Set<string> {
  const ids = new Set<string>();

  function walk(node: ExplainNode) {
    ids.add(node.id);
    for (const child of node.children) {
      walk(child);
    }
  }

  walk(root);

  return ids;
}
