import { describe, it, expect } from "vitest";
import {
  explainPlanToFlow,
  findExplainNode,
  flattenExplainNodes,
  getNodeCostStyle,
  formatCost,
  formatRatio,
  formatTime,
  formatRows,
  getExplainDriverLegend,
  getExplainPlanSummary,
  getMaxCost,
  getMaxTime,
  getRowEstimateRatio,
  isDataModifyingQuery,
} from "../../src/utils/explainPlan";
import type { ExplainNode, ExplainPlan } from "../../src/types/explain";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function makePlan(overrides: Partial<ExplainPlan> = {}): ExplainPlan {
  return {
    root: makeNode(),
    planning_time_ms: null,
    execution_time_ms: null,
    original_query: "SELECT 1",
    driver: "postgres",
    has_analyze_data: false,
    raw_output: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// explainPlanToFlow
// ---------------------------------------------------------------------------

describe("explainPlan", () => {
  describe("explainPlanToFlow", () => {
    it("should convert single-node plan to one ReactFlow node", () => {
      const plan = makePlan();
      const { nodes, edges } = explainPlanToFlow(plan);
      expect(nodes).toHaveLength(1);
      expect(edges).toHaveLength(0);
      expect(nodes[0].id).toBe("node_0");
      expect(nodes[0].type).toBe("explainPlan");
    });

    it("should create edges from parent to children", () => {
      const child = makeNode({ id: "node_1", node_type: "Index Scan" });
      const root = makeNode({ id: "node_0", children: [child] });
      const plan = makePlan({ root });

      const { nodes, edges } = explainPlanToFlow(plan);
      expect(nodes).toHaveLength(2);
      expect(edges).toHaveLength(1);
      expect(edges[0].source).toBe("node_0");
      expect(edges[0].target).toBe("node_1");
    });

    it("should handle deeply nested plans", () => {
      const grandchild = makeNode({ id: "node_2" });
      const child = makeNode({ id: "node_1", children: [grandchild] });
      const root = makeNode({ id: "node_0", children: [child] });
      const plan = makePlan({ root });

      const { nodes, edges } = explainPlanToFlow(plan);
      expect(nodes).toHaveLength(3);
      expect(edges).toHaveLength(2);
    });

    it("should handle multiple children on same node", () => {
      const child1 = makeNode({ id: "node_1" });
      const child2 = makeNode({ id: "node_2" });
      const root = makeNode({ id: "node_0", children: [child1, child2] });
      const plan = makePlan({ root });

      const { nodes, edges } = explainPlanToFlow(plan);
      expect(nodes).toHaveLength(3);
      expect(edges).toHaveLength(2);
    });

    it("should assign positions to all nodes", () => {
      const child = makeNode({ id: "node_1" });
      const root = makeNode({ id: "node_0", children: [child] });
      const plan = makePlan({ root });

      const { nodes } = explainPlanToFlow(plan);
      for (const node of nodes) {
        expect(node.position).toBeDefined();
        expect(typeof node.position.x).toBe("number");
        expect(typeof node.position.y).toBe("number");
      }
    });

    it("should mark the selected node in data", () => {
      const child = makeNode({ id: "node_1" });
      const root = makeNode({ id: "node_0", children: [child] });
      const plan = makePlan({ root });

      const { nodes } = explainPlanToFlow(plan, "node_1");
      const selectedNode = nodes.find((node) => node.id === "node_1");
      const unselectedNode = nodes.find((node) => node.id === "node_0");

      expect(selectedNode?.data.isSelected).toBe(true);
      expect(unselectedNode?.data.isSelected).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // getNodeCostColor
  // ---------------------------------------------------------------------------

  describe("getNodeCostStyle", () => {
    it("should return green for low cost", () => {
      const style = getNodeCostStyle(10, 100);
      expect(style.border).toBe("border-l-green-500");
      expect(style.headerBg).toBe("bg-green-950/30");
    });

    it("should return yellow for medium cost", () => {
      const style = getNodeCostStyle(40, 100);
      expect(style.border).toBe("border-l-yellow-500");
      expect(style.headerBg).toBe("bg-yellow-950/30");
    });

    it("should return red for high cost", () => {
      const style = getNodeCostStyle(80, 100);
      expect(style.border).toBe("border-l-red-500");
      expect(style.headerBg).toBe("bg-red-950/30");
    });

    it("should handle zero maxCost", () => {
      expect(getNodeCostStyle(0, 0).border).toBe("border-l-green-500");
    });

    it("should handle cost equal to maxCost", () => {
      expect(getNodeCostStyle(100, 100).border).toBe("border-l-red-500");
    });

    it("should return green at exactly 19%", () => {
      expect(getNodeCostStyle(19, 100).border).toBe("border-l-green-500");
    });

    it("should return yellow at exactly 20%", () => {
      expect(getNodeCostStyle(20, 100).border).toBe("border-l-yellow-500");
    });

    it("should return red at exactly 60%", () => {
      expect(getNodeCostStyle(60, 100).border).toBe("border-l-red-500");
    });
  });

  // ---------------------------------------------------------------------------
  // formatCost
  // ---------------------------------------------------------------------------

  describe("formatCost", () => {
    it("should format small numbers with 2 decimals", () => {
      expect(formatCost(0.05)).toBe("0.05");
    });

    it("should format numbers >= 1 with 1 decimal", () => {
      expect(formatCost(3.14)).toBe("3.1");
    });

    it("should format numbers >= 100 with no decimals", () => {
      expect(formatCost(123.456)).toBe("123");
    });

    it("should format thousands with K suffix", () => {
      expect(formatCost(1500)).toBe("1.5K");
    });

    it("should format millions with M suffix", () => {
      expect(formatCost(2500000)).toBe("2.5M");
    });
  });

  // ---------------------------------------------------------------------------
  // formatTime
  // ---------------------------------------------------------------------------

  describe("formatTime", () => {
    it("should show ms for values >= 1ms", () => {
      expect(formatTime(5.67)).toBe("5.67 ms");
    });

    it("should show s for values >= 1000ms", () => {
      expect(formatTime(1500)).toBe("1.50 s");
    });

    it("should show us for sub-millisecond values", () => {
      expect(formatTime(0.05)).toBe("50 us");
    });
  });

  // ---------------------------------------------------------------------------
  // formatRows
  // ---------------------------------------------------------------------------

  describe("formatRows", () => {
    it("should show K suffix for thousands", () => {
      expect(formatRows(1500)).toBe("1.5K");
    });

    it("should show M suffix for millions", () => {
      expect(formatRows(3400000)).toBe("3.4M");
    });

    it("should show plain number for small values", () => {
      expect(formatRows(42)).toBe("42");
    });

    it("should show zero", () => {
      expect(formatRows(0)).toBe("0");
    });
  });

  describe("formatRatio", () => {
    it("should format small ratios with 2 decimals", () => {
      expect(formatRatio(2.345)).toBe("2.35x");
    });

    it("should format large ratios with 1 decimal or integer precision", () => {
      expect(formatRatio(12.34)).toBe("12.3x");
      expect(formatRatio(120.34)).toBe("120x");
    });
  });

  // ---------------------------------------------------------------------------
  // getMaxCost
  // ---------------------------------------------------------------------------

  describe("getMaxCost", () => {
    it("should return root cost for leaf node", () => {
      expect(getMaxCost(makeNode({ total_cost: 50 }))).toBe(50);
    });

    it("should find max cost across tree", () => {
      const child = makeNode({ id: "node_1", total_cost: 100 });
      const root = makeNode({ id: "node_0", total_cost: 50, children: [child] });
      expect(getMaxCost(root)).toBe(100);
    });

    it("should return 0 when no costs are set", () => {
      expect(getMaxCost(makeNode())).toBe(0);
    });

    it("should handle nested children with varying costs", () => {
      const grandchild = makeNode({ id: "node_2", total_cost: 200 });
      const child = makeNode({ id: "node_1", total_cost: 50, children: [grandchild] });
      const root = makeNode({ id: "node_0", total_cost: 10, children: [child] });
      expect(getMaxCost(root)).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------
  // getMaxTime
  // ---------------------------------------------------------------------------

  describe("getMaxTime", () => {
    it("should return root time for leaf node", () => {
      expect(getMaxTime(makeNode({ actual_time_ms: 10 }))).toBe(10);
    });

    it("should find max time across tree", () => {
      const child = makeNode({ id: "node_1", actual_time_ms: 50 });
      const root = makeNode({ id: "node_0", actual_time_ms: 5, children: [child] });
      expect(getMaxTime(root)).toBe(50);
    });

    it("should return 0 when no times are set", () => {
      expect(getMaxTime(makeNode())).toBe(0);
    });
  });

  describe("flattenExplainNodes", () => {
    it("should flatten a tree in traversal order", () => {
      const grandchild = makeNode({ id: "node_2" });
      const child = makeNode({ id: "node_1", children: [grandchild] });
      const root = makeNode({ id: "node_0", children: [child] });

      expect(flattenExplainNodes(root).map((node) => node.id)).toEqual([
        "node_0",
        "node_1",
        "node_2",
      ]);
    });
  });

  describe("findExplainNode", () => {
    it("should find a node recursively", () => {
      const grandchild = makeNode({ id: "node_2" });
      const child = makeNode({ id: "node_1", children: [grandchild] });
      const root = makeNode({ id: "node_0", children: [child] });

      expect(findExplainNode(root, "node_2")?.id).toBe("node_2");
      expect(findExplainNode(root, "missing")).toBeNull();
    });
  });

  describe("getRowEstimateRatio", () => {
    it("should return actual to estimated ratio", () => {
      expect(
        getRowEstimateRatio(makeNode({ plan_rows: 100, actual_rows: 500 })),
      ).toBe(5);
    });

    it("should return null when data is missing or zero", () => {
      expect(getRowEstimateRatio(makeNode({ plan_rows: 0, actual_rows: 10 }))).toBeNull();
      expect(getRowEstimateRatio(makeNode({ plan_rows: 10, actual_rows: null }))).toBeNull();
    });
  });

  describe("getExplainPlanSummary", () => {
    it("should compute highest cost, slowest node, mismatch, and operation counts", () => {
      const child = makeNode({
        id: "node_1",
        node_type: "Sort",
        total_cost: 400,
        actual_time_ms: 25,
        plan_rows: 10,
        actual_rows: 200,
        extra: { using: "Using filesort" },
      });
      const root = makeNode({
        id: "node_0",
        node_type: "Seq Scan",
        total_cost: 100,
        actual_time_ms: 5,
        children: [child],
      });
      const plan = makePlan({ root, has_analyze_data: true });

      const summary = getExplainPlanSummary(plan);

      expect(summary.highestCostNode?.nodeId).toBe("node_1");
      expect(summary.slowestNode?.nodeId).toBe("node_1");
      expect(summary.largestRowMismatchNode?.nodeId).toBe("node_1");
      expect(summary.sequentialScans).toBe(1);
      expect(summary.tempOperations).toBe(1);
    });
  });

  describe("getExplainDriverLegend", () => {
    it("should return postgres notes", () => {
      const legend = getExplainDriverLegend(
        makePlan({ driver: "postgres", has_analyze_data: true }),
      );

      expect(legend).toHaveLength(2);
      expect(legend[0]).toBe("editor.visualExplain.postgresAnalyzeLegend1");
    });

    it("should return sqlite notes", () => {
      const legend = getExplainDriverLegend(makePlan({ driver: "sqlite" }));
      expect(legend[0]).toBe("editor.visualExplain.sqliteLegend1");
    });
  });

  // ---------------------------------------------------------------------------
  // isDataModifyingQuery
  // ---------------------------------------------------------------------------

  describe("isDataModifyingQuery", () => {
    it("should detect INSERT", () => {
      expect(isDataModifyingQuery("INSERT INTO t VALUES (1)")).toBe(true);
    });

    it("should detect UPDATE", () => {
      expect(isDataModifyingQuery("UPDATE t SET a = 1")).toBe(true);
    });

    it("should detect DELETE", () => {
      expect(isDataModifyingQuery("DELETE FROM t WHERE id = 1")).toBe(true);
    });

    it("should detect DROP", () => {
      expect(isDataModifyingQuery("DROP TABLE t")).toBe(true);
    });

    it("should detect ALTER", () => {
      expect(isDataModifyingQuery("ALTER TABLE t ADD col INT")).toBe(true);
    });

    it("should detect TRUNCATE", () => {
      expect(isDataModifyingQuery("TRUNCATE TABLE t")).toBe(true);
    });

    it("should not flag SELECT", () => {
      expect(isDataModifyingQuery("SELECT * FROM t")).toBe(false);
    });

    it("should be case-insensitive", () => {
      expect(isDataModifyingQuery("insert into t values (1)")).toBe(true);
    });

    it("should handle leading whitespace", () => {
      expect(isDataModifyingQuery("  DELETE FROM t")).toBe(true);
    });

    it("should not flag WITH queries", () => {
      expect(isDataModifyingQuery("WITH cte AS (SELECT 1) SELECT * FROM cte")).toBe(false);
    });
  });
});
