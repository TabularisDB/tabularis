import { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, ChevronDown } from "lucide-react";
import clsx from "clsx";
import type { ExplainNode, ExplainPlan } from "../../../types/explain";
import {
  findExplainNode,
  formatCost,
  formatRatio,
  formatRows,
  formatTime,
  getRowEstimateRatio,
} from "../../../utils/explainPlan";
import { ExplainNodeDetails } from "./ExplainNodeDetails";

interface ExplainTableViewProps {
  plan: ExplainPlan;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function ExplainTableView({
  plan,
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
              <th className="text-right px-3 py-2 text-muted font-semibold whitespace-nowrap">
                {t("editor.visualExplain.time")}
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
            />
          </tbody>
        </table>
      </div>

      <div className="w-[320px] shrink-0 overflow-y-auto bg-base/50">
        <ExplainNodeDetails
          node={selectedNode}
          hasAnalyzeData={plan.has_analyze_data}
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
}

function TreeRows({
  node,
  depth,
  expandedIds,
  selectedId,
  onToggle,
  onSelect,
  hasAnalyzeData,
}: TreeRowsProps) {
  const isExpanded = expandedIds.has(node.id);
  const hasChildren = node.children.length > 0;
  const isSelected = selectedId === node.id;

  const costStr =
    node.startup_cost != null && node.total_cost != null
      ? `${formatCost(node.startup_cost)} - ${formatCost(node.total_cost)}`
      : node.total_cost != null
        ? formatCost(node.total_cost)
        : "-";

  const timeStr =
    hasAnalyzeData && node.actual_time_ms != null
      ? formatTime(node.actual_time_ms)
      : "-";

  const rowsStr = node.plan_rows != null ? formatRows(node.plan_rows) : "-";
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
