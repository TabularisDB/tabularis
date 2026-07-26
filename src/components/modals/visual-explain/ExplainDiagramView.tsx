import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import type { ExplainNode, ExplainPlan } from "../../../types/explain";
import type { ExplainDiagnostic } from "../../../utils/explainDiagnostics";
import {
  getAvailableMetricKinds,
  getDefaultMetricKind,
  getMetricMax,
  getMetricValue,
  type ExplainMetricKind,
  type ExplainMetrics,
} from "../../../utils/explainMetrics";
import {
  findExplainNode,
  flattenExplainNodes,
  formatCost,
  formatRows,
  formatTime,
  getHeatBarClass,
} from "../../../utils/explainPlan";
import { ExplainDiagnosticChips } from "../../ui/ExplainDiagnosticChips";
import { ExplainNodeDetails } from "./ExplainNodeDetails";

interface ExplainDiagramViewProps {
  plan: ExplainPlan;
  metrics: ExplainMetrics;
  diagnostics: Map<string, ExplainDiagnostic[]>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const METRIC_LABEL_KEYS: Record<ExplainMetricKind, string> = {
  time: "editor.visualExplain.selfTime",
  rows: "editor.visualExplain.actualRows",
  cost: "editor.visualExplain.selfCost",
  buffers: "editor.visualExplain.buffers",
};

function formatMetricValue(value: number, kind: ExplainMetricKind): string {
  switch (kind) {
    case "time":
      return formatTime(value);
    case "cost":
      return formatCost(value);
    case "rows":
    case "buffers":
      return formatRows(value);
  }
}

/**
 * One row per plan node, each with a bar proportional to the chosen metric.
 * Rows follow plan order and share the selection with the graph view, so a node
 * picked here stays picked when switching views.
 */
export function ExplainDiagramView({
  plan,
  metrics,
  diagnostics,
  selectedId,
  onSelect,
}: ExplainDiagramViewProps) {
  const { t } = useTranslation();

  const availableKinds = useMemo(
    () => getAvailableMetricKinds(metrics),
    [metrics],
  );
  const defaultKind = useMemo(() => getDefaultMetricKind(metrics), [metrics]);
  const [requestedKind, setRequestedKind] = useState<ExplainMetricKind | null>(
    null,
  );

  // A new plan can drop the metric the user picked — a plan without ANALYZE has
  // no timings — so the choice is validated on render rather than reset in an
  // effect.
  const metricKind =
    requestedKind != null && availableKinds.includes(requestedKind)
      ? requestedKind
      : defaultKind;

  const rows = useMemo(() => {
    const nodesById = new Map<string, ExplainNode>(
      flattenExplainNodes(plan.root).map((node) => [node.id, node]),
    );

    return metrics.order.flatMap((nodeMetrics) => {
      const node = nodesById.get(nodeMetrics.nodeId);
      return node ? [{ node, metrics: nodeMetrics }] : [];
    });
  }, [plan, metrics]);

  const max = metricKind != null ? getMetricMax(metrics, metricKind) : 0;
  const selectedNode = findExplainNode(plan.root, selectedId);

  const handleSelect = useCallback(
    (id: string) => {
      onSelect(id);
    },
    [onSelect],
  );

  return (
    <div className="flex h-full">
      <div className="flex-1 min-w-0 flex flex-col border-r border-default">
        {availableKinds.length > 0 && (
          <div className="flex items-center gap-2 border-b border-default bg-base/50 px-4 py-2">
            <span className="text-[11px] uppercase tracking-wide text-muted font-semibold">
              {t("editor.visualExplain.metric")}
            </span>
            <div className="flex items-center gap-1 rounded-lg bg-surface-secondary p-0.5">
              {availableKinds.map((kind) => (
                <button
                  key={kind}
                  onClick={() => setRequestedKind(kind)}
                  className={clsx(
                    "rounded px-2 py-1 text-xs transition-colors",
                    metricKind === kind
                      ? "bg-blue-900/40 text-blue-300"
                      : "text-muted hover:text-primary",
                  )}
                >
                  {t(METRIC_LABEL_KEYS[kind])}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-auto">
          {rows.length === 0 || metricKind == null ? (
            <div className="p-4 text-xs text-muted">
              {t("editor.visualExplain.noMetricData")}
            </div>
          ) : (
            <table className="w-full text-xs">
              <tbody>
                {rows.map(({ node, metrics: nodeMetrics }) => {
                  const value = getMetricValue(nodeMetrics, metricKind);
                  const ratio = value != null && max > 0 ? value / max : 0;
                  const nodeDiagnostics = diagnostics.get(node.id) ?? [];
                  const isSelected = selectedId === node.id;

                  return (
                    <tr
                      key={node.id}
                      onClick={() => handleSelect(node.id)}
                      className={clsx(
                        "cursor-pointer border-b border-default/30 transition-colors",
                        isSelected ? "bg-blue-900/30" : "hover:bg-surface-hover",
                      )}
                    >
                      <td className="w-10 px-3 py-1.5 align-top font-mono text-[10px] text-muted">
                        #{nodeMetrics.index}
                      </td>
                      <td className="px-1 py-1.5 align-top">
                        <div
                          style={{ paddingLeft: `${nodeMetrics.depth * 12}px` }}
                          className="min-w-0"
                        >
                          <div className="truncate font-medium text-primary">
                            {node.node_type}
                          </div>
                          {node.relation && (
                            <div className="truncate text-[11px] text-muted">
                              {node.relation}
                            </div>
                          )}
                          {nodeDiagnostics.length > 0 && (
                            <ExplainDiagnosticChips
                              diagnostics={nodeDiagnostics}
                              iconsOnly
                              className="mt-1"
                            />
                          )}
                        </div>
                      </td>
                      <td className="w-1/2 px-3 py-1.5 align-middle">
                        <div className="h-2.5 w-full overflow-hidden rounded bg-surface-secondary/60">
                          <div
                            className={clsx(
                              "h-full rounded transition-all",
                              getHeatBarClass(value ?? 0, max),
                            )}
                            style={{
                              width: `${Math.min(100, Math.max(ratio * 100, value != null && value > 0 ? 1 : 0))}%`,
                            }}
                          />
                        </div>
                      </td>
                      <td className="w-24 whitespace-nowrap px-3 py-1.5 text-right align-middle font-mono text-secondary">
                        {value != null ? formatMetricValue(value, metricKind) : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="w-[320px] shrink-0 overflow-y-auto bg-base/50">
        <ExplainNodeDetails
          node={selectedNode}
          hasAnalyzeData={plan.has_analyze_data}
          metrics={selectedNode ? metrics.byId.get(selectedNode.id) ?? null : null}
          diagnostics={selectedNode ? diagnostics.get(selectedNode.id) ?? [] : []}
        />
      </div>
    </div>
  );
}
