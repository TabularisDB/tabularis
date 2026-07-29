import { describe, it, expect } from "vitest";
import {
  countDiagnosticsBySeverity,
  getNodeDiagnostics,
  getPlanDiagnostics,
  getWorstSeverity,
  type ExplainDiagnosticKind,
} from "../src/diagnostics";
import { computeExplainMetrics } from "../src/metrics";
import type { ExplainNode, ExplainPlan } from "../src/types";

function makeNode(overrides: Partial<ExplainNode> = {}): ExplainNode {
  return {
    id: "node_0",
    node_type: "Index Scan",
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

function kinds(node: ExplainNode): ExplainDiagnosticKind[] {
  return getNodeDiagnostics(node).map((diagnostic) => diagnostic.kind);
}

describe("explainDiagnostics", () => {
  describe("getNodeDiagnostics", () => {
    it("should report nothing on a plain node", () => {
      expect(kinds(makeNode({ plan_rows: 100, actual_rows: 110 }))).toEqual([]);
    });

    it("should flag a node whose row estimate was far too low", () => {
      const diagnostics = getNodeDiagnostics(
        makeNode({ plan_rows: 10, actual_rows: 500 }),
      );

      expect(diagnostics[0].kind).toBe("over-estimate");
      expect(diagnostics[0].severity).toBe("critical");
      expect(diagnostics[0].value).toBe("50.0x");
    });

    it("should flag a node whose row estimate was far too high", () => {
      const diagnostics = getNodeDiagnostics(
        makeNode({ plan_rows: 5000, actual_rows: 100 }),
      );

      expect(diagnostics[0].kind).toBe("under-estimate");
      expect(diagnostics[0].severity).toBe("critical");
    });

    it("should treat a moderate estimate error as a warning", () => {
      const diagnostics = getNodeDiagnostics(
        makeNode({ plan_rows: 100, actual_rows: 500 }),
      );

      expect(diagnostics[0].severity).toBe("warning");
    });

    it("should not flag estimates within the tolerated factor", () => {
      expect(kinds(makeNode({ plan_rows: 100, actual_rows: 300 }))).toEqual([]);
    });

    it("should ignore estimate errors on tiny row counts", () => {
      expect(kinds(makeNode({ plan_rows: 1, actual_rows: 9 }))).toEqual([]);
    });

    it("should flag a sort that spilled to disk", () => {
      expect(
        kinds(
          makeNode({
            node_type: "Sort",
            extra: { "Sort Method": "external merge", "Sort Space Type": "Disk" },
          }),
        ),
      ).toContain("disk-sort");
    });

    it("should flag a sort that wrote temp blocks", () => {
      expect(
        kinds(makeNode({ node_type: "Sort", extra: { "Temp Written Blocks": 42 } })),
      ).toContain("disk-sort");
    });

    it("should not flag an in-memory sort", () => {
      expect(
        kinds(makeNode({ node_type: "Sort", extra: { "Sort Method": "quicksort" } })),
      ).toEqual([]);
    });

    it("should flag a filter that discards nearly every row", () => {
      const diagnostics = getNodeDiagnostics(
        makeNode({
          actual_rows: 10,
          extra: { "Rows Removed by Filter": 90_000 },
        }),
      );

      expect(diagnostics.map((entry) => entry.kind)).toContain("filter-loss");
      expect(diagnostics.find((entry) => entry.kind === "filter-loss")?.value).toBe(
        "90.0K",
      );
    });

    it("should not flag a filter that keeps most rows", () => {
      expect(
        kinds(
          makeNode({
            actual_rows: 90_000,
            extra: { "Rows Removed by Filter": 5000 },
          }),
        ),
      ).toEqual([]);
    });

    it("should not flag a filter below the row floor", () => {
      expect(
        kinds(makeNode({ actual_rows: 0, extra: { "Rows Removed by Filter": 200 } })),
      ).toEqual([]);
    });

    it("should flag a large sequential scan", () => {
      expect(
        kinds(makeNode({ node_type: "Seq Scan", actual_rows: 50_000 })),
      ).toContain("large-seq-scan");
    });

    it("should not flag a small sequential scan", () => {
      expect(kinds(makeNode({ node_type: "Seq Scan", actual_rows: 100 }))).toEqual(
        [],
      );
    });

    it("should recognise a MySQL full table scan", () => {
      expect(
        kinds(makeNode({ node_type: "Table", plan_rows: 80_000, extra: { access_type: "ALL" } })),
      ).toContain("large-seq-scan");
    });

    it("should flag heavy heap fetches", () => {
      expect(
        kinds(
          makeNode({
            node_type: "Index Only Scan",
            extra: { "Heap Fetches": 5000 },
          }),
        ),
      ).toContain("heap-fetches");
    });

    it("should flag parallel workers that did not all start", () => {
      const diagnostics = getNodeDiagnostics(
        makeNode({
          node_type: "Gather",
          extra: { "Workers Planned": 4, "Workers Launched": 1 },
        }),
      );

      expect(diagnostics[0].kind).toBe("workers-underused");
      expect(diagnostics[0].value).toBe("1/4");
    });

    it("should not flag workers that all started", () => {
      expect(
        kinds(
          makeNode({
            node_type: "Gather",
            extra: { "Workers Planned": 2, "Workers Launched": 2 },
          }),
        ),
      ).toEqual([]);
    });

    it("should flag a node executed very many times", () => {
      expect(kinds(makeNode({ actual_loops: 5000 }))).toContain("high-loops");
    });

    it("should flag a node that mostly missed shared buffers", () => {
      expect(
        kinds(makeNode({ buffers_hit: 100, buffers_read: 9000 })),
      ).toContain("cache-miss");
    });

    it("should not flag a node served from cache", () => {
      expect(kinds(makeNode({ buffers_hit: 9000, buffers_read: 100 }))).toEqual([]);
    });

    it("should flag a hotspot from its share of total time", () => {
      const child = makeNode({ id: "node_1", actual_time_ms: 90 });
      const plan = makePlan(
        makeNode({ id: "node_0", actual_time_ms: 100, children: [child] }),
      );
      const metrics = computeExplainMetrics(plan);

      const diagnostics = getNodeDiagnostics(child, metrics.byId.get("node_1"));

      expect(diagnostics[0].kind).toBe("hotspot");
      expect(diagnostics[0].severity).toBe("critical");
      expect(diagnostics[0].value).toBe("90%");
    });

    it("should not call a sub-millisecond node a hotspot", () => {
      const plan = makePlan(makeNode({ actual_time_ms: 0.2 }));
      const metrics = computeExplainMetrics(plan);

      expect(
        getNodeDiagnostics(plan.root, metrics.byId.get("node_0")).map(
          (entry) => entry.kind,
        ),
      ).not.toContain("hotspot");
    });

    it("should report only never-executed for a node that did not run", () => {
      const node = makeNode({
        node_type: "Seq Scan",
        actual_loops: 0,
        plan_rows: 100_000,
        actual_rows: 0,
      });
      const plan = makePlan(node);
      const metrics = computeExplainMetrics(plan);

      expect(
        getNodeDiagnostics(node, metrics.byId.get("node_0")).map(
          (entry) => entry.kind,
        ),
      ).toEqual(["never-executed"]);
    });

    it("should sort findings by severity", () => {
      const node = makeNode({
        node_type: "Seq Scan",
        plan_rows: 10,
        actual_rows: 50_000,
        actual_loops: 5000,
      });

      const severities = getNodeDiagnostics(node).map((entry) => entry.severity);

      expect(severities).toEqual(["critical", "warning", "info"]);
    });
  });

  describe("getPlanDiagnostics", () => {
    it("should key findings by node id and skip clean nodes", () => {
      const child = makeNode({
        id: "node_1",
        node_type: "Sort",
        extra: { "Sort Space Type": "Disk" },
      });
      const plan = makePlan(
        makeNode({ id: "node_0", plan_rows: 100, actual_rows: 100, children: [child] }),
      );

      const diagnostics = getPlanDiagnostics(plan, computeExplainMetrics(plan));

      expect(Array.from(diagnostics.keys())).toEqual(["node_1"]);
    });
  });

  describe("getWorstSeverity", () => {
    it("should return the highest severity present", () => {
      const diagnostics = getNodeDiagnostics(
        makeNode({ plan_rows: 10, actual_rows: 500, actual_loops: 5000 }),
      );

      expect(getWorstSeverity(diagnostics)).toBe("critical");
      expect(getWorstSeverity([])).toBeNull();
    });
  });

  describe("countDiagnosticsBySeverity", () => {
    it("should total findings across the plan", () => {
      const plan = makePlan(
        makeNode({
          node_type: "Seq Scan",
          plan_rows: 10,
          actual_rows: 50_000,
          actual_loops: 5000,
        }),
      );

      const counts = countDiagnosticsBySeverity(
        getPlanDiagnostics(plan, computeExplainMetrics(plan)),
      );

      expect(counts.critical).toBe(1);
      expect(counts.warning).toBe(1);
      expect(counts.info).toBe(1);
    });
  });
});
