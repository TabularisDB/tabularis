import { describe, expect, it } from "vitest";
import type { ExplainPlan } from "../src/types";
import type { RawExplainOutput } from "../src/raw";
import { parseRawExplain, resolveExplainOutput } from "../src/raw";

function raw(overrides: Partial<RawExplainOutput>): RawExplainOutput {
  return {
    engine: "postgres",
    format: "postgres-json",
    payload: "",
    original_query: "SELECT 1",
    ...overrides,
  };
}

describe("raw", () => {
  describe("parseRawExplain", () => {
    it("parses a postgres-json payload and stamps engine and query", () => {
      const plan = parseRawExplain(
        raw({
          payload: '[{ "Plan": { "Node Type": "Seq Scan", "Relation Name": "users" } }]',
          original_query: "SELECT * FROM users",
        }),
      );

      expect(plan.driver).toBe("postgres");
      expect(plan.original_query).toBe("SELECT * FROM users");
      expect(plan.root.node_type).toBe("Seq Scan");
    });

    it("parses a mysql-json payload", () => {
      const plan = parseRawExplain(
        raw({
          engine: "mysql",
          format: "mysql-json",
          payload:
            '{ "query_block": { "table": { "table_name": "users", "access_type": "ALL" } } }',
        }),
      );

      expect(plan.driver).toBe("mysql");
      expect(plan.root.node_type).toBe("Full Table Scan");
      expect(plan.root.relation).toBe("users");
    });

    it("parses a mysql-analyze-text payload", () => {
      const plan = parseRawExplain(
        raw({
          engine: "mysql",
          format: "mysql-analyze-text",
          payload:
            "-> Table scan on t1  (cost=1.25 rows=10) (actual time=0.045..0.145 rows=10 loops=1)",
        }),
      );

      expect(plan.root.node_type).toBe("Full Table Scan");
      expect(plan.has_analyze_data).toBe(true);
    });

    it("parses mysql-tabular-rows from a JSON array payload", () => {
      const plan = parseRawExplain(
        raw({
          engine: "mysql",
          format: "mysql-tabular-rows",
          payload: JSON.stringify([
            {
              select_type: "SIMPLE",
              table: "users",
              access_type: "ALL",
              possible_keys: null,
              key: null,
              rows: 42,
              filtered: null,
              extra: null,
            },
          ]),
        }),
      );

      expect(plan.root.node_type).toBe("Query");
      expect(plan.root.children[0].node_type).toBe("Full Table Scan");
      expect(plan.root.children[0].plan_rows).toBe(42);
    });

    it("parses sqlite-eqp-rows from a JSON array payload", () => {
      const plan = parseRawExplain(
        raw({
          engine: "sqlite",
          format: "sqlite-eqp-rows",
          payload: JSON.stringify([{ id: 0, parent: 0, detail: "SCAN users" }]),
        }),
      );

      expect(plan.driver).toBe("sqlite");
      expect(plan.root.node_type).toBe("Scan");
      expect(plan.root.relation).toBe("users");
    });

    it("rejects a rows payload that is not a JSON array", () => {
      expect(() =>
        parseRawExplain(
          raw({ engine: "sqlite", format: "sqlite-eqp-rows", payload: "{}" }),
        ),
      ).toThrow(/JSON array/);
    });
  });

  describe("resolveExplainOutput", () => {
    it("passes a plugin's already parsed plan through untouched", () => {
      const plan: ExplainPlan = {
        root: {
          id: "node_0",
          node_type: "Keyspace Scan",
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
        },
        planning_time_ms: null,
        execution_time_ms: null,
        original_query: "SCAN 0",
        driver: "redis",
        has_analyze_data: false,
        raw_output: null,
      };

      expect(resolveExplainOutput({ kind: "plan", plan })).toBe(plan);
    });

    it("parses a raw payload from a built-in driver", () => {
      const resolved = resolveExplainOutput({
        kind: "raw",
        raw: raw({
          payload: '{ "Plan": { "Node Type": "Result" } }',
        }),
      });
      expect(resolved.root.node_type).toBe("Result");
      expect(resolved.original_query).toBe("SELECT 1");
    });
  });
});
