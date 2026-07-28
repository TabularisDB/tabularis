import { describe, it, expect } from "vitest";
import {
  computeExplainMetrics,
  getAvailableMetricKinds,
  getDefaultMetricKind,
  getMetricMax,
  getMetricValue,
  getNodeMetrics,
  isMetricAvailable,
} from "../src/metrics";
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

describe("explainMetrics", () => {
  describe("computeExplainMetrics", () => {
    it("should number nodes depth-first starting at 1", () => {
      const grandchild = makeNode({ id: "node_2" });
      const child = makeNode({ id: "node_1", children: [grandchild] });
      const plan = makePlan(makeNode({ id: "node_0", children: [child] }));

      const metrics = computeExplainMetrics(plan);

      expect(metrics.order.map((entry) => entry.nodeId)).toEqual([
        "node_0",
        "node_1",
        "node_2",
      ]);
      expect(metrics.order.map((entry) => entry.index)).toEqual([1, 2, 3]);
      expect(metrics.order.map((entry) => entry.depth)).toEqual([0, 1, 2]);
    });

    it("should subtract children from the parent time", () => {
      const child = makeNode({ id: "node_1", actual_time_ms: 30 });
      const plan = makePlan(
        makeNode({ id: "node_0", actual_time_ms: 50, children: [child] }),
      );

      const metrics = computeExplainMetrics(plan);

      expect(metrics.byId.get("node_0")?.exclusiveTimeMs).toBe(20);
      expect(metrics.byId.get("node_1")?.exclusiveTimeMs).toBe(30);
    });

    it("should scale reported time by the loop count", () => {
      const child = makeNode({
        id: "node_1",
        actual_time_ms: 2,
        actual_loops: 10,
      });
      const plan = makePlan(
        makeNode({
          id: "node_0",
          actual_time_ms: 30,
          actual_loops: 1,
          children: [child],
        }),
      );

      const metrics = computeExplainMetrics(plan);

      // The child ran 10 times at 2ms each, so it contributes 20ms.
      expect(metrics.byId.get("node_1")?.inclusiveTimeMs).toBe(20);
      expect(metrics.byId.get("node_1")?.exclusiveTimeMs).toBe(20);
      expect(metrics.byId.get("node_0")?.exclusiveTimeMs).toBe(10);
    });

    it("should not subtract InitPlan or SubPlan children from the parent time", () => {
      const initPlan = makeNode({
        id: "node_1",
        actual_time_ms: 40,
        extra: { "Parent Relationship": "InitPlan" },
      });
      const plan = makePlan(
        makeNode({ id: "node_0", actual_time_ms: 10, children: [initPlan] }),
      );

      const metrics = computeExplainMetrics(plan);

      expect(metrics.byId.get("node_0")?.exclusiveTimeMs).toBe(10);
    });

    it("should clamp exclusive values at zero", () => {
      const child = makeNode({ id: "node_1", actual_time_ms: 90, total_cost: 90 });
      const plan = makePlan(
        makeNode({
          id: "node_0",
          actual_time_ms: 10,
          total_cost: 10,
          children: [child],
        }),
      );

      const metrics = computeExplainMetrics(plan);

      expect(metrics.byId.get("node_0")?.exclusiveTimeMs).toBe(0);
      expect(metrics.byId.get("node_0")?.exclusiveCost).toBe(0);
    });

    it("should subtract children from the parent cost", () => {
      const child = makeNode({ id: "node_1", total_cost: 80 });
      const plan = makePlan(
        makeNode({ id: "node_0", total_cost: 100, children: [child] }),
      );

      const metrics = computeExplainMetrics(plan);

      expect(metrics.byId.get("node_0")?.exclusiveCost).toBe(20);
      expect(metrics.byId.get("node_0")?.totalCost).toBe(100);
    });

    it("should report the time share of each node", () => {
      const child = makeNode({ id: "node_1", actual_time_ms: 75 });
      const plan = makePlan(
        makeNode({ id: "node_0", actual_time_ms: 100, children: [child] }),
      );

      const metrics = computeExplainMetrics(plan);

      expect(metrics.totalExclusiveTimeMs).toBe(100);
      expect(metrics.byId.get("node_0")?.timeShare).toBeCloseTo(0.25);
      expect(metrics.byId.get("node_1")?.timeShare).toBeCloseTo(0.75);
    });

    it("should leave time share null when nothing was timed", () => {
      const metrics = computeExplainMetrics(makePlan(makeNode()));

      expect(metrics.byId.get("node_0")?.timeShare).toBeNull();
      expect(metrics.totalExclusiveTimeMs).toBe(0);
    });

    it("should multiply rows by loops", () => {
      const plan = makePlan(
        makeNode({ actual_rows: 5, actual_loops: 200 }),
      );

      expect(computeExplainMetrics(plan).byId.get("node_0")?.totalRows).toBe(
        1000,
      );
    });

    it("should sum hit and read blocks into buffers", () => {
      const child = makeNode({ id: "node_1", buffers_hit: 4, buffers_read: 1 });
      const plan = makePlan(
        makeNode({
          id: "node_0",
          buffers_hit: 10,
          buffers_read: 2,
          children: [child],
        }),
      );

      const metrics = computeExplainMetrics(plan);

      expect(metrics.byId.get("node_0")?.inclusiveBuffers).toBe(12);
      expect(metrics.byId.get("node_0")?.exclusiveBuffers).toBe(7);
      expect(metrics.byId.get("node_1")?.exclusiveBuffers).toBe(5);
    });

    it("should leave buffers null when the driver reports none", () => {
      const metrics = computeExplainMetrics(makePlan(makeNode()));

      expect(metrics.byId.get("node_0")?.inclusiveBuffers).toBeNull();
      expect(metrics.byId.get("node_0")?.exclusiveBuffers).toBeNull();
    });

    it("should flag nodes the executor never ran", () => {
      const plan = makePlan(makeNode({ actual_loops: 0 }));

      expect(computeExplainMetrics(plan).byId.get("node_0")?.neverExecuted).toBe(
        true,
      );
    });

    it("should track the plan-wide maxima", () => {
      const child = makeNode({
        id: "node_1",
        actual_time_ms: 30,
        total_cost: 40,
        actual_rows: 500,
        buffers_hit: 9,
      });
      const plan = makePlan(
        makeNode({
          id: "node_0",
          actual_time_ms: 100,
          total_cost: 200,
          actual_rows: 10,
          buffers_hit: 20,
          children: [child],
        }),
      );

      const metrics = computeExplainMetrics(plan);

      expect(metrics.maxExclusiveTimeMs).toBe(70);
      expect(metrics.maxExclusiveCost).toBe(160);
      expect(metrics.maxTotalRows).toBe(500);
      expect(metrics.maxExclusiveBuffers).toBe(11);
    });
  });

  describe("getNodeMetrics", () => {
    it("should look nodes up by id", () => {
      const metrics = computeExplainMetrics(makePlan(makeNode()));

      expect(getNodeMetrics(metrics, "node_0")?.index).toBe(1);
      expect(getNodeMetrics(metrics, "missing")).toBeNull();
      expect(getNodeMetrics(metrics, null)).toBeNull();
    });
  });

  describe("getMetricValue", () => {
    it("should map each metric kind to its field", () => {
      const plan = makePlan(
        makeNode({
          actual_time_ms: 12,
          total_cost: 34,
          actual_rows: 56,
          buffers_hit: 78,
        }),
      );
      const nodeMetrics = computeExplainMetrics(plan).order[0];

      expect(getMetricValue(nodeMetrics, "time")).toBe(12);
      expect(getMetricValue(nodeMetrics, "cost")).toBe(34);
      expect(getMetricValue(nodeMetrics, "rows")).toBe(56);
      expect(getMetricValue(nodeMetrics, "buffers")).toBe(78);
    });
  });

  describe("getMetricMax", () => {
    it("should return the maximum for each metric kind", () => {
      const plan = makePlan(
        makeNode({
          actual_time_ms: 12,
          total_cost: 34,
          actual_rows: 56,
          buffers_read: 78,
        }),
      );
      const metrics = computeExplainMetrics(plan);

      expect(getMetricMax(metrics, "time")).toBe(12);
      expect(getMetricMax(metrics, "cost")).toBe(34);
      expect(getMetricMax(metrics, "rows")).toBe(56);
      expect(getMetricMax(metrics, "buffers")).toBe(78);
    });
  });

  describe("isMetricAvailable", () => {
    it("should detect which metrics the plan carries", () => {
      const metrics = computeExplainMetrics(
        makePlan(makeNode({ total_cost: 10 })),
      );

      expect(isMetricAvailable(metrics, "cost")).toBe(true);
      expect(isMetricAvailable(metrics, "time")).toBe(false);
      expect(getAvailableMetricKinds(metrics)).toEqual(["cost"]);
    });
  });

  describe("getDefaultMetricKind", () => {
    it("should prefer measured time", () => {
      const metrics = computeExplainMetrics(
        makePlan(makeNode({ actual_time_ms: 5, total_cost: 10 })),
      );

      expect(getDefaultMetricKind(metrics)).toBe("time");
    });

    it("should fall back to cost without timings", () => {
      const metrics = computeExplainMetrics(
        makePlan(makeNode({ total_cost: 10 })),
      );

      expect(getDefaultMetricKind(metrics)).toBe("cost");
    });

    it("should fall back to whatever is available", () => {
      const metrics = computeExplainMetrics(
        makePlan(makeNode({ actual_rows: 10 })),
      );

      expect(getDefaultMetricKind(metrics)).toBe("rows");
    });

    it("should return null when the plan carries no metric", () => {
      const metrics = computeExplainMetrics(makePlan(makeNode()));

      expect(getAvailableMetricKinds(metrics)).toEqual([]);
      expect(getDefaultMetricKind(metrics)).toBeNull();
    });
  });
});
