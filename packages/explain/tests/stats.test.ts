import { describe, it, expect } from "vitest";
import { getExplainPlanStats } from "../src/stats";
import { computeExplainMetrics } from "../src/metrics";
import type { ExplainNode, ExplainPlan } from "../src/types";

function makeNode(overrides: Partial<ExplainNode> = {}): ExplainNode {
  return {
    id: "node_0",
    node_type: "Seq Scan",
    relation: null,
    startup_cost: null,
    total_cost: null,
    plan_rows: null,
    actual_rows: null,
    actual_time_ms: null,
    actual_loops: null,
    buffers_hit: null,
    buffers_read: null,
    filter: null,
    index_condition: null,
    join_type: null,
    hash_condition: null,
    extra: {},
    children: [],
    ...overrides,
  };
}

function makePlan(root: ExplainNode): ExplainPlan {
  return {
    root,
    planning_time_ms: null,
    execution_time_ms: null,
    original_query: "SELECT 1",
    driver: "postgres",
    has_analyze_data: true,
    raw_output: null,
  };
}

function statsFor(root: ExplainNode) {
  const plan = makePlan(root);
  return getExplainPlanStats(plan, computeExplainMetrics(plan));
}

describe("explainStats", () => {
  describe("getExplainPlanStats", () => {
    it("should count nodes and depth", () => {
      const grandchild = makeNode({ id: "node_2" });
      const child = makeNode({ id: "node_1", children: [grandchild] });

      const stats = statsFor(makeNode({ id: "node_0", children: [child] }));

      expect(stats.nodeCount).toBe(3);
      expect(stats.maxDepth).toBe(3);
    });

    it("should report depth 1 for a single-node plan", () => {
      expect(statsFor(makeNode()).maxDepth).toBe(1);
    });

    it("should group node types and rank them by time", () => {
      const child = makeNode({
        id: "node_1",
        node_type: "Index Scan",
        actual_time_ms: 80,
      });
      const sibling = makeNode({
        id: "node_2",
        node_type: "Index Scan",
        actual_time_ms: 10,
      });
      const root = makeNode({
        id: "node_0",
        node_type: "Hash Join",
        actual_time_ms: 100,
        children: [child, sibling],
      });

      const stats = statsFor(root);

      expect(stats.nodeTypes.map((entry) => entry.nodeType)).toEqual([
        "Index Scan",
        "Hash Join",
      ]);
      expect(stats.nodeTypes[0].count).toBe(2);
      expect(stats.nodeTypes[0].exclusiveTimeMs).toBe(90);
      expect(stats.nodeTypes[0].timeShare).toBeCloseTo(0.9);
      expect(stats.nodeTypes[1].exclusiveTimeMs).toBe(10);
    });

    it("should leave time null for node types without timings", () => {
      const stats = statsFor(makeNode({ total_cost: 10 }));

      expect(stats.nodeTypes[0].exclusiveTimeMs).toBeNull();
      expect(stats.nodeTypes[0].timeShare).toBeNull();
      expect(stats.totalExclusiveTimeMs).toBeNull();
    });

    it("should aggregate access counts per relation", () => {
      const child = makeNode({
        id: "node_1",
        node_type: "Index Scan",
        relation: "orders",
        actual_time_ms: 5,
        actual_rows: 10,
        actual_loops: 3,
      });
      const root = makeNode({
        id: "node_0",
        node_type: "Seq Scan",
        relation: "orders",
        actual_time_ms: 20,
        actual_rows: 100,
        children: [child],
      });

      const stats = statsFor(root);

      expect(stats.relations).toHaveLength(1);
      expect(stats.relations[0].relation).toBe("orders");
      expect(stats.relations[0].accessCount).toBe(2);
      expect(stats.relations[0].nodeTypes).toEqual(["Seq Scan", "Index Scan"]);
      // 100 rows once, plus 10 rows over 3 loops.
      expect(stats.relations[0].totalRows).toBe(130);
      expect(stats.relations[0].exclusiveTimeMs).toBe(20);
    });

    it("should skip nodes without a relation", () => {
      expect(statsFor(makeNode({ node_type: "Sort" })).relations).toEqual([]);
    });

    it("should collect indexes and their scan counts", () => {
      const child = makeNode({
        id: "node_1",
        node_type: "Index Scan",
        relation: "orders",
        actual_time_ms: 4,
        extra: { "Index Name": "orders_pkey" },
      });
      const root = makeNode({
        id: "node_0",
        node_type: "Index Scan",
        relation: "orders",
        actual_time_ms: 10,
        extra: { "Index Name": "orders_pkey" },
        children: [child],
      });

      const stats = statsFor(root);

      expect(stats.indexes).toHaveLength(1);
      expect(stats.indexes[0].indexName).toBe("orders_pkey");
      expect(stats.indexes[0].relation).toBe("orders");
      expect(stats.indexes[0].scanCount).toBe(2);
      expect(stats.indexes[0].exclusiveTimeMs).toBe(10);
    });

    it("should report no indexes when none were used", () => {
      expect(statsFor(makeNode()).indexes).toEqual([]);
    });

    it("should count nodes the executor never ran", () => {
      const child = makeNode({ id: "node_1", actual_loops: 0 });
      const root = makeNode({ id: "node_0", actual_loops: 1, children: [child] });

      expect(statsFor(root).neverExecutedCount).toBe(1);
    });

    it("should total the plan's exclusive time", () => {
      const child = makeNode({ id: "node_1", actual_time_ms: 30 });
      const root = makeNode({
        id: "node_0",
        actual_time_ms: 50,
        children: [child],
      });

      expect(statsFor(root).totalExclusiveTimeMs).toBe(50);
    });
  });
});
