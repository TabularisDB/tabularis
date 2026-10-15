import { describe, expect, it } from "vitest";
import type { ExplainNode, ExplainPlan } from "@tabularis/explain";
import { parseApprovalExplainPlan } from "../../src/utils/approvalExplain";

function node(overrides: Partial<ExplainNode>): ExplainNode {
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

function plan(overrides: Partial<ExplainPlan>): ExplainPlan {
  return {
    root: node({}),
    planning_time_ms: null,
    execution_time_ms: null,
    original_query: "SELECT 1",
    driver: "postgres",
    has_analyze_data: false,
    raw_output: null,
    ...overrides,
  };
}

describe("parseApprovalExplainPlan", () => {
  it("parses the raw ExplainQueryOutput stored by the MCP preflight", () => {
    const parsed = parseApprovalExplainPlan({
      kind: "raw",
      raw: {
        engine: "postgres",
        format: "postgres-json",
        payload: '[{ "Plan": { "Node Type": "Seq Scan", "Relation Name": "users" } }]',
        original_query: "DELETE FROM users",
      },
    });

    expect(parsed?.root.node_type).toBe("Seq Scan");
    expect(parsed?.driver).toBe("postgres");
  });

  it("passes a plugin's already parsed plan output through", () => {
    const parsed = parseApprovalExplainPlan({ kind: "plan", plan: plan({}) });
    expect(parsed?.root.id).toBe("node_0");
  });

  it("accepts a bare plan object", () => {
    const parsed = parseApprovalExplainPlan(plan({}));
    expect(parsed?.root.id).toBe("node_0");
  });

  it("returns null instead of throwing on an unparseable raw payload", () => {
    const parsed = parseApprovalExplainPlan({
      kind: "raw",
      raw: {
        engine: "sqlite",
        format: "sqlite-eqp-rows",
        payload: "not json",
        original_query: "SELECT 1",
      },
    });
    expect(parsed).toBeNull();
  });

  it("returns null for a plan without a root", () => {
    expect(parseApprovalExplainPlan({ kind: "plan", plan: {} })).toBeNull();
    expect(parseApprovalExplainPlan({ raw_output: "x" })).toBeNull();
  });

  it("returns null for non-object payloads", () => {
    expect(parseApprovalExplainPlan(null)).toBeNull();
    expect(parseApprovalExplainPlan(undefined)).toBeNull();
    expect(parseApprovalExplainPlan("Seq Scan")).toBeNull();
  });
});
