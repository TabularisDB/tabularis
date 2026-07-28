import { describe, it, expect } from "vitest";
import { explainPlanToFlow } from "../src/flow";
import type { ExplainDiagnostic } from "../src/diagnostics";
import type { ExplainNode, ExplainPlan } from "../src/types";

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

describe("flow", () => {
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

    it("should take diagnostics from the supplied map", () => {
      const child = makeNode({ id: "node_1" });
      const root = makeNode({ id: "node_0", children: [child] });
      const plan = makePlan({ root });
      const diagnostic: ExplainDiagnostic = {
        kind: "hotspot",
        severity: "critical",
        labelKey: "editor.visualExplain.diagnostics.hotspot.label",
        descriptionKey: "editor.visualExplain.diagnostics.hotspot.description",
      };

      const { nodes } = explainPlanToFlow(
        plan,
        null,
        undefined,
        new Map([["node_1", [diagnostic]]]),
      );

      expect(nodes.find((node) => node.id === "node_1")?.data.diagnostics).toEqual([
        diagnostic,
      ]);
      expect(nodes.find((node) => node.id === "node_0")?.data.diagnostics).toEqual(
        [],
      );
    });
  });

  // ---------------------------------------------------------------------------
  // getNodeCostColor
  // ---------------------------------------------------------------------------

});
