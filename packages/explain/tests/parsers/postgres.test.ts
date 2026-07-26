import { describe, expect, it } from "vitest";
import {
  parsePostgresJson,
  parsePostgresText,
} from "../../src/parsers/postgres";
import { detectFormat, parseExplain } from "../../src/parsers/source";

const POSTGRES_SIMPLE = `[
  {
    "Plan": {
      "Node Type": "Seq Scan",
      "Relation Name": "users",
      "Startup Cost": 0.00,
      "Total Cost": 12.34,
      "Plan Rows": 100,
      "Plan Width": 80
    },
    "Planning Time": 0.123,
    "Execution Time": 4.56
  }
]`;

const POSTGRES_NESTED = `[
  {
    "Plan": {
      "Node Type": "CTE Scan",
      "Startup Cost": 1.0,
      "Total Cost": 2.0,
      "Actual Rows": 11,
      "Actual Total Time": 2.089,
      "Actual Loops": 1,
      "Plans": [
        {
          "Node Type": "Seq Scan",
          "Relation Name": "orders",
          "Actual Rows": 11
        },
        {
          "Node Type": "Hash Join",
          "Join Type": "Inner",
          "Hash Cond": "(o.id = u.id)",
          "Filter": "(u.active)"
        }
      ]
    }
  }
]`;

describe("postgres parsers", () => {
  describe("detectFormat", () => {
    it("accepts a JSON array", () => {
      expect(detectFormat(" \n [\n  {} ]")).toBe("postgres-json");
    });

    it("accepts a JSON object", () => {
      expect(detectFormat('{ "Plan": {} }')).toBe("postgres-json");
    });

    it("rejects plain text without a cost header", () => {
      expect(() =>
        detectFormat("Seq Scan on users  (cost=0.00..12.34 rows=100)"),
      ).toThrow(/Unsupported/);
    });

    it("recognises text output with a cost header", () => {
      expect(detectFormat(POSTGRES_TEXT_FLAT)).toBe("postgres-text");
    });
  });

  describe("parsePostgresJson", () => {
    it("parses a flat node", () => {
      const plan = parsePostgresJson(POSTGRES_SIMPLE);
      expect(plan.driver).toBe("postgres");
      expect(plan.root.node_type).toBe("Seq Scan");
      expect(plan.root.relation).toBe("users");
      expect(plan.root.total_cost).toBe(12.34);
      expect(plan.planning_time_ms).toBe(0.123);
      expect(plan.execution_time_ms).toBe(4.56);
      expect(plan.has_analyze_data).toBe(false);
      expect(plan.raw_output).not.toBeNull();
      expect(plan.root.children).toHaveLength(0);
      expect(plan.root.extra).toHaveProperty("Plan Width");
    });

    it("preserves the tree and analyze flags", () => {
      const plan = parsePostgresJson(POSTGRES_NESTED);
      expect(plan.root.children).toHaveLength(2);
      expect(plan.has_analyze_data).toBe(true);
      expect(plan.root.actual_loops).toBe(1);

      const firstChild = plan.root.children[0];
      expect(firstChild.node_type).toBe("Seq Scan");
      expect(firstChild.relation).toBe("orders");

      const secondChild = plan.root.children[1];
      expect(secondChild.node_type).toBe("Hash Join");
      expect(secondChild.join_type).toBe("Inner");
      expect(secondChild.hash_condition).toBe("(o.id = u.id)");
      expect(secondChild.filter).toBe("(u.active)");
    });

    it("assigns unique node ids", () => {
      const plan = parsePostgresJson(POSTGRES_NESTED);
      const ids = [plan.root.id, ...plan.root.children.map((child) => child.id)];
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("accepts a single object document", () => {
      const plan = parsePostgresJson('{ "Plan": { "Node Type": "Result" } }');
      expect(plan.root.node_type).toBe("Result");
    });
  });

  describe("parseExplain error paths", () => {
    it("rejects an empty array", () => {
      expect(() => parseExplain("[]")).toThrow(/empty/);
    });

    it("rejects a missing Plan key", () => {
      expect(() => parseExplain('[{"NotAPlan": 1}]')).toThrow(/Plan/);
    });

    it("rejects invalid JSON", () => {
      expect(() => parseExplain("[not json]")).toThrow(/Failed to parse/);
    });

    it("rejects an unsupported format", () => {
      expect(() => parseExplain("-> Nested Loop  (cost=0.00..1.23)")).toThrow(
        /Unsupported/,
      );
    });
  });

  describe("parsePostgresText", () => {
    it("parses a flat node", () => {
      const plan = parsePostgresText(POSTGRES_TEXT_FLAT);
      expect(plan.driver).toBe("postgres");
      expect(plan.root.node_type).toBe("Seq Scan");
      expect(plan.root.relation).toBe("users");
      expect(plan.root.startup_cost).toBe(0.0);
      expect(plan.root.total_cost).toBe(12.34);
      expect(plan.root.plan_rows).toBe(100.0);
      expect(plan.planning_time_ms).toBe(0.123);
      expect(plan.execution_time_ms).toBeNull();
      expect(plan.has_analyze_data).toBe(false);
    });

    it("parses an ANALYZE tree", () => {
      const plan = parsePostgresText(POSTGRES_TEXT_ANALYZE);

      expect(plan.has_analyze_data).toBe(true);
      expect(plan.planning_time_ms).toBe(0.123);
      expect(plan.execution_time_ms).toBe(0.456);
      expect(plan.root.node_type).toBe("Hash Join");
      expect(plan.root.hash_condition).toBe("(a.id = b.id)");
      expect(plan.root.actual_rows).toBe(5.0);
      expect(plan.root.actual_loops).toBe(1);
      expect(plan.root.actual_time_ms).toBe(0.2);

      expect(plan.root.children).toHaveLength(2);

      const seq = plan.root.children[0];
      expect(seq.node_type).toBe("Seq Scan");
      expect(seq.relation).toBe("a");
      expect(seq.filter).toBe("(a.active)");

      const hash = plan.root.children[1];
      expect(hash.node_type).toBe("Hash");
      expect(hash.children).toHaveLength(1);
      expect(hash.children[0].relation).toBe("b");
    });

    it("skips header and footer lines", () => {
      const raw = "QUERY PLAN\n-----------\n Result  (cost=0.00..0.01 rows=1 width=4)\n(1 row)\n";
      const plan = parsePostgresText(raw);
      expect(plan.root.node_type).toBe("Result");
      expect(plan.root.children).toHaveLength(0);
    });

    it("keeps the 'using index' modifier in the node type", () => {
      const raw = " Index Scan using users_pkey on users  (cost=0.00..8.00 rows=1 width=80)\n";
      const plan = parsePostgresText(raw);
      expect(plan.root.node_type).toBe("Index Scan using users_pkey");
      expect(plan.root.relation).toBe("users");
    });

    it("rejects output without plan nodes", () => {
      expect(() => parsePostgresText("QUERY PLAN\n---\n(0 rows)\n")).toThrow(
        /No plan nodes/,
      );
    });
  });

  describe("parseExplain routing", () => {
    it("routes text output to the text parser", () => {
      const plan = parseExplain(POSTGRES_TEXT_FLAT);
      expect(plan.root.node_type).toBe("Seq Scan");
    });
  });
});

const POSTGRES_TEXT_FLAT =
  " Seq Scan on users  (cost=0.00..12.34 rows=100 width=80)\n Planning Time: 0.123 ms\n";

const POSTGRES_TEXT_ANALYZE = `QUERY PLAN
-----------------------------------------------------------------------------
 Hash Join  (cost=1.00..10.00 rows=5 width=40) (actual time=0.10..0.20 rows=5 loops=1)
   Hash Cond: (a.id = b.id)
   ->  Seq Scan on a  (cost=0.00..5.00 rows=100 width=4) (actual time=0.01..0.05 rows=100 loops=1)
     Filter: (a.active)
   ->  Hash  (cost=0.50..0.50 rows=1 width=36) (actual time=0.02..0.02 rows=1 loops=1)
     ->  Seq Scan on b  (cost=0.00..0.50 rows=1 width=36) (actual time=0.01..0.01 rows=1 loops=1)
 Planning Time: 0.123 ms
 Execution Time: 0.456 ms
(7 rows)
`;
