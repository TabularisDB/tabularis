import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ExplainNode, ExplainPlan } from "@tabularis/explain";
import {
  formatExplainTableCsv,
  saveExplainTableCsv,
  EXPLAIN_TABLE_CSV_HEADERS,
} from "../../src/utils/explainTableExport";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";

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
    root: makeNode({}),
    planning_time_ms: null,
    execution_time_ms: null,
    original_query: "SELECT 1",
    driver: "postgres",
    has_analyze_data: false,
    raw_output: null,
    ...overrides,
  };
}

describe("explainTableExport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("formatExplainTableCsv", () => {
    it("exports header with explicit units and depth field", () => {
      const plan = makePlan({
        root: makeNode({ id: "root", node_type: "Result" }),
      });

      const csv = formatExplainTableCsv(plan);
      const lines = csv.split("\n");

      expect(lines[0]).toBe(
        "index,depth,node_type,relation,cost,est_rows,actual_rows,self_time_ms,estimate_gap,filter",
      );
      expect(EXPLAIN_TABLE_CSV_HEADERS).toContain("depth");
      expect(EXPLAIN_TABLE_CSV_HEADERS).toContain("self_time_ms");
    });

    it("preserves tree pre-order and depth across collapsed and nested branches", () => {
      // Simulate a tree where child and grandchild exist.
      // Even if UI collapses them, formatExplainTableCsv must include every node in pre-order.
      const grandchild = makeNode({
        id: "grandchild",
        node_type: "Index Scan",
        relation: "users_pkey",
        total_cost: 8.5,
        plan_rows: 1,
      });
      const child = makeNode({
        id: "child",
        node_type: "Nested Loop",
        total_cost: 50.0,
        plan_rows: 10,
        children: [grandchild],
      });
      const root = makeNode({
        id: "root",
        node_type: "Limit",
        total_cost: 60.0,
        plan_rows: 5,
        children: [child],
      });
      const plan = makePlan({ root });

      const csv = formatExplainTableCsv(plan);
      const lines = csv.split("\n");

      expect(lines).toHaveLength(4); // 1 header + 3 nodes
      // Root (depth 0)
      expect(lines[1]).toBe("1,0,Limit,,60,5,,,,");
      // Child (depth 1)
      expect(lines[2]).toBe("2,1,Nested Loop,,50,10,,,,");
      // Grandchild (depth 2)
      expect(lines[3]).toBe("3,2,Index Scan,users_pkey,8.5,1,,,,");
    });

    it("leaves unavailable metrics empty rather than converting them to zero for estimates-only plans", () => {
      const root = makeNode({
        id: "root",
        node_type: "Seq Scan",
        relation: "orders",
        startup_cost: 0.0,
        total_cost: 150.25,
        plan_rows: 1200,
        actual_rows: null,
        actual_time_ms: null,
        filter: null,
      });
      const plan = makePlan({ root, has_analyze_data: false });

      const csv = formatExplainTableCsv(plan);
      const rows = csv.split("\n");

      expect(rows[1]).toBe("1,0,Seq Scan,orders,0 - 150.25,1200,,,,");
      const cols = rows[1].split(",");
      expect(cols).toHaveLength(10);
      // actual_rows is index 6, self_time_ms is index 7, estimate_gap is index 8
      expect(cols[6]).toBe(""); // NOT "0"
      expect(cols[7]).toBe(""); // NOT "0"
      expect(cols[8]).toBe(""); // NOT "0"
    });

    it("formats analyzed plans with execution metrics, explicit time in ms, and estimate gap", () => {
      const scanNode = makeNode({
        id: "scan",
        node_type: "Seq Scan",
        relation: "customers",
        startup_cost: 0,
        total_cost: 80,
        plan_rows: 100,
        actual_rows: 300,
        actual_time_ms: 15.456,
        actual_loops: 1,
        filter: "active = true",
      });
      const root = makeNode({
        id: "root",
        node_type: "Sort",
        startup_cost: 100,
        total_cost: 120,
        plan_rows: 100,
        actual_rows: 300,
        actual_time_ms: 20.0,
        actual_loops: 1,
        children: [scanNode],
      });
      const plan = makePlan({ root, has_analyze_data: true });

      const csv = formatExplainTableCsv(plan);
      const lines = csv.split("\n");

      // Root: actual_time_ms is 20, scan is 15.456, exclusiveTimeMs for root is ~4.544 ms
      // Ratio: 300 / 100 = 3x gap
      expect(lines[1]).toContain("Sort");
      expect(lines[1]).toContain("100 - 120");
      expect(lines[1]).toContain("300"); // actual_rows
      expect(lines[1]).toContain("3.00x"); // estimate_gap

      // Scan node
      expect(lines[2]).toContain("Seq Scan,customers");
      expect(lines[2]).toContain("15.456"); // self_time_ms
      expect(lines[2]).toContain("3.00x");
      expect(lines[2]).toContain("active = true");
    });

    it("properly quotes fields per RFC 4180 when containing commas, quotes, and newlines", () => {
      const root = makeNode({
        id: "root",
        node_type: 'Custom "Join", Strategy',
        relation: "users, accounts",
        total_cost: 10,
        plan_rows: 5,
        filter: '(status = "active" AND type = \'admin\')\nORDER BY id',
      });
      const plan = makePlan({ root });

      const csv = formatExplainTableCsv(plan);
      const lines = csv.split("\n");

      // Column 2 (node_type): contains commas and quotes -> wrapped in quotes, double quotes doubled
      expect(csv).toContain('"Custom ""Join"", Strategy"');
      // Column 3 (relation): contains comma -> wrapped in quotes
      expect(csv).toContain('"users, accounts"');
      // Column 9 (filter): contains quotes and newline -> wrapped in quotes, internal quotes doubled
      expect(csv).toContain('"(status = ""active"" AND type = \'admin\')\nORDER BY id"');
    });

    it("supports custom delimiter such as semicolon", () => {
      const root = makeNode({
        id: "root",
        node_type: "Seq Scan",
        relation: "users",
        total_cost: 50,
        plan_rows: 100,
      });
      const plan = makePlan({ root });

      const csv = formatExplainTableCsv(plan, { delimiter: ";" });
      expect(csv.split("\n")[0]).toBe(
        "index;depth;node_type;relation;cost;est_rows;actual_rows;self_time_ms;estimate_gap;filter",
      );
      expect(csv.split("\n")[1]).toBe("1;0;Seq Scan;users;50;100;;;;");
    });
  });

  describe("saveExplainTableCsv", () => {
    it("returns false without writing if user cancels the save dialog", async () => {
      vi.mocked(save).mockResolvedValueOnce(null);
      const plan = makePlan();

      const result = await saveExplainTableCsv(plan);

      expect(result).toBe(false);
      expect(save).toHaveBeenCalledWith({
        defaultPath: "explain-plan.csv",
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      expect(writeTextFile).not.toHaveBeenCalled();
    });

    it("writes formatted CSV to selected path and returns true on confirmation", async () => {
      vi.mocked(save).mockResolvedValueOnce("/path/to/my-plan.csv");
      const plan = makePlan({
        root: makeNode({ id: "root", node_type: "Limit", total_cost: 10 }),
      });

      const result = await saveExplainTableCsv(plan, undefined, "custom.csv");

      expect(result).toBe(true);
      expect(save).toHaveBeenCalledWith({
        defaultPath: "custom.csv",
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      expect(writeTextFile).toHaveBeenCalledWith(
        "/path/to/my-plan.csv",
        expect.stringContaining("index,depth,node_type"),
      );
    });
  });
});
