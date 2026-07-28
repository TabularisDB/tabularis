import { describe, expect, it } from "vitest";
import type { ExplainNode } from "../../src/types";
import {
  parseAnalyzeActual,
  parseMysqlAnalyzeText,
  parseMysqlQueryBlock,
  parseMysqlTabularRows,
} from "../../src/parsers/mysql";
import { NodeIdAllocator } from "../../src/parsers/node";

/** Helper: parse a MariaDB ANALYZE FORMAT=JSON string and return the root node. */
function parseJson(json: string): ExplainNode {
  const val: unknown = JSON.parse(json);
  const doc = val as { query_block?: unknown };
  expect(doc.query_block).toBeDefined();
  return parseMysqlQueryBlock(doc.query_block, new NodeIdAllocator());
}

/** Helper: flatten a tree into an array in pre-order. */
function flatten(node: ExplainNode): ExplainNode[] {
  return [node, ...node.children.flatMap(flatten)];
}

describe("mysql parsers", () => {
  describe("parseMysqlQueryBlock", () => {
    it("parses MariaDB filesort → temporary_table → nested_loop → table", () => {
      const root = parseJson(`{
        "query_block": {
            "select_id": 1,
            "cost": 0.87,
            "r_loops": 1,
            "r_total_time_ms": 3.22,
            "filesort": {
                "sort_key": "count(0) desc",
                "r_loops": 1,
                "r_total_time_ms": 0.02,
                "r_output_rows": 4,
                "r_buffer_size": "360",
                "r_sort_mode": "sort_key,rowid",
                "temporary_table": {
                    "nested_loop": [
                        {
                            "table": {
                                "table_name": "audit_log",
                                "access_type": "ALL",
                                "rows": 5131,
                                "r_rows": 5146,
                                "cost": 0.87,
                                "r_table_time_ms": 1.77,
                                "r_other_time_ms": 1.41,
                                "attached_condition": "audit_log.\`action\` = 'login'"
                            }
                        }
                    ]
                }
            }
        }
      }`);

      const nodes = flatten(root);
      expect(nodes, "QueryBlock → Filesort → TempTable → TableScan").toHaveLength(4);

      // Root: Query Block with block-level timing
      expect(root.node_type).toBe("Query Block");
      expect(root.total_cost).toBeCloseTo(0.87, 2);
      expect(root.actual_time_ms).toBeCloseTo(3.22, 2);

      // Filesort with sort_key extra
      const filesort = root.children[0];
      expect(filesort.node_type).toBe("Filesort");
      expect(filesort.actual_time_ms).toBeCloseTo(0.02, 2);
      expect(filesort.extra["sort_key"]).toBe("count(0) desc");

      // Temporary Table
      const tmp = filesort.children[0];
      expect(tmp.node_type).toBe("Temporary Table");

      // Table scan with r_table_time_ms + r_other_time_ms
      const scan = tmp.children[0];
      expect(scan.node_type).toBe("Full Table Scan");
      expect(scan.relation).toBe("audit_log");
      expect(scan.plan_rows).toBeCloseTo(5131, 1);
      expect(scan.actual_rows).toBeCloseTo(5146, 1);
      expect(scan.filter).toBe("audit_log.`action` = 'login'");
      // r_table_time_ms(1.77) + r_other_time_ms(1.41) = 3.18
      expect(scan.actual_time_ms).toBeCloseTo(3.18, 2);
    });

    it("parses a simple table scan without wrappers", () => {
      const root = parseJson(`{
        "query_block": {
            "select_id": 1,
            "table": {
                "table_name": "users",
                "access_type": "ALL",
                "rows": 1000,
                "filtered": 100,
                "r_rows": 998,
                "r_total_time_ms": 0.5
            }
        }
      }`);

      expect(root.node_type).toBe("Full Table Scan");
      expect(root.relation).toBe("users");
      expect(root.plan_rows).toBeCloseTo(1000, 1);
      expect(root.actual_time_ms).toBeCloseTo(0.5, 2);
    });

    it("parses a nested loop join over two tables", () => {
      const root = parseJson(`{
        "query_block": {
            "select_id": 1,
            "cost": 5.0,
            "nested_loop": [
                { "table": { "table_name": "orders", "access_type": "ALL", "rows": 100 } },
                { "table": { "table_name": "items", "access_type": "ref", "rows": 5 } }
            ]
        }
      }`);

      expect(root.node_type).toBe("Query Block");
      expect(root.children).toHaveLength(2);
      expect(root.children[0].relation).toBe("orders");
      expect(root.children[0].node_type).toBe("Full Table Scan");
      expect(root.children[1].relation).toBe("items");
      expect(root.children[1].node_type).toBe("Index Lookup");
    });

    it("parses a materialized subquery", () => {
      const root = parseJson(`{
        "query_block": {
            "select_id": 1,
            "nested_loop": [
                { "table": { "table_name": "orders", "access_type": "ALL", "rows": 100 } }
            ],
            "materialized": {
                "query_block": {
                    "select_id": 2,
                    "table": { "table_name": "big_lookup", "access_type": "ALL", "rows": 50000 }
                }
            }
        }
      }`);

      const nodes = flatten(root);
      // QueryBlock → orders (from nested_loop) + Materialized → QueryBlock → big_lookup
      expect(nodes).toHaveLength(4);
      expect(nodes.some((n) => n.node_type === "Materialized Subquery")).toBe(true);
      expect(nodes.some((n) => n.relation === "big_lookup")).toBe(true);
    });

    it("parses a union result with query specifications", () => {
      const root = parseJson(`{
        "query_block": {
            "select_id": 1,
            "union_result": {
                "table_name": "<union1,2>",
                "access_type": "ALL",
                "r_loops": 1,
                "r_total_time_ms": 0.5,
                "query_specifications": [
                    {
                        "query_block": {
                            "select_id": 1,
                            "table": { "table_name": "users", "access_type": "ALL", "rows": 100 }
                        }
                    },
                    {
                        "query_block": {
                            "select_id": 2,
                            "table": { "table_name": "admins", "access_type": "ALL", "rows": 10 }
                        }
                    }
                ]
            }
        }
      }`);

      const union = flatten(root).find((n) => n.node_type === "Union Result");
      expect(union).toBeDefined();
      expect(union?.actual_time_ms).toBeCloseTo(0.5, 2);
      // Union result should have 2 children (the query_specifications)
      expect(union?.children).toHaveLength(2);
    });

    it("labels a block with a having condition", () => {
      const root = parseJson(`{
        "query_block": {
            "select_id": 1,
            "cost": 1.5,
            "having_condition": "cnt > 5",
            "filesort": {
                "sort_key": "cnt desc",
                "r_loops": 1,
                "r_total_time_ms": 0.01,
                "temporary_table": {
                    "nested_loop": [
                        { "table": { "table_name": "events", "access_type": "ALL", "rows": 500 } }
                    ]
                }
            }
        }
      }`);

      // Root should be "Having Filter" because having_condition is present
      expect(root.node_type).toBe("Having Filter");
      expect(root.filter).toBe("cnt > 5");
    });

    it("parses a filesort directly wrapping nested_loop (no temp table)", () => {
      const root = parseJson(`{
        "query_block": {
            "select_id": 1,
            "filesort": {
                "sort_key": "t.name",
                "r_loops": 1,
                "r_total_time_ms": 0.1,
                "nested_loop": [
                    { "table": { "table_name": "t", "access_type": "range", "rows": 50 } }
                ]
            }
        }
      }`);

      expect(root.node_type).toBe("Query Block");
      const filesort = root.children[0];
      expect(filesort.node_type).toBe("Filesort");
      expect(filesort.children).toHaveLength(1);
      expect(filesort.children[0].node_type).toBe("Range Scan");
      expect(filesort.children[0].relation).toBe("t");
    });

    it("parses read_sorted_file in nested_loop plus subquery caches", () => {
      const root = parseJson(`{
        "query_block": {
            "select_id": 1,
            "cost": 0.41,
            "r_loops": 1,
            "r_total_time_ms": 10.94,
            "nested_loop": [
                {
                    "read_sorted_file": {
                        "r_rows": 20,
                        "filesort": {
                            "sort_key": "p.view_count desc",
                            "r_loops": 1,
                            "r_total_time_ms": 9.95,
                            "r_limit": 20,
                            "r_used_priority_queue": true,
                            "r_output_rows": 21,
                            "r_sort_mode": "sort_key,rowid",
                            "table": {
                                "table_name": "p",
                                "access_type": "ALL",
                                "rows": 1944,
                                "r_rows": 2000,
                                "cost": 0.41,
                                "r_table_time_ms": 1.40,
                                "r_other_time_ms": 2.02,
                                "filtered": 100,
                                "r_filtered": 50.55,
                                "attached_condition": "p.view_count > (subquery#5)"
                            }
                        }
                    }
                }
            ],
            "subqueries": [
                {
                    "subquery_cache": {
                        "r_loops": 2000,
                        "r_hit_ratio": 99,
                        "query_block": {
                            "select_id": 5,
                            "cost": 0.18,
                            "r_loops": 20,
                            "r_total_time_ms": 6.60,
                            "nested_loop": [
                                {
                                    "table": {
                                        "table_name": "p2",
                                        "access_type": "ref",
                                        "key": "idx_category",
                                        "rows": 97,
                                        "r_rows": 100,
                                        "cost": 0.18,
                                        "r_table_time_ms": 5.91,
                                        "r_other_time_ms": 0.64
                                    }
                                }
                            ]
                        }
                    }
                },
                {
                    "subquery_cache": {
                        "r_loops": 20,
                        "r_hit_ratio": 0,
                        "query_block": {
                            "select_id": 4,
                            "nested_loop": [
                                {
                                    "table": {
                                        "table_name": "pt",
                                        "access_type": "ref",
                                        "key": "PRIMARY",
                                        "rows": 2,
                                        "r_rows": 2.35
                                    }
                                }
                            ]
                        }
                    }
                }
            ]
        }
      }`);

      const nodes = flatten(root);

      // Root: Query Block
      expect(root.node_type).toBe("Query Block");
      expect(root.actual_time_ms).toBeCloseTo(10.94, 2);

      // Should have: Read Sorted File + 2 Subquery Cache children
      expect(root.children).toHaveLength(3);

      // First child: Read Sorted File (from nested_loop)
      const rsf = root.children[0];
      expect(rsf.node_type).toBe("Read Sorted File");
      expect(rsf.actual_rows).toBeCloseTo(20, 1);

      // Inside read_sorted_file: Filesort
      expect(rsf.children).toHaveLength(1);
      const filesort = rsf.children[0];
      expect(filesort.node_type).toBe("Filesort");
      expect(filesort.actual_time_ms).toBeCloseTo(9.95, 2);
      expect(filesort.extra["sort_key"]).toBe("p.view_count desc");
      expect(filesort.extra["r_limit"]).toBe(20);
      expect(filesort.extra["r_used_priority_queue"]).toBe(true);

      // Inside filesort: direct table "p"
      expect(filesort.children).toHaveLength(1);
      const tableP = filesort.children[0];
      expect(tableP.node_type).toBe("Full Table Scan");
      expect(tableP.relation).toBe("p");
      expect(tableP.filter).toBe("p.view_count > (subquery#5)");

      // Second child: Subquery Cache with r_hit_ratio=99
      const cache1 = root.children[1];
      expect(cache1.node_type).toBe("Subquery Cache");
      expect(cache1.actual_loops).toBe(2000);
      expect(cache1.extra["r_hit_ratio"]).toBe(99);
      // Should have a query_block child with table p2
      const p2 = nodes.find((n) => n.relation === "p2");
      expect(p2, "should have table p2 from subquery_cache").toBeDefined();
      expect(p2?.node_type).toBe("Index Lookup");

      // Third child: Subquery Cache with r_hit_ratio=0
      const cache2 = root.children[2];
      expect(cache2.node_type).toBe("Subquery Cache");
      expect(cache2.actual_loops).toBe(20);
      expect(cache2.extra["r_hit_ratio"]).toBe(0);
      expect(nodes.some((n) => n.relation === "pt")).toBe(true);
    });

    it("parses a filesort with a direct table (no nested_loop / temporary_table)", () => {
      const root = parseJson(`{
        "query_block": {
            "select_id": 1,
            "filesort": {
                "sort_key": "t.id desc",
                "r_loops": 1,
                "r_total_time_ms": 0.5,
                "r_output_rows": 10,
                "table": {
                    "table_name": "t",
                    "access_type": "ALL",
                    "rows": 100,
                    "r_rows": 100,
                    "r_table_time_ms": 0.3,
                    "r_other_time_ms": 0.1
                }
            }
        }
      }`);

      expect(root.node_type).toBe("Query Block");
      const filesort = root.children[0];
      expect(filesort.node_type).toBe("Filesort");
      expect(filesort.children).toHaveLength(1);
      const table = filesort.children[0];
      expect(table.node_type).toBe("Full Table Scan");
      expect(table.relation).toBe("t");
      expect(table.actual_rows).toBeCloseTo(100, 1);
    });
  });

  describe("parseAnalyzeActual", () => {
    it("multiplies the per-loop time by the loop count", () => {
      // MySQL tree-format EXPLAIN ANALYZE reports per-loop time. The total
      // node time is the per-loop end time multiplied by the loop count.
      // Regression for github issue #300.
      const [timeMs, rows, loops] = parseAnalyzeActual(
        "  (actual time=0.00773..0.00798 rows=1 loops=331603)",
      );

      expect(loops).toBe(331603);
      expect(rows).toBe(1.0);
      // 0.00798 * 331603 ≈ 2646.19 ms (not the bare 0.00798 ms per loop)
      expect(timeMs).not.toBeNull();
      expect(Math.abs((timeMs ?? 0) - 2646.19)).toBeLessThan(1.0);
    });

    it("keeps a single-loop time unchanged", () => {
      const [timeMs, , loops] = parseAnalyzeActual(
        "  (actual time=0.10..0.42 rows=5 loops=1)",
      );
      expect(loops).toBe(1);
      expect(timeMs).toBeCloseTo(0.42, 9);
    });

    it("keeps the per-loop time when loops are missing", () => {
      const [timeMs, , loops] = parseAnalyzeActual("  (actual time=0.10..0.42 rows=5)");
      expect(loops).toBeNull();
      expect(timeMs).toBeCloseTo(0.42, 9);
    });
  });

  describe("parseMysqlAnalyzeText", () => {
    it("reports the total time for a looped node", () => {
      const text =
        "-> Nested loop inner join  (cost=10.00 rows=5) (actual time=0.50..1.20 rows=5 loops=1)\n    -> Index lookup on ms using <auto_key0>  (cost=0.35 rows=1) (actual time=0.00773..0.00798 rows=1 loops=331603)";
      const root = parseMysqlAnalyzeText(text, new NodeIdAllocator());

      expect(root.node_type).toBe("Nested Loop");
      const lookup = root.children[0];
      expect(lookup.node_type).toBe("Index Lookup");
      expect(lookup.actual_loops).toBe(331603);
      expect(lookup.actual_time_ms).not.toBeNull();
      expect(Math.abs((lookup.actual_time_ms ?? 0) - 2646.19)).toBeLessThan(1.0);
    });
  });

  describe("parseMysqlTabularRows", () => {
    it("maps rows onto a synthetic Query root with typed children", () => {
      const plan = parseMysqlTabularRows([
        {
          select_type: "SIMPLE",
          table: "users",
          access_type: "ALL",
          possible_keys: "PRIMARY",
          key: null,
          rows: 1000,
          filtered: 100,
          extra: "Using where",
        },
        {
          select_type: "SIMPLE",
          table: "orders",
          access_type: "ref",
          possible_keys: null,
          key: "idx_user",
          rows: 5,
          filtered: null,
          extra: null,
        },
      ]);

      expect(plan.driver).toBe("mysql");
      expect(plan.has_analyze_data).toBe(false);
      expect(plan.root.node_type).toBe("Query");
      expect(plan.root.children).toHaveLength(2);

      const scan = plan.root.children[0];
      expect(scan.node_type).toBe("Full Table Scan");
      expect(scan.relation).toBe("users");
      expect(scan.plan_rows).toBe(1000);
      expect(scan.filter).toBe("Using where");
      expect(scan.extra["possible_keys"]).toBe("PRIMARY");
      expect(scan.extra["filtered"]).toBe(100);
      expect(scan.extra["select_type"]).toBe("SIMPLE");

      const lookup = plan.root.children[1];
      expect(lookup.node_type).toBe("Index Lookup");
      expect(lookup.index_condition).toBe("idx_user");

      expect(plan.raw_output).toContain("users");
      expect(plan.raw_output).toContain("orders");
    });
  });
});
