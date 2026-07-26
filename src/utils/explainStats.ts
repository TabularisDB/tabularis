import type { ExplainNode, ExplainPlan } from "../types/explain";
import type { ExplainMetrics } from "./explainMetrics";
import { flattenExplainNodes } from "./explainPlan";

export interface ExplainNodeTypeStat {
  nodeType: string;
  count: number;
  /** Summed exclusive time, or `null` when no node of this type was timed. */
  exclusiveTimeMs: number | null;
  /** Share of the plan's total exclusive time, 0..1. */
  timeShare: number | null;
}

export interface ExplainRelationStat {
  relation: string;
  /** How many nodes read this relation. */
  accessCount: number;
  /** Node types that touched it, in first-seen order. */
  nodeTypes: string[];
  exclusiveTimeMs: number | null;
  totalRows: number | null;
}

export interface ExplainIndexStat {
  indexName: string;
  relation: string | null;
  scanCount: number;
  exclusiveTimeMs: number | null;
}

export interface ExplainPlanStats {
  nodeCount: number;
  /** Depth of the deepest node, 1 for a single-node plan. */
  maxDepth: number;
  neverExecutedCount: number;
  totalExclusiveTimeMs: number | null;
  nodeTypes: ExplainNodeTypeStat[];
  relations: ExplainRelationStat[];
  indexes: ExplainIndexStat[];
}

/** Accumulator that distinguishes "sum is zero" from "nothing was measured". */
interface OptionalSum {
  total: number;
  hasData: boolean;
}

function addTo(sum: OptionalSum, value: number | null): void {
  if (value != null) {
    sum.total += value;
    sum.hasData = true;
  }
}

function resolve(sum: OptionalSum): number | null {
  return sum.hasData ? sum.total : null;
}

function newSum(): OptionalSum {
  return { total: 0, hasData: false };
}

function indexNameOf(node: ExplainNode): string | null {
  const value = node.extra["Index Name"];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Plan-wide aggregates: which node types dominate the runtime, which relations
 * are read and how often, and which indexes were used.
 */
export function getExplainPlanStats(
  plan: ExplainPlan,
  metrics: ExplainMetrics,
): ExplainPlanStats {
  const nodes = flattenExplainNodes(plan.root);

  const byNodeType = new Map<string, { count: number; time: OptionalSum }>();
  const byRelation = new Map<
    string,
    {
      accessCount: number;
      nodeTypes: string[];
      time: OptionalSum;
      rows: OptionalSum;
    }
  >();
  const byIndex = new Map<
    string,
    { relation: string | null; scanCount: number; time: OptionalSum }
  >();

  let maxDepth = 0;
  let neverExecutedCount = 0;
  const totalTime = newSum();

  for (const node of nodes) {
    const nodeMetrics = metrics.byId.get(node.id);
    const exclusiveTimeMs = nodeMetrics?.exclusiveTimeMs ?? null;

    maxDepth = Math.max(maxDepth, (nodeMetrics?.depth ?? 0) + 1);
    if (nodeMetrics?.neverExecuted) {
      neverExecutedCount += 1;
    }
    addTo(totalTime, exclusiveTimeMs);

    const typeStat = byNodeType.get(node.node_type) ?? {
      count: 0,
      time: newSum(),
    };
    typeStat.count += 1;
    addTo(typeStat.time, exclusiveTimeMs);
    byNodeType.set(node.node_type, typeStat);

    if (node.relation) {
      const relationStat = byRelation.get(node.relation) ?? {
        accessCount: 0,
        nodeTypes: [],
        time: newSum(),
        rows: newSum(),
      };
      relationStat.accessCount += 1;
      if (!relationStat.nodeTypes.includes(node.node_type)) {
        relationStat.nodeTypes.push(node.node_type);
      }
      addTo(relationStat.time, exclusiveTimeMs);
      addTo(relationStat.rows, nodeMetrics?.totalRows ?? null);
      byRelation.set(node.relation, relationStat);
    }

    const indexName = indexNameOf(node);
    if (indexName) {
      const indexStat = byIndex.get(indexName) ?? {
        relation: node.relation,
        scanCount: 0,
        time: newSum(),
      };
      indexStat.scanCount += 1;
      indexStat.relation = indexStat.relation ?? node.relation;
      addTo(indexStat.time, exclusiveTimeMs);
      byIndex.set(indexName, indexStat);
    }
  }

  const planTotalTime = resolve(totalTime);

  const nodeTypes: ExplainNodeTypeStat[] = Array.from(byNodeType.entries())
    .map(([nodeType, stat]) => {
      const exclusiveTimeMs = resolve(stat.time);
      return {
        nodeType,
        count: stat.count,
        exclusiveTimeMs,
        timeShare:
          exclusiveTimeMs != null && planTotalTime != null && planTotalTime > 0
            ? exclusiveTimeMs / planTotalTime
            : null,
      };
    })
    .sort(compareByTimeThenCount);

  const relations: ExplainRelationStat[] = Array.from(byRelation.entries())
    .map(([relation, stat]) => ({
      relation,
      accessCount: stat.accessCount,
      nodeTypes: stat.nodeTypes,
      exclusiveTimeMs: resolve(stat.time),
      totalRows: resolve(stat.rows),
    }))
    .sort(
      (a, b) =>
        (b.exclusiveTimeMs ?? 0) - (a.exclusiveTimeMs ?? 0) ||
        b.accessCount - a.accessCount ||
        a.relation.localeCompare(b.relation),
    );

  const indexes: ExplainIndexStat[] = Array.from(byIndex.entries())
    .map(([indexName, stat]) => ({
      indexName,
      relation: stat.relation,
      scanCount: stat.scanCount,
      exclusiveTimeMs: resolve(stat.time),
    }))
    .sort(
      (a, b) =>
        (b.exclusiveTimeMs ?? 0) - (a.exclusiveTimeMs ?? 0) ||
        b.scanCount - a.scanCount ||
        a.indexName.localeCompare(b.indexName),
    );

  return {
    nodeCount: nodes.length,
    maxDepth,
    neverExecutedCount,
    totalExclusiveTimeMs: planTotalTime,
    nodeTypes,
    relations,
    indexes,
  };
}

function compareByTimeThenCount(
  a: ExplainNodeTypeStat,
  b: ExplainNodeTypeStat,
): number {
  return (
    (b.exclusiveTimeMs ?? 0) - (a.exclusiveTimeMs ?? 0) ||
    b.count - a.count ||
    a.nodeType.localeCompare(b.nodeType)
  );
}
