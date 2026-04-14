import type { Node, Edge } from "@xyflow/react";
import type { ExplainNode, ExplainPlan } from "../types/explain";
import type { ExplainPlanNodeData } from "../components/ui/ExplainPlanNode";
import dagre from "dagre";

// ---------------------------------------------------------------------------
// Tree → ReactFlow conversion
// ---------------------------------------------------------------------------

export function explainPlanToFlow(
  plan: ExplainPlan,
  selectedNodeId?: string | null,
): {
  nodes: Node[];
  edges: Edge[];
} {
  const maxCost = getMaxCost(plan.root);
  const maxTime = getMaxTime(plan.root);
  const rawNodes: Node[] = [];
  const edges: Edge[] = [];

  function walk(node: ExplainNode) {
    const data: ExplainPlanNodeData = {
      node,
      maxCost,
      maxTime,
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
    const lines = 3 + (data.hasAnalyzeData ? 1 : 0) + (data.node.filter ? 1 : 0);
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
  highestCostNode: ExplainMetricNode | null;
  slowestNode: ExplainMetricNode | null;
  largestRowMismatchNode: ExplainMetricNode | null;
  sequentialScans: number;
  tempOperations: number;
}

export function getNodeCostStyle(cost: number, maxCost: number): NodeCostStyle {
  if (maxCost <= 0) return { border: "border-l-green-500", headerBg: "bg-green-950/30" };
  const ratio = cost / maxCost;
  if (ratio < 0.2) return { border: "border-l-green-500", headerBg: "bg-green-950/30" };
  if (ratio < 0.6) return { border: "border-l-yellow-500", headerBg: "bg-yellow-950/30" };
  return { border: "border-l-red-500", headerBg: "bg-red-950/30" };
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

export function getExplainPlanSummary(plan: ExplainPlan): ExplainPlanSummary {
  const nodes = flattenExplainNodes(plan.root);

  let highestCostNode: ExplainMetricNode | null = null;
  let slowestNode: ExplainMetricNode | null = null;
  let largestRowMismatchNode: ExplainMetricNode | null = null;
  let sequentialScans = 0;
  let tempOperations = 0;

  for (const node of nodes) {
    if (
      node.total_cost != null &&
      (highestCostNode == null || node.total_cost > highestCostNode.value)
    ) {
      highestCostNode = {
        nodeId: node.id,
        nodeType: node.node_type,
        relation: node.relation,
        value: node.total_cost,
      };
    }

    if (
      node.actual_time_ms != null &&
      (slowestNode == null || node.actual_time_ms > slowestNode.value)
    ) {
      slowestNode = {
        nodeId: node.id,
        nodeType: node.node_type,
        relation: node.relation,
        value: node.actual_time_ms,
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
