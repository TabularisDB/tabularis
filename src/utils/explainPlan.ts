import type { Node, Edge } from "@xyflow/react";
import type { ExplainNode, ExplainPlan } from "../types/explain";
import type { ExplainPlanNodeData } from "../components/ui/ExplainPlanNode";
import type { ExplainMetrics } from "./explainMetrics";
import { computeExplainMetrics } from "./explainMetrics";
import type { ExplainDiagnostic } from "./explainDiagnostics";
import dagre from "dagre";

// ---------------------------------------------------------------------------
// Tree → ReactFlow conversion
// ---------------------------------------------------------------------------

/**
 * Build the ReactFlow graph for a plan.
 *
 * `metrics` and `diagnostics` may be supplied by a caller that already computed
 * them for other views, so a plan is only walked once per render. Diagnostics
 * are passed in rather than derived here, which keeps this module independent of
 * `explainDiagnostics` — that module needs the helpers below.
 */
export function explainPlanToFlow(
  plan: ExplainPlan,
  selectedNodeId?: string | null,
  metrics?: ExplainMetrics,
  diagnostics?: Map<string, ExplainDiagnostic[]>,
): {
  nodes: Node[];
  edges: Edge[];
} {
  const planMetrics = metrics ?? computeExplainMetrics(plan);
  const rawNodes: Node[] = [];
  const edges: Edge[] = [];

  function walk(node: ExplainNode) {
    const nodeMetrics = planMetrics.byId.get(node.id);
    const data: ExplainPlanNodeData = {
      node,
      metrics: nodeMetrics ?? null,
      maxExclusiveCost: planMetrics.maxExclusiveCost,
      maxExclusiveTimeMs: planMetrics.maxExclusiveTimeMs,
      diagnostics: diagnostics?.get(node.id) ?? [],
      hasAnalyzeData: plan.has_analyze_data,
      isSelected: selectedNodeId === node.id,
    };

    rawNodes.push({
      id: node.id,
      type: "explainPlan",
      position: { x: 0, y: 0 },
      data,
    });

    for (const child of node.children) {
      edges.push({
        id: `${node.id}-${child.id}`,
        source: node.id,
        target: child.id,
        animated: true,
        style: { stroke: "#6366f1" },
      });
      walk(child);
    }
  }

  walk(plan.root);

  return layoutExplainNodes(rawNodes, edges);
}

// ---------------------------------------------------------------------------
// Dagre layout
// ---------------------------------------------------------------------------

export function layoutExplainNodes(
  nodes: Node[],
  edges: Edge[],
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", ranksep: 80, nodesep: 40 });

  const NODE_WIDTH = 280;

  for (const node of nodes) {
    const data = node.data as ExplainPlanNodeData;
    const lines =
      3 +
      (data.hasAnalyzeData ? 2 : 0) +
      (data.node.filter ? 1 : 0) +
      (data.diagnostics.length > 0 ? 1 : 0);
    const height = 28 + lines * 22;
    g.setNode(node.id, { width: NODE_WIDTH, height });
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - pos.height / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

export interface NodeCostStyle {
  border: string;
  headerBg: string;
}

export interface ExplainMetricNode {
  nodeId: string;
  nodeType: string;
  relation: string | null;
  value: number;
  ratio?: number;
}

export interface ExplainPlanSummary {
  /** Node with the highest cost of its own, children excluded. */
  highestCostNode: ExplainMetricNode | null;
  /** Node that spent the most time in itself, children excluded. */
  slowestNode: ExplainMetricNode | null;
  largestRowMismatchNode: ExplainMetricNode | null;
  sequentialScans: number;
  tempOperations: number;
}

/**
 * Heat colour for one node, given the largest value in the plan. Callers pass
 * *exclusive* values: an inclusive one would paint the plan root red in every
 * plan and hide the actual bottleneck.
 */
export function getNodeCostStyle(cost: number, maxCost: number): NodeCostStyle {
  if (maxCost <= 0) return { border: "border-l-green-500", headerBg: "bg-green-950/30" };
  const ratio = cost / maxCost;
  if (ratio < 0.2) return { border: "border-l-green-500", headerBg: "bg-green-950/30" };
  if (ratio < 0.6) return { border: "border-l-yellow-500", headerBg: "bg-yellow-950/30" };
  return { border: "border-l-red-500", headerBg: "bg-red-950/30" };
}

/**
 * Fill colour for a proportional bar, on the same yellow-to-red scale as the
 * graph nodes. Callers pass exclusive values, as for {@link getNodeCostStyle}.
 */
export function getHeatBarClass(value: number, max: number): string {
  if (max <= 0) return "bg-green-500/70";
  const ratio = value / max;
  if (ratio < 0.2) return "bg-green-500/70";
  if (ratio < 0.6) return "bg-yellow-500/70";
  return "bg-red-500/70";
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

export function formatCost(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n >= 100) return n.toFixed(0);
  if (n >= 1) return n.toFixed(1);
  return n.toFixed(2);
}

export function formatTime(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  if (ms >= 1) return `${ms.toFixed(2)} ms`;
  return `${(ms * 1000).toFixed(0)} us`;
}

export function formatRows(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

export function formatRatio(n: number): string {
  if (n >= 100) return `${n.toFixed(0)}x`;
  if (n >= 10) return `${n.toFixed(1)}x`;
  return `${n.toFixed(2)}x`;
}

// ---------------------------------------------------------------------------
// Tree traversal helpers
// ---------------------------------------------------------------------------

export function getMaxCost(node: ExplainNode): number {
  let max = node.total_cost ?? 0;
  for (const child of node.children) {
    const childMax = getMaxCost(child);
    if (childMax > max) max = childMax;
  }
  return max;
}

export function getMaxTime(node: ExplainNode): number {
  let max = node.actual_time_ms ?? 0;
  for (const child of node.children) {
    const childMax = getMaxTime(child);
    if (childMax > max) max = childMax;
  }
  return max;
}

export function flattenExplainNodes(root: ExplainNode): ExplainNode[] {
  const nodes: ExplainNode[] = [];

  function walk(node: ExplainNode) {
    nodes.push(node);
    for (const child of node.children) {
      walk(child);
    }
  }

  walk(root);

  return nodes;
}

export function findExplainNode(
  root: ExplainNode,
  nodeId: string | null,
): ExplainNode | null {
  if (!nodeId) {
    return null;
  }

  if (root.id === nodeId) {
    return root;
  }

  for (const child of root.children) {
    const found = findExplainNode(child, nodeId);
    if (found) {
      return found;
    }
  }

  return null;
}

export function getRowEstimateRatio(node: ExplainNode): number | null {
  if (
    node.plan_rows == null ||
    node.actual_rows == null ||
    node.plan_rows <= 0 ||
    node.actual_rows <= 0
  ) {
    return null;
  }

  return node.actual_rows / node.plan_rows;
}

function getMismatchMagnitude(node: ExplainNode): number | null {
  const ratio = getRowEstimateRatio(node);
  if (ratio == null) {
    return null;
  }

  return ratio >= 1 ? ratio : 1 / ratio;
}

function isSequentialScan(node: ExplainNode): boolean {
  const normalizedType = node.node_type.toLowerCase();
  const accessType =
    typeof node.extra.access_type === "string"
      ? node.extra.access_type.toLowerCase()
      : "";

  return (
    normalizedType.includes("seq scan") ||
    normalizedType.includes("table scan") ||
    normalizedType.includes("full scan") ||
    accessType === "all"
  );
}

function isTempOperation(node: ExplainNode): boolean {
  const normalizedType = node.node_type.toLowerCase();
  const extraText = Object.values(node.extra)
    .filter((value) => typeof value === "string")
    .join(" ")
    .toLowerCase();

  return (
    normalizedType.includes("sort") ||
    normalizedType.includes("filesort") ||
    normalizedType.includes("temporary") ||
    extraText.includes("using temporary") ||
    extraText.includes("using filesort")
  );
}

/**
 * Headline findings for the overview bar. Cost and time are ranked on each
 * node's own contribution, so the winner is the step to look at rather than
 * whichever node happens to sit closest to the plan root.
 */
export function getExplainPlanSummary(
  plan: ExplainPlan,
  metrics?: ExplainMetrics,
): ExplainPlanSummary {
  const nodes = flattenExplainNodes(plan.root);
  const planMetrics = metrics ?? computeExplainMetrics(plan);

  let highestCostNode: ExplainMetricNode | null = null;
  let slowestNode: ExplainMetricNode | null = null;
  let largestRowMismatchNode: ExplainMetricNode | null = null;
  let sequentialScans = 0;
  let tempOperations = 0;

  for (const node of nodes) {
    const nodeMetrics = planMetrics.byId.get(node.id);
    const exclusiveCost = nodeMetrics?.exclusiveCost ?? null;
    const exclusiveTimeMs = nodeMetrics?.exclusiveTimeMs ?? null;

    if (
      exclusiveCost != null &&
      (highestCostNode == null || exclusiveCost > highestCostNode.value)
    ) {
      highestCostNode = {
        nodeId: node.id,
        nodeType: node.node_type,
        relation: node.relation,
        value: exclusiveCost,
      };
    }

    if (
      exclusiveTimeMs != null &&
      (slowestNode == null || exclusiveTimeMs > slowestNode.value)
    ) {
      slowestNode = {
        nodeId: node.id,
        nodeType: node.node_type,
        relation: node.relation,
        value: exclusiveTimeMs,
      };
    }

    const ratio = getRowEstimateRatio(node);
    const magnitude = getMismatchMagnitude(node);
    if (
      ratio != null &&
      magnitude != null &&
      (largestRowMismatchNode == null || magnitude > largestRowMismatchNode.value)
    ) {
      largestRowMismatchNode = {
        nodeId: node.id,
        nodeType: node.node_type,
        relation: node.relation,
        value: magnitude,
        ratio,
      };
    }

    if (isSequentialScan(node)) {
      sequentialScans += 1;
    }

    if (isTempOperation(node)) {
      tempOperations += 1;
    }
  }

  return {
    highestCostNode,
    slowestNode,
    largestRowMismatchNode,
    sequentialScans,
    tempOperations,
  };
}

export function getExplainDriverLegend(plan: ExplainPlan): string[] {
  switch (plan.driver) {
    case "postgres":
      return plan.has_analyze_data
        ? [
            "editor.visualExplain.postgresAnalyzeLegend1",
            "editor.visualExplain.postgresAnalyzeLegend2",
          ]
        : [
            "editor.visualExplain.postgresEstimateLegend1",
            "editor.visualExplain.postgresEstimateLegend2",
          ];
    case "mysql":
      return plan.has_analyze_data
        ? [
            "editor.visualExplain.mysqlAnalyzeLegend1",
            "editor.visualExplain.mysqlAnalyzeLegend2",
          ]
        : [
            "editor.visualExplain.mysqlEstimateLegend1",
            "editor.visualExplain.mysqlEstimateLegend2",
          ];
    case "sqlite":
      return [
        "editor.visualExplain.sqliteLegend1",
        "editor.visualExplain.sqliteLegend2",
      ];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Query type detection
// ---------------------------------------------------------------------------

export function isDataModifyingQuery(query: string): boolean {
  const trimmed = query.trim().toUpperCase();
  return (
    trimmed.startsWith("INSERT") ||
    trimmed.startsWith("UPDATE") ||
    trimmed.startsWith("DELETE") ||
    trimmed.startsWith("DROP") ||
    trimmed.startsWith("ALTER") ||
    trimmed.startsWith("TRUNCATE")
  );
}
