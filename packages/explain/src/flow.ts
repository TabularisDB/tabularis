/**
 * ReactFlow adapter: turns a plan tree into positioned nodes and edges.
 *
 * Split out of `plan.ts` so the analysis core stays free of `@xyflow/react` and
 * `dagre` — a headless consumer never pulls a graph library.
 */
import type { Node, Edge } from "@xyflow/react";
import dagre from "dagre";
import type { ExplainNode, ExplainPlan } from "./types";
import type { ExplainMetrics, ExplainNodeMetrics } from "./metrics";
import { computeExplainMetrics } from "./metrics";
import type { ExplainDiagnostic } from "./diagnostics";

/** Payload carried by every `explainPlan` node in the ReactFlow graph. */
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
