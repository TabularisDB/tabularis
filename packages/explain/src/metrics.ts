import type { ExplainNode, ExplainPlan } from "./types";

/**
 * Per-node metrics derived from a plan tree.
 *
 * The values reported by the database are *inclusive* and, for timings, are
 * *averages per loop*:
 *
 * - `Total Cost` covers the node and everything below it.
 * - `Actual Total Time` covers the node and everything below it, averaged over
 *   `Actual Loops` iterations.
 *
 * Using those numbers directly makes the plan root look like the most expensive
 * and slowest node in every plan, which hides the real bottleneck. The metrics
 * below restate them as totals across loops and as *exclusive* (self) values,
 * which is what the views highlight.
 */
export interface ExplainNodeMetrics {
  nodeId: string;
  /** 1-based depth-first position. Used as the node label across all views. */
  index: number;
  /** Nesting level, 0 for the plan root. */
  depth: number;
  /** Time in this node and its children, summed over every loop. */
  inclusiveTimeMs: number | null;
  /** Time in this node alone, summed over every loop. */
  exclusiveTimeMs: number | null;
  /** Planner cost of this node and its children. */
  totalCost: number | null;
  /** Planner cost attributable to this node alone. */
  exclusiveCost: number | null;
  /** Rows produced across every loop. */
  totalRows: number | null;
  /** Shared buffers touched by this node and its children. */
  inclusiveBuffers: number | null;
  /** Shared buffers touched by this node alone. */
  exclusiveBuffers: number | null;
  /** `exclusiveTimeMs` as a fraction of the whole plan, 0..1. */
  timeShare: number | null;
  /** The planner produced the node but the executor never ran it. */
  neverExecuted: boolean;
}

export interface ExplainMetrics {
  byId: Map<string, ExplainNodeMetrics>;
  /** Depth-first order, matching the `index` field. */
  order: ExplainNodeMetrics[];
  maxExclusiveTimeMs: number;
  maxExclusiveCost: number;
  maxTotalRows: number;
  maxExclusiveBuffers: number;
  /** Sum of every node's exclusive time, i.e. the whole plan's execution time. */
  totalExclusiveTimeMs: number;
}

/** Metric a bar chart or heat map can be driven by. */
export type ExplainMetricKind = "time" | "rows" | "cost" | "buffers";

export const EXPLAIN_METRIC_KINDS: readonly ExplainMetricKind[] = [
  "time",
  "rows",
  "cost",
  "buffers",
];

/**
 * `Actual Loops` for a node, defaulting to 1. A value of 0 means the node was
 * never executed, in which case there is nothing to scale.
 */
function loopCount(node: ExplainNode): number {
  return node.actual_loops != null && node.actual_loops > 0
    ? node.actual_loops
    : 1;
}

/**
 * InitPlan and SubPlan timings are not included in the parent's reported time,
 * so they must not be subtracted when computing the parent's exclusive time.
 */
function isSubplanChild(node: ExplainNode): boolean {
  const relationship = node.extra["Parent Relationship"];
  return relationship === "InitPlan" || relationship === "SubPlan";
}

function bufferCount(node: ExplainNode): number | null {
  if (node.buffers_hit == null && node.buffers_read == null) {
    return null;
  }

  return (node.buffers_hit ?? 0) + (node.buffers_read ?? 0);
}

/**
 * Subtract the children's share from a parent total, clamping at zero.
 *
 * Clamping matters because plans coming from a text dump or from a non-Postgres
 * driver do not always satisfy `parent >= sum(children)`.
 */
function selfValue(total: number | null, childSum: number): number | null {
  if (total == null) {
    return null;
  }

  return Math.max(0, total - childSum);
}

/** Compute exclusive/total metrics for every node in `plan`. */
export function computeExplainMetrics(plan: ExplainPlan): ExplainMetrics {
  const byId = new Map<string, ExplainNodeMetrics>();
  const order: ExplainNodeMetrics[] = [];
  let nextIndex = 1;

  /** Returns the inclusive contributions this subtree adds to its parent. */
  function walk(
    node: ExplainNode,
    depth: number,
  ): { timeMs: number; cost: number; buffers: number } {
    const metrics: ExplainNodeMetrics = {
      nodeId: node.id,
      index: nextIndex,
      depth,
      inclusiveTimeMs: null,
      exclusiveTimeMs: null,
      totalCost: node.total_cost,
      exclusiveCost: null,
      totalRows: null,
      inclusiveBuffers: bufferCount(node),
      exclusiveBuffers: null,
      timeShare: null,
      neverExecuted: node.actual_loops === 0,
    };

    nextIndex += 1;
    byId.set(node.id, metrics);
    order.push(metrics);

    let childTimeMs = 0;
    let childCost = 0;
    let childBuffers = 0;

    for (const child of node.children) {
      const contribution = walk(child, depth + 1);
      childCost += contribution.cost;
      childBuffers += contribution.buffers;
      if (!isSubplanChild(child)) {
        childTimeMs += contribution.timeMs;
      }
    }

    const loops = loopCount(node);

    metrics.inclusiveTimeMs =
      node.actual_time_ms != null ? node.actual_time_ms * loops : null;
    metrics.exclusiveTimeMs = selfValue(metrics.inclusiveTimeMs, childTimeMs);
    metrics.exclusiveCost = selfValue(metrics.totalCost, childCost);
    metrics.exclusiveBuffers = selfValue(metrics.inclusiveBuffers, childBuffers);
    metrics.totalRows =
      node.actual_rows != null ? node.actual_rows * loops : null;

    return {
      timeMs: metrics.inclusiveTimeMs ?? 0,
      cost: metrics.totalCost ?? 0,
      buffers: metrics.inclusiveBuffers ?? 0,
    };
  }

  walk(plan.root, 0);

  let maxExclusiveTimeMs = 0;
  let maxExclusiveCost = 0;
  let maxTotalRows = 0;
  let maxExclusiveBuffers = 0;
  let totalExclusiveTimeMs = 0;

  for (const metrics of order) {
    maxExclusiveTimeMs = Math.max(
      maxExclusiveTimeMs,
      metrics.exclusiveTimeMs ?? 0,
    );
    maxExclusiveCost = Math.max(maxExclusiveCost, metrics.exclusiveCost ?? 0);
    maxTotalRows = Math.max(maxTotalRows, metrics.totalRows ?? 0);
    maxExclusiveBuffers = Math.max(
      maxExclusiveBuffers,
      metrics.exclusiveBuffers ?? 0,
    );
    totalExclusiveTimeMs += metrics.exclusiveTimeMs ?? 0;
  }

  if (totalExclusiveTimeMs > 0) {
    for (const metrics of order) {
      if (metrics.exclusiveTimeMs != null) {
        metrics.timeShare = metrics.exclusiveTimeMs / totalExclusiveTimeMs;
      }
    }
  }

  return {
    byId,
    order,
    maxExclusiveTimeMs,
    maxExclusiveCost,
    maxTotalRows,
    maxExclusiveBuffers,
    totalExclusiveTimeMs,
  };
}

/** Metrics for a single node, or `null` when the id is unknown. */
export function getNodeMetrics(
  metrics: ExplainMetrics,
  nodeId: string | null,
): ExplainNodeMetrics | null {
  if (!nodeId) {
    return null;
  }

  return metrics.byId.get(nodeId) ?? null;
}

/** The value a given metric contributes for one node. */
export function getMetricValue(
  metrics: ExplainNodeMetrics,
  kind: ExplainMetricKind,
): number | null {
  switch (kind) {
    case "time":
      return metrics.exclusiveTimeMs;
    case "rows":
      return metrics.totalRows;
    case "cost":
      return metrics.exclusiveCost;
    case "buffers":
      return metrics.exclusiveBuffers;
  }
}

/** The largest value of a given metric across the plan. */
export function getMetricMax(
  metrics: ExplainMetrics,
  kind: ExplainMetricKind,
): number {
  switch (kind) {
    case "time":
      return metrics.maxExclusiveTimeMs;
    case "rows":
      return metrics.maxTotalRows;
    case "cost":
      return metrics.maxExclusiveCost;
    case "buffers":
      return metrics.maxExclusiveBuffers;
  }
}

/** Whether any node in the plan carries data for a given metric. */
export function isMetricAvailable(
  metrics: ExplainMetrics,
  kind: ExplainMetricKind,
): boolean {
  return metrics.order.some((node) => getMetricValue(node, kind) != null);
}

/** Metrics that carry data, in display order. */
export function getAvailableMetricKinds(
  metrics: ExplainMetrics,
): ExplainMetricKind[] {
  return EXPLAIN_METRIC_KINDS.filter((kind) => isMetricAvailable(metrics, kind));
}

/**
 * Metric the heat map and diagram default to: measured time when the plan was
 * run with ANALYZE, planner cost otherwise. `null` when the plan carries no
 * metric at all, so callers never select a metric that has no data.
 */
export function getDefaultMetricKind(
  metrics: ExplainMetrics,
): ExplainMetricKind | null {
  if (metrics.maxExclusiveTimeMs > 0) {
    return "time";
  }

  const available = getAvailableMetricKinds(metrics);
  return available.includes("cost") ? "cost" : (available[0] ?? null);
}
