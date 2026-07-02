use super::build_mysql_pk_where;
use super::explain::{parse_analyze_actual, parse_mysql_analyze_text, parse_mysql_query_block};
use super::{is_text_protocol_stmt, MysqlDriver};
use super::helpers::{inline_str_placeholders, mysql_bytes_literal, mysql_string_literal};
use crate::drivers::driver_trait::DatabaseDriver;
use crate::models::ExplainNode;
use crate::models::{ConnectionParams, DatabaseSelection};

#[test]
fn build_connection_url_includes_disabled_ssl_mode() {
    let driver = MysqlDriver::new();
    let params = ConnectionParams {
        driver: "mysql".to_string(),
        host: Some("127.0.0.1".to_string()),
        port: Some(3306),
        username: Some("root".to_string()),
        password: Some("secret".to_string()),
        database: DatabaseSelection::Single("dec".to_string()),
        ssl_mode: Some("disabled".to_string()),
        ssl_ca: None,
        ssl_cert: None,
        ssl_key: None,
        ssh_enabled: None,
        ssh_connection_id: None,
        ssh_host: None,
        ssh_port: None,
        ssh_user: None,
        ssh_password: None,
        ssh_key_file: None,
        ssh_key_passphrase: None,
        save_in_keychain: None,
        connection_id: None,
        ..Default::default()
    };

    let url = driver.build_connection_url(&params).unwrap();

    assert!(url.contains("ssl-mode=disabled"), "url was: {url}");
}

// -- Text-protocol literal helpers (Warpgate / cleartext bastion path) -----

#[test]
fn mysql_string_literal_quotes_and_escapes() {
    // Default sql_mode: backslash escapes enabled.
    assert_eq!(mysql_string_literal("public", false), "'public'");
    assert_eq!(mysql_string_literal("o'brien", false), "'o\\'brien'");
    assert_eq!(mysql_string_literal("a\\b", false), "'a\\\\b'");
    assert_eq!(mysql_string_literal("line\nbreak", false), "'line\\nbreak'");
    assert_eq!(mysql_string_literal("", false), "''");
}

#[test]
fn mysql_string_literal_no_backslash_escapes_mode() {
    // Under NO_BACKSLASH_ESCAPES the backslash is literal, so quotes are
    // doubled and backslashes are left untouched. Escaping a single quote as
    // `\'` (the default-mode form) would be mis-parsed here and is an
    // injection vector — verify we use `''` instead.
    assert_eq!(mysql_string_literal("public", true), "'public'");
    assert_eq!(mysql_string_literal("o'brien", true), "'o''brien'");
    assert_eq!(mysql_string_literal("a\\b", true), "'a\\b'");
    // A trailing backslash must not escape the closing quote.
    assert_eq!(mysql_string_literal("ends\\", true), "'ends\\'");
    assert_eq!(
        mysql_string_literal("' OR '1'='1", true),
        "''' OR ''1''=''1'"
    );
}

#[test]
fn mysql_bytes_literal_hex_encodes() {
    assert_eq!(mysql_bytes_literal(&[]), "x''");
    assert_eq!(mysql_bytes_literal(&[0x00, 0x0f, 0xff]), "x'000fff'");
    assert_eq!(mysql_bytes_literal(b"AB"), "x'4142'");
}

#[test]
fn inline_str_placeholders_substitutes_in_order() {
    let sql = "WHERE table_schema = ? AND table_name = ?";
    assert_eq!(
        inline_str_placeholders(sql, &["mydb", "users"], false),
        "WHERE table_schema = 'mydb' AND table_name = 'users'"
    );
}

#[test]
fn inline_str_placeholders_escapes_injection_attempt() {
    let sql = "WHERE table_schema = ?";
    assert_eq!(
        inline_str_placeholders(sql, &["x' OR '1'='1"], false),
        "WHERE table_schema = 'x\\' OR \\'1\\'=\\'1'"
    );
    // Same payload under NO_BACKSLASH_ESCAPES: quotes are doubled.
    assert_eq!(
        inline_str_placeholders(sql, &["x' OR '1'='1"], true),
        "WHERE table_schema = 'x'' OR ''1''=''1'"
    );
}

#[test]
fn inline_str_placeholders_leaves_extra_placeholders() {
    // Fewer binds than placeholders: the surplus `?` stays untouched.
    assert_eq!(
        inline_str_placeholders("a = ? AND b = ?", &["1"], false),
        "a = '1' AND b = ?"
    );
    assert_eq!(
        inline_str_placeholders("no params here", &[], false),
        "no params here"
    );
}

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

#[test]
fn parse_analyze_actual_multiplies_per_loop_time_by_loops() {
    // MySQL tree-format EXPLAIN ANALYZE reports per-loop time. The total node
    // time is the per-loop end time multiplied by the loop count.
    // Regression for github issue #300.
    let (time_ms, rows, loops) =
        parse_analyze_actual("  (actual time=0.00773..0.00798 rows=1 loops=331603)");

    assert_eq!(loops, Some(331603));
    assert_eq!(rows, Some(1.0));
    // 0.00798 * 331603 ≈ 2646.19 ms (not the bare 0.00798 ms per loop)
    let total = time_ms.expect("time should be parsed");
    assert!(
        (total - 2646.19).abs() < 1.0,
        "expected ~2646ms total, got {total}"
    );
}

#[test]
fn parse_analyze_actual_single_loop_is_unchanged() {
    let (time_ms, _, loops) = parse_analyze_actual("  (actual time=0.10..0.42 rows=5 loops=1)");
    assert_eq!(loops, Some(1));
    assert!((time_ms.unwrap() - 0.42).abs() < 1e-9);
}

#[test]
fn parse_analyze_actual_missing_loops_keeps_per_loop_time() {
    let (time_ms, _, loops) = parse_analyze_actual("  (actual time=0.10..0.42 rows=5)");
    assert_eq!(loops, None);
    assert!((time_ms.unwrap() - 0.42).abs() < 1e-9);
}

#[test]
fn parse_mysql_analyze_text_reports_total_time_for_looped_node() {
    let text = "-> Nested loop inner join  (cost=10.00 rows=5) (actual time=0.50..1.20 rows=5 loops=1)\n    -> Index lookup on ms using <auto_key0>  (cost=0.35 rows=1) (actual time=0.00773..0.00798 rows=1 loops=331603)";
    let mut counter = 0;
    let root = parse_mysql_analyze_text(text, &mut counter);

    assert_eq!(root.node_type, "Nested Loop");
    let lookup = &root.children[0];
    assert_eq!(lookup.node_type, "Index Lookup");
    assert_eq!(lookup.actual_loops, Some(331603));
    let total = lookup.actual_time_ms.expect("looped node has a time");
    assert!(
        (total - 2646.19).abs() < 1.0,
        "expected ~2646ms total for index lookup, got {total}"
    );
}

#[test]
fn routes_mysql_routine_ddl_through_text_protocol() {
    for sql in [
        "DROP PROCEDURE IF EXISTS sociedades_close;",
        "CREATE PROCEDURE sociedades_close() SELECT 1;",
        "CREATE DEFINER=`root`@`localhost` PROCEDURE sociedades_close() SELECT 1;",
        "CREATE  DEFINER=`root`@`localhost` PROCEDURE sociedades_close() SELECT 1;",
        "CREATE DEFINER=`root`@`localhost`   PROCEDURE sociedades_close() SELECT 1;",
        "CREATE OR REPLACE PROCEDURE sociedades_close() SELECT 1;",
        "CREATE OR  REPLACE PROCEDURE sociedades_close() SELECT 1;",
        "CREATE OR  REPLACE DEFINER=`root`@`localhost` PROCEDURE sociedades_close() SELECT 1;",
        "CREATE OR REPLACE  DEFINER=`root`@`localhost` PROCEDURE sociedades_close() SELECT 1;",
        "CREATE OR REPLACE DEFINER=`root`@`localhost` PROCEDURE sociedades_close() SELECT 1;",
        "CREATE OR REPLACE DEFINER=`root`@`localhost`   PROCEDURE sociedades_close() SELECT 1;",
        "ALTER PROCEDURE sociedades_close COMMENT 'patched';",
        "DROP FUNCTION IF EXISTS sociedades_total;",
        "CREATE FUNCTION sociedades_total() RETURNS INT RETURN 1;",
        "CREATE DEFINER=`root`@`localhost` FUNCTION sociedades_total() RETURNS INT RETURN 1;",
        "CREATE  DEFINER=`root`@`localhost` FUNCTION sociedades_total() RETURNS INT RETURN 1;",
        "CREATE DEFINER=`root`@`localhost`   FUNCTION sociedades_total() RETURNS INT RETURN 1;",
        "CREATE OR REPLACE FUNCTION sociedades_total() RETURNS INT RETURN 1;",
        "CREATE OR  REPLACE FUNCTION sociedades_total() RETURNS INT RETURN 1;",
        "CREATE OR  REPLACE DEFINER=`root`@`localhost` FUNCTION sociedades_total() RETURNS INT RETURN 1;",
        "CREATE OR REPLACE  DEFINER=`root`@`localhost` FUNCTION sociedades_total() RETURNS INT RETURN 1;",
        "CREATE OR REPLACE DEFINER=`root`@`localhost` FUNCTION sociedades_total() RETURNS INT RETURN 1;",
        "CREATE OR REPLACE DEFINER=`root`@`localhost`   FUNCTION sociedades_total() RETURNS INT RETURN 1;",
        "ALTER FUNCTION sociedades_total COMMENT 'patched';",
    ] {
        assert!(
            is_text_protocol_stmt(sql),
            "expected text protocol routing for {sql}"
        );
    }
}

#[test]
fn keeps_regular_dml_out_of_text_protocol_classifier() {
    for sql in [
        "SELECT * FROM routines",
        "INSERT INTO routines(name) VALUES ('sociedades_close')",
        "DROP TABLE IF EXISTS routines_backup",
        // `CREATE OR REPLACE` is also valid for non-routine objects such as
        // VIEW that are not part of this routing rule — must not match.
        "CREATE OR REPLACE VIEW routines_view AS SELECT 1",
    ] {
        assert!(
            !is_text_protocol_stmt(sql),
            "did not expect text protocol routing for {sql}"
        );
    }
}

#[test]
fn definer_view_with_routine_words_in_body_is_not_text_protocol() {
    // `CREATE [OR REPLACE] DEFINER … VIEW … AS SELECT …` must not be
    // classified as a routine even when the SELECT body mentions
    // `PROCEDURE`/`FUNCTION`. Regression for the loose `contains`-based
    // matching that searched the full statement.
    for sql in [
        "CREATE DEFINER=`root`@`localhost` VIEW v AS SELECT 'call PROCEDURE foo' AS col",
        "CREATE OR REPLACE DEFINER=`root`@`localhost` VIEW v AS SELECT name FROM routines WHERE note LIKE '%FUNCTION%'",
        "CREATE OR REPLACE DEFINER=CURRENT_USER() VIEW v AS SELECT 'PROCEDURE' AS word UNION SELECT 'FUNCTION' AS word",
    ] {
        assert!(
            !is_text_protocol_stmt(sql),
            "DEFINER … VIEW with routine words in body must not route through text protocol: {sql}"
        );
    }
}

#[test]
fn spaced_definer_routes_routines_through_text_protocol() {
    // MySQL accepts spaced definer forms such as `'root' @ 'localhost'`
    // where the value contains internal whitespace. The classifier must
    // skip past the whole definer value and find the real object keyword
    // instead of stopping at the first space inside the definer.
    for sql in [
        "CREATE DEFINER = 'root' @ 'localhost' PROCEDURE sociedades_close() SELECT 1;",
        "CREATE DEFINER = 'root' @ 'localhost'   PROCEDURE sociedades_close() SELECT 1;",
        "CREATE OR REPLACE DEFINER = 'root' @ 'localhost' FUNCTION sociedades_total() RETURNS INT RETURN 1;",
        "CREATE OR REPLACE DEFINER = 'root' @ 'localhost'   FUNCTION sociedades_total() RETURNS INT RETURN 1;",
    ] {
        assert!(
            is_text_protocol_stmt(sql),
            "expected text protocol routing for spaced definer routine: {sql}"
        );
    }
}

#[test]
fn spaced_definer_view_with_routine_words_in_body_is_not_text_protocol() {
    // A spaced definer must not let `PROCEDURE`/`FUNCTION` words that
    // appear inside a VIEW body route the statement through text
    // protocol — only the actual object-type keyword after the definer
    // clause counts, and the scan must stop at `VIEW` before reaching
    // the body.
    for sql in [
        "CREATE DEFINER = 'root' @ 'localhost' VIEW v AS SELECT 'call PROCEDURE foo' AS col",
        "CREATE OR REPLACE DEFINER = 'root' @ 'localhost' VIEW v AS SELECT name FROM routines WHERE note LIKE '%FUNCTION%'",
        "CREATE DEFINER = 'root' @ 'localhost' VIEW v AS SELECT 'PROCEDURE' AS word UNION SELECT 'FUNCTION' AS word",
    ] {
        assert!(
            !is_text_protocol_stmt(sql),
            "spaced definer VIEW with routine words in body must not route through text protocol: {sql}"
        );
    }
}

mod build_mysql_pk_where_tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn single_column_returns_correct_pair() {
        let mut pk_map = HashMap::new();
        pk_map.insert("id".to_string(), serde_json::json!(42));
        let pairs = build_mysql_pk_where(&pk_map).unwrap();
        assert_eq!(pairs.len(), 1);
        assert_eq!(pairs[0].0, "id");
        assert_eq!(pairs[0].1, serde_json::json!(42));
    }

    #[test]
    fn composite_pk_columns_are_sorted_alphabetically() {
        let mut pk_map = HashMap::new();
        pk_map.insert("z_col".to_string(), serde_json::json!(1));
        pk_map.insert("a_col".to_string(), serde_json::json!(2));
        let pairs = build_mysql_pk_where(&pk_map).unwrap();
        assert_eq!(pairs[0].0, "a_col");
        assert_eq!(pairs[1].0, "z_col");
    }

    #[test]
    fn empty_pk_map_is_rejected() {
        let pk_map: HashMap<String, serde_json::Value> = HashMap::new();
        assert!(build_mysql_pk_where(&pk_map).is_err());
    }
}
