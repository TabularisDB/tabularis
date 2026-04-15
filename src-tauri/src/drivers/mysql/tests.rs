use super::explain::parse_mysql_query_block;
use crate::models::ExplainNode;

/// Helper: parse a MariaDB ANALYZE FORMAT=JSON string and return the root node.
fn parse_json(json: &str) -> ExplainNode {
    let val: serde_json::Value = serde_json::from_str(json).expect("invalid JSON");
    let qb = val.get("query_block").expect("missing query_block");
    let mut counter = 0u32;
    parse_mysql_query_block(qb, &mut counter)
}

/// Helper: flatten a tree into a vec in pre-order.
fn flatten(node: &ExplainNode) -> Vec<&ExplainNode> {
    let mut out = vec![node];
    for child in &node.children {
        out.extend(flatten(child));
    }
    out
}

// -- MariaDB filesort → temporary_table → nested_loop → table ------------

#[test]
fn test_mariadb_filesort_temporary_table() {
    let root = parse_json(
        r#"{
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
                                "attached_condition": "audit_log.`action` = 'login'"
                            }
                        }
                    ]
                }
            }
        }
    }"#,
    );

    let nodes = flatten(&root);
    assert_eq!(
        nodes.len(),
        4,
        "expected 4 nodes: QueryBlock → Filesort → TempTable → TableScan"
    );

    // Root: Query Block with block-level timing
    assert_eq!(root.node_type, "Query Block");
    assert!((root.total_cost.unwrap() - 0.87).abs() < 0.01);
    assert!((root.actual_time_ms.unwrap() - 3.22).abs() < 0.01);

    // Filesort with sort_key extra
    let filesort = &root.children[0];
    assert_eq!(filesort.node_type, "Filesort");
    assert!((filesort.actual_time_ms.unwrap() - 0.02).abs() < 0.01);
    assert_eq!(
        filesort.extra.get("sort_key").and_then(|v| v.as_str()),
        Some("count(0) desc")
    );

    // Temporary Table
    let tmp = &filesort.children[0];
    assert_eq!(tmp.node_type, "Temporary Table");

    // Table scan with r_table_time_ms + r_other_time_ms
    let scan = &tmp.children[0];
    assert_eq!(scan.node_type, "Full Table Scan");
    assert_eq!(scan.relation.as_deref(), Some("audit_log"));
    assert!((scan.plan_rows.unwrap() - 5131.0).abs() < 0.1);
    assert!((scan.actual_rows.unwrap() - 5146.0).abs() < 0.1);
    assert_eq!(scan.filter.as_deref(), Some("audit_log.`action` = 'login'"));
    // r_table_time_ms(1.77) + r_other_time_ms(1.41) = 3.18
    assert!((scan.actual_time_ms.unwrap() - 3.18).abs() < 0.01);
}

// -- Simple table scan without wrappers ------------------------------------

#[test]
fn test_simple_table_scan() {
    let root = parse_json(
        r#"{
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
    }"#,
    );

    assert_eq!(root.node_type, "Full Table Scan");
    assert_eq!(root.relation.as_deref(), Some("users"));
    assert!((root.plan_rows.unwrap() - 1000.0).abs() < 0.1);
    assert!((root.actual_time_ms.unwrap() - 0.5).abs() < 0.01);
}

// -- Nested loop join (two tables) ----------------------------------------

#[test]
fn test_nested_loop_join() {
    let root = parse_json(
        r#"{
        "query_block": {
            "select_id": 1,
            "cost": 5.0,
            "nested_loop": [
                {
                    "table": {
                        "table_name": "orders",
                        "access_type": "ALL",
                        "rows": 100
                    }
                },
                {
                    "table": {
                        "table_name": "items",
                        "access_type": "ref",
                        "rows": 5
                    }
                }
            ]
        }
    }"#,
    );

    assert_eq!(root.node_type, "Query Block");
    assert_eq!(root.children.len(), 2);
    assert_eq!(root.children[0].relation.as_deref(), Some("orders"));
    assert_eq!(root.children[0].node_type, "Full Table Scan");
    assert_eq!(root.children[1].relation.as_deref(), Some("items"));
    assert_eq!(root.children[1].node_type, "Index Lookup");
}

// -- Materialized subquery -------------------------------------------------

#[test]
fn test_materialized_subquery() {
    let root = parse_json(
        r#"{
        "query_block": {
            "select_id": 1,
            "nested_loop": [
                {
                    "table": {
                        "table_name": "orders",
                        "access_type": "ALL",
                        "rows": 100
                    }
                }
            ],
            "materialized": {
                "query_block": {
                    "select_id": 2,
                    "table": {
                        "table_name": "big_lookup",
                        "access_type": "ALL",
                        "rows": 50000
                    }
                }
            }
        }
    }"#,
    );

    let nodes = flatten(&root);
    // QueryBlock → orders (from nested_loop) + Materialized → QueryBlock → big_lookup
    assert_eq!(nodes.len(), 4);

    let mat = nodes
        .iter()
        .find(|n| n.node_type == "Materialized Subquery");
    assert!(mat.is_some(), "should have Materialized Subquery node");

    let big = nodes
        .iter()
        .find(|n| n.relation.as_deref() == Some("big_lookup"));
    assert!(big.is_some(), "should have big_lookup table");
}

// -- Union result ---------------------------------------------------------

#[test]
fn test_union_result() {
    let root = parse_json(
        r#"{
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
                            "table": {
                                "table_name": "users",
                                "access_type": "ALL",
                                "rows": 100
                            }
                        }
                    },
                    {
                        "query_block": {
                            "select_id": 2,
                            "table": {
                                "table_name": "admins",
                                "access_type": "ALL",
                                "rows": 10
                            }
                        }
                    }
                ]
            }
        }
    }"#,
    );

    let nodes = flatten(&root);
    let union = nodes.iter().find(|n| n.node_type == "Union Result");
    assert!(union.is_some(), "should have Union Result node");
    let u = union.expect("union node should exist");
    assert!((u.actual_time_ms.unwrap() - 0.5).abs() < 0.01);
    // Union result should have 2 children (the query_specifications)
    assert_eq!(u.children.len(), 2);
}

// -- Having condition -----------------------------------------------------

#[test]
fn test_having_condition() {
    let root = parse_json(
        r#"{
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
                        {
                            "table": {
                                "table_name": "events",
                                "access_type": "ALL",
                                "rows": 500
                            }
                        }
                    ]
                }
            }
        }
    }"#,
    );

    // Root should be "Having Filter" because having_condition is present
    assert_eq!(root.node_type, "Having Filter");
    assert_eq!(root.filter.as_deref(), Some("cnt > 5"));
}

// -- MariaDB filesort directly wrapping nested_loop (no temp table) -------

#[test]
fn test_filesort_without_temporary_table() {
    let root = parse_json(
        r#"{
        "query_block": {
            "select_id": 1,
            "filesort": {
                "sort_key": "t.name",
                "r_loops": 1,
                "r_total_time_ms": 0.1,
                "nested_loop": [
                    {
                        "table": {
                            "table_name": "t",
                            "access_type": "range",
                            "rows": 50
                        }
                    }
                ]
            }
        }
    }"#,
    );

    assert_eq!(root.node_type, "Query Block");
    let filesort = &root.children[0];
    assert_eq!(filesort.node_type, "Filesort");
    assert_eq!(filesort.children.len(), 1);
    assert_eq!(filesort.children[0].node_type, "Range Scan");
    assert_eq!(filesort.children[0].relation.as_deref(), Some("t"));
}

// -- read_sorted_file in nested_loop + subqueries with subquery_cache -----

#[test]
fn test_read_sorted_file_in_nested_loop_with_subquery_cache() {
    let root = parse_json(
        r#"{
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
    }"#,
    );

    let nodes = flatten(&root);

    // Root: Query Block
    assert_eq!(root.node_type, "Query Block");
    assert!((root.actual_time_ms.unwrap() - 10.94).abs() < 0.01);

    // Should have: Read Sorted File + 2 Subquery Cache children
    assert_eq!(root.children.len(), 3);

    // First child: Read Sorted File (from nested_loop)
    let rsf = &root.children[0];
    assert_eq!(rsf.node_type, "Read Sorted File");
    assert!((rsf.actual_rows.unwrap() - 20.0).abs() < 0.1);

    // Inside read_sorted_file: Filesort
    assert_eq!(rsf.children.len(), 1);
    let filesort = &rsf.children[0];
    assert_eq!(filesort.node_type, "Filesort");
    assert!((filesort.actual_time_ms.unwrap() - 9.95).abs() < 0.01);
    assert_eq!(
        filesort.extra.get("sort_key").and_then(|v| v.as_str()),
        Some("p.view_count desc")
    );
    assert_eq!(
        filesort.extra.get("r_limit").and_then(|v| v.as_u64()),
        Some(20)
    );
    assert_eq!(
        filesort
            .extra
            .get("r_used_priority_queue")
            .and_then(|v| v.as_bool()),
        Some(true)
    );

    // Inside filesort: direct table "p"
    assert_eq!(filesort.children.len(), 1);
    let table_p = &filesort.children[0];
    assert_eq!(table_p.node_type, "Full Table Scan");
    assert_eq!(table_p.relation.as_deref(), Some("p"));
    assert_eq!(
        table_p.filter.as_deref(),
        Some("p.view_count > (subquery#5)")
    );

    // Second child: Subquery Cache with r_hit_ratio=99
    let cache1 = &root.children[1];
    assert_eq!(cache1.node_type, "Subquery Cache");
    assert_eq!(cache1.actual_loops, Some(2000));
    assert_eq!(
        cache1.extra.get("r_hit_ratio").and_then(|v| v.as_u64()),
        Some(99)
    );
    // Should have a query_block child with table p2
    let p2 = nodes.iter().find(|n| n.relation.as_deref() == Some("p2"));
    assert!(p2.is_some(), "should have table p2 from subquery_cache");
    assert_eq!(p2.expect("p2 should exist").node_type, "Index Lookup");

    // Third child: Subquery Cache with r_hit_ratio=0
    let cache2 = &root.children[2];
    assert_eq!(cache2.node_type, "Subquery Cache");
    assert_eq!(cache2.actual_loops, Some(20));
    assert_eq!(
        cache2.extra.get("r_hit_ratio").and_then(|v| v.as_u64()),
        Some(0)
    );
    let pt = nodes.iter().find(|n| n.relation.as_deref() == Some("pt"));
    assert!(pt.is_some(), "should have table pt from subquery_cache");
}

// -- Filesort with direct table (no nested_loop / temporary_table) --------

#[test]
fn test_filesort_with_direct_table() {
    let root = parse_json(
        r#"{
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
    }"#,
    );

    assert_eq!(root.node_type, "Query Block");
    let filesort = &root.children[0];
    assert_eq!(filesort.node_type, "Filesort");
    assert_eq!(filesort.children.len(), 1);
    let table = &filesort.children[0];
    assert_eq!(table.node_type, "Full Table Scan");
    assert_eq!(table.relation.as_deref(), Some("t"));
    assert!((table.actual_rows.unwrap() - 100.0).abs() < 0.1);
}
