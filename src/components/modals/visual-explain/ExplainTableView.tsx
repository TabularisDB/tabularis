import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, ChevronDown } from "lucide-react";
import clsx from "clsx";
import type { ExplainNode, ExplainPlan } from "../../../types/explain";
import { formatCost, formatTime, formatRows } from "../../../utils/explainPlan";

interface ExplainTableViewProps {
  plan: ExplainPlan;
}

export function ExplainTableView({ plan }: ExplainTableViewProps) {
  const { t } = useTranslation();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    // Expand all nodes by default
    const ids = new Set<string>();
    function collectIds(node: ExplainNode) {
      ids.add(node.id);
      for (const child of node.children) collectIds(child);
    }
    collectIds(plan.root);
    return ids;
  });
  const [selectedId, setSelectedId] = useState<string | null>(
    plan.root.id,
  );

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectedNode = findNode(plan.root, selectedId);

  return (
    <div className="flex h-full">
      {/* Left: Tree Table */}
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
              onSelect={setSelectedId}
              hasAnalyzeData={plan.has_analyze_data}
            />
          </tbody>
        </table>
      </div>

      {/* Right: Detail Panel */}
      <div className="w-[320px] shrink-0 overflow-y-auto bg-base/50">
        {selectedNode ? (
          <NodeDetailPanel
            node={selectedNode}
            hasAnalyzeData={plan.has_analyze_data}
          />
        ) : (
          <div className="p-4 text-xs text-muted">
            {t("editor.visualExplain.selectNode")}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tree Rows (recursive)
// ---------------------------------------------------------------------------

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

  return (
    <>
      <tr
        className={clsx(
          "cursor-pointer transition-colors border-b border-default/30",
          isSelected
            ? "bg-blue-900/30"
            : "hover:bg-surface-hover",
        )}
        onClick={() => onSelect(node.id)}
      >
        {/* Node Type with indentation + expand toggle */}
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

// ---------------------------------------------------------------------------
// Detail Panel
// ---------------------------------------------------------------------------

interface NodeDetailPanelProps {
  node: ExplainNode;
  hasAnalyzeData: boolean;
}

function NodeDetailPanel({ node, hasAnalyzeData }: NodeDetailPanelProps) {
  const { t } = useTranslation();

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
        ...(node.actual_time_ms != null
          ? [[t("editor.visualExplain.time"), formatTime(node.actual_time_ms)] as [string, string]]
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
    ([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)],
  );

  return (
    <div className="text-xs">
      <DetailSection title={t("editor.visualExplain.general")} entries={generalEntries} />
      {analyzeEntries.length > 0 && (
        <DetailSection title={t("editor.visualExplain.analyzeData")} entries={analyzeEntries} />
      )}
      {extraEntries.length > 0 && (
        <DetailSection title={t("editor.visualExplain.extraDetails")} entries={extraEntries} />
      )}
    </div>
  );
}

function DetailSection({
  title,
  entries,
}: {
  title: string;
  entries: [string, string][];
}) {
  return (
    <div className="border-b border-default">
      <div className="px-3 py-1.5 bg-base text-muted font-semibold uppercase tracking-wider text-[10px]">
        {title}
      </div>
      {entries.map(([name, value], i) => (
        <div
          key={`${name}-${i}`}
          className="flex items-start justify-between px-3 py-1 border-b border-default/30 last:border-0"
        >
          <span className="text-muted shrink-0 mr-3">{name}</span>
          <span className="text-primary font-mono text-right break-all">
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findNode(
  root: ExplainNode,
  id: string | null,
): ExplainNode | null {
  if (!id) return null;
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}
