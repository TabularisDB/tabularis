use super::helpers::{mysql_row_str, mysql_row_str_opt};
use crate::models::{ConnectionParams, ExplainNode, ExplainPlan};
use crate::pool_manager::get_mysql_pool;
use sqlx::{Column, Row};

/// Server capabilities detected via `SELECT VERSION()`.
struct MysqlCapabilities {
    /// EXPLAIN FORMAT=JSON (MySQL 5.6+ / MariaDB 10.1+)
    supports_json_format: bool,
    /// EXPLAIN ANALYZE (MySQL 8.0.18+ only)
    supports_explain_analyze: bool,
    /// ANALYZE FORMAT=JSON (MariaDB 10.1+ only)
    supports_analyze_format: bool,
}

fn parse_mysql_version(version_str: &str) -> MysqlCapabilities {
    let is_mariadb = version_str.to_lowercase().contains("mariadb");

    // Extract "5.5.24" from "5.5.24-55-log" or "10.5.22-MariaDB"
    let version_part = version_str.split('-').next().unwrap_or("");
    let parts: Vec<u32> = version_part
        .split('.')
        .filter_map(|s| s.parse().ok())
        .collect();
    let ver = (
        parts.first().copied().unwrap_or(0),
        parts.get(1).copied().unwrap_or(0),
        parts.get(2).copied().unwrap_or(0),
    );

    if is_mariadb {
        MysqlCapabilities {
            supports_json_format: ver >= (10, 1, 0),
            supports_explain_analyze: false,
            supports_analyze_format: ver >= (10, 1, 0),
        }
    } else {
        MysqlCapabilities {
            supports_json_format: ver >= (5, 6, 0),
            supports_explain_analyze: ver >= (8, 0, 18),
            supports_analyze_format: false,
        }
    }
}

pub async fn explain_query(
    params: &ConnectionParams,
    query: &str,
    analyze: bool,
    schema: Option<&str>,
) -> Result<ExplainPlan, String> {
    let effective_params;
    let pool = if let Some(db) = schema {
        effective_params = {
            let mut p = params.clone();
            p.database = crate::models::DatabaseSelection::Single(db.to_string());
            p
        };
        get_mysql_pool(&effective_params).await?
    } else {
        get_mysql_pool(params).await?
    };

    // Detect server version to skip unsupported EXPLAIN variants
    let caps = {
        let mut vc = pool.acquire().await.map_err(|e| e.to_string())?;
        let ver_row = sqlx::query("SELECT VERSION()")
            .fetch_one(&mut *vc)
            .await
            .ok();
        let ver_str: String = ver_row.and_then(|r| r.try_get(0).ok()).unwrap_or_default();
        log::debug!("MySQL/MariaDB version: {}", ver_str);
        parse_mysql_version(&ver_str)
    };

    // EXPLAIN ANALYZE — MySQL 8.0.18+ text tree with estimated + actual data
    if analyze && caps.supports_explain_analyze {
        let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
        let analyze_sql = format!("EXPLAIN ANALYZE {}", query);
        if let Ok(rows) = sqlx::query(&analyze_sql).fetch_all(&mut *conn).await {
            let mut lines = Vec::new();
            for row in &rows {
                if let Ok(line) = row.try_get::<String, _>(0) {
                    lines.push(line);
                }
            }
            if !lines.is_empty() {
                let raw_output = lines.join("\n");
                let mut counter: u32 = 0;
                let root = parse_mysql_analyze_text(&raw_output, &mut counter);
                let has_analyze = has_analyze_data_recursive(&root);

                return Ok(ExplainPlan {
                    root,
                    planning_time_ms: None,
                    execution_time_ms: None,
                    original_query: query.to_string(),
                    driver: "mysql".to_string(),
                    has_analyze_data: has_analyze,
                    raw_output: Some(raw_output),
                });
            }
        }
    }

    // ANALYZE FORMAT=JSON — MariaDB 10.1+ (executes the query and returns JSON
    // with both estimated and r_* actual fields)
    if analyze && caps.supports_analyze_format {
        let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
        let maria_sql = format!("ANALYZE FORMAT=JSON {}", query);
        if let Ok(row) = sqlx::query(&maria_sql).fetch_one(&mut *conn).await {
            if let Ok(raw_json) = row.try_get::<String, _>(0) {
                if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&raw_json) {
                    if let Some(query_block) = json_val.get("query_block") {
                        let mut counter: u32 = 0;
                        let root = parse_mysql_query_block(query_block, &mut counter);
                        let has_analyze = has_analyze_data_recursive(&root);

                        // MariaDB: query_optimization.r_total_time_ms
                        let planning_time_ms = json_val
                            .get("query_optimization")
                            .and_then(|qo| qo.get("r_total_time_ms"))
                            .and_then(|v| v.as_f64());

                        return Ok(ExplainPlan {
                            root,
                            planning_time_ms,
                            execution_time_ms: None,
                            original_query: query.to_string(),
                            driver: "mysql".to_string(),
                            has_analyze_data: has_analyze,
                            raw_output: Some(raw_json),
                        });
                    }
                }
            }
        }
    }

    // EXPLAIN FORMAT=JSON — MySQL 5.6+ / MariaDB 10.1+
    if caps.supports_json_format {
        let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
        let json_sql = format!("EXPLAIN FORMAT=JSON {}", query);
        let json_result: Result<String, String> = async {
            let row = sqlx::query(&json_sql)
                .fetch_one(&mut *conn)
                .await
                .map_err(|e| e.to_string())?;
            row.try_get::<String, _>(0).map_err(|e| e.to_string())
        }
        .await;

        if let Ok(raw_json) = json_result {
            if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&raw_json) {
                if let Some(query_block) = json_val.get("query_block") {
                    let mut counter: u32 = 0;
                    let root = parse_mysql_query_block(query_block, &mut counter);
                    let has_analyze = has_analyze_data_recursive(&root);

                    return Ok(ExplainPlan {
                        root,
                        planning_time_ms: None,
                        execution_time_ms: None,
                        original_query: query.to_string(),
                        driver: "mysql".to_string(),
                        has_analyze_data: has_analyze,
                        raw_output: Some(raw_json),
                    });
                }
            }
        }
    }

    // Tabular fallback — works on all MySQL/MariaDB versions
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let explain_sql = format!("EXPLAIN {}", query);
    let rows = sqlx::query(&explain_sql)
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    let (root, raw) = parse_mysql_tabular_explain(&rows);
    Ok(ExplainPlan {
        root,
        planning_time_ms: None,
        execution_time_ms: None,
        original_query: query.to_string(),
        driver: "mysql".to_string(),
        has_analyze_data: false,
        raw_output: Some(raw),
    })
}

/// Parse the tabular output from plain `EXPLAIN` (for MySQL/MariaDB without FORMAT=JSON).
///
/// MySQL 5.5: id, select_type, table, type, possible_keys, key, key_len, ref, rows, Extra
/// MySQL 5.7+: id, select_type, table, partitions, type, possible_keys, key, key_len, ref, rows, filtered, Extra
///
/// Uses column-name lookup + `mysql_row_str` / `mysql_row_str_opt` to handle
/// MySQL versions that return VARBINARY instead of VARCHAR.
fn parse_mysql_tabular_explain(rows: &[sqlx::mysql::MySqlRow]) -> (ExplainNode, String) {
    let mut raw_lines = Vec::new();
    let mut children = Vec::new();

    /// Find a column index by name (case-insensitive).
    fn col_idx(row: &sqlx::mysql::MySqlRow, name: &str) -> Option<usize> {
        row.columns()
            .iter()
            .position(|c| c.name().eq_ignore_ascii_case(name))
    }

    for (i, row) in rows.iter().enumerate() {
        let select_type = col_idx(row, "select_type")
            .map(|idx| mysql_row_str(row, idx))
            .unwrap_or_default();
        let table = col_idx(row, "table")
            .and_then(|idx| mysql_row_str_opt(row, idx))
            .unwrap_or_default();
        let access_type = col_idx(row, "type")
            .and_then(|idx| mysql_row_str_opt(row, idx))
            .unwrap_or_default();
        let possible_keys =
            col_idx(row, "possible_keys").and_then(|idx| mysql_row_str_opt(row, idx));
        let key = col_idx(row, "key").and_then(|idx| mysql_row_str_opt(row, idx));
        let plan_rows: Option<i64> = col_idx(row, "rows").and_then(|idx| {
            row.try_get::<Option<i64>, _>(idx)
                .unwrap_or(None)
                .or_else(|| {
                    // Fallback: read as string and parse
                    mysql_row_str_opt(row, idx).and_then(|s| s.parse::<i64>().ok())
                })
        });
        let filtered: Option<f64> = col_idx(row, "filtered").and_then(|idx| {
            row.try_get::<Option<f64>, _>(idx)
                .unwrap_or(None)
                .or_else(|| mysql_row_str_opt(row, idx).and_then(|s| s.parse::<f64>().ok()))
        });
        let extra = col_idx(row, "Extra").and_then(|idx| mysql_row_str_opt(row, idx));

        let node_type = match access_type.as_str() {
            "ALL" => "Full Table Scan",
            "index" => "Index Scan",
            "range" => "Range Scan",
            "ref" => "Index Lookup",
            "eq_ref" => "Unique Index Lookup",
            "const" | "system" => "Const Lookup",
            "fulltext" => "Fulltext Search",
            "" => "Unknown",
            other => other,
        }
        .to_string();

        raw_lines.push(format!(
            "{}\t{}\t{}\t{}\t{}\t{}",
            select_type,
            table,
            access_type,
            key.as_deref().unwrap_or("-"),
            plan_rows.unwrap_or(0),
            extra.as_deref().unwrap_or("")
        ));

        let mut node_extra = std::collections::HashMap::new();
        if let Some(pk) = &possible_keys {
            node_extra.insert(
                "possible_keys".to_string(),
                serde_json::Value::String(pk.clone()),
            );
        }
        if let Some(f) = filtered {
            node_extra.insert(
                "filtered".to_string(),
                serde_json::Value::Number(
                    serde_json::Number::from_f64(f).unwrap_or(serde_json::Number::from(0)),
                ),
            );
        }
        if let Some(e) = &extra {
            node_extra.insert("extra".to_string(), serde_json::Value::String(e.clone()));
        }
        node_extra.insert(
            "select_type".to_string(),
            serde_json::Value::String(select_type),
        );

        children.push(ExplainNode {
            id: format!("node_{}", i + 1),
            node_type,
            relation: if table.is_empty() { None } else { Some(table) },
            startup_cost: None,
            total_cost: None,
            plan_rows: plan_rows.map(|r| r as f64),
            actual_rows: None,
            actual_time_ms: None,
            actual_loops: None,
            buffers_hit: None,
            buffers_read: None,
            filter: extra.clone(),
            index_condition: key,
            join_type: None,
            hash_condition: None,
            extra: node_extra,
            children: vec![],
        });
    }

    let root = ExplainNode {
        id: "node_0".to_string(),
        node_type: "Query".to_string(),
        relation: None,
        startup_cost: None,
        total_cost: None,
        plan_rows: None,
        actual_rows: None,
        actual_time_ms: None,
        actual_loops: None,
        buffers_hit: None,
        buffers_read: None,
        filter: None,
        index_condition: None,
        join_type: None,
        hash_condition: None,
        extra: std::collections::HashMap::new(),
        children,
    };

    (root, raw_lines.join("\n"))
}

/// Parse a JSON value that might be a string number or a numeric value.
fn parse_json_number(v: &serde_json::Value) -> Option<f64> {
    v.as_f64()
        .or_else(|| v.as_str().and_then(|s| s.parse::<f64>().ok()))
}

/// Parse a MariaDB `filesort` JSON object into an ExplainNode.
///
/// MariaDB ANALYZE FORMAT=JSON emits `"filesort": { sort_key, r_total_time_ms,
/// temporary_table | nested_loop, … }` as a nested object — unlike MySQL which
/// uses the boolean flag `"using_filesort": true`.
fn parse_mariadb_filesort(filesort: &serde_json::Value, counter: &mut u32) -> ExplainNode {
    let id = format!("node_{}", counter);
    *counter += 1;

    let actual_time_ms = filesort.get("r_total_time_ms").and_then(|v| v.as_f64());
    let actual_rows = filesort.get("r_output_rows").and_then(|v| v.as_f64());
    let actual_loops = filesort
        .get("r_loops")
        .and_then(|v| v.as_u64())
        .or_else(|| {
            filesort
                .get("r_loops")
                .and_then(|v| v.as_f64())
                .map(|f| f as u64)
        });

    let mut extra = std::collections::HashMap::new();
    for key in &["sort_key", "r_sort_mode", "r_buffer_size"] {
        if let Some(val) = filesort.get(*key) {
            extra.insert(key.to_string(), val.clone());
        }
    }

    // Also capture r_limit and r_used_priority_queue when present
    for key in &["r_limit", "r_used_priority_queue"] {
        if let Some(val) = filesort.get(*key) {
            extra.insert(key.to_string(), val.clone());
        }
    }

    let mut children = Vec::new();
    if let Some(tmp_tbl) = filesort.get("temporary_table") {
        children.push(parse_mariadb_temporary_table(tmp_tbl, counter));
    }
    if let Some(nested_loop) = filesort.get("nested_loop").and_then(|v| v.as_array()) {
        for item in nested_loop {
            children.push(parse_mysql_query_block(item, counter));
        }
    }
    if let Some(order_op) = filesort.get("ordering_operation") {
        children.push(parse_mysql_query_block(order_op, counter));
    }
    // MariaDB: filesort may contain a direct "table" (no nested_loop wrapper)
    if filesort.get("table").is_some()
        && filesort.get("nested_loop").is_none()
        && filesort.get("temporary_table").is_none()
    {
        children.push(parse_mysql_query_block(filesort, counter));
    }

    ExplainNode {
        id,
        node_type: "Filesort".to_string(),
        relation: None,
        startup_cost: None,
        total_cost: None,
        plan_rows: None,
        actual_rows,
        actual_time_ms,
        actual_loops,
        buffers_hit: None,
        buffers_read: None,
        filter: None,
        index_condition: None,
        join_type: None,
        hash_condition: None,
        extra,
        children,
    }
}

/// Parse a MariaDB `temporary_table` JSON wrapper into an ExplainNode.
///
/// MariaDB wraps `nested_loop` (and sometimes `filesort`) inside a
/// `"temporary_table": { … }` object when a temp table is materialised.
fn parse_mariadb_temporary_table(tmp_tbl: &serde_json::Value, counter: &mut u32) -> ExplainNode {
    let id = format!("node_{}", counter);
    *counter += 1;

    let mut children = Vec::new();
    if let Some(nested_loop) = tmp_tbl.get("nested_loop").and_then(|v| v.as_array()) {
        for item in nested_loop {
            children.push(parse_mysql_query_block(item, counter));
        }
    }
    if let Some(filesort) = tmp_tbl.get("filesort") {
        children.push(parse_mariadb_filesort(filesort, counter));
    }

    ExplainNode {
        id,
        node_type: "Temporary Table".to_string(),
        relation: None,
        startup_cost: None,
        total_cost: None,
        plan_rows: None,
        actual_rows: None,
        actual_time_ms: None,
        actual_loops: None,
        buffers_hit: None,
        buffers_read: None,
        filter: None,
        index_condition: None,
        join_type: None,
        hash_condition: None,
        extra: std::collections::HashMap::new(),
        children,
    }
}

/// Parse a MariaDB `subquery_cache` wrapper into an ExplainNode.
///
/// MariaDB wraps correlated/dependent subqueries in `"subquery_cache": {
/// r_loops, r_hit_ratio, query_block: { … } }` when the optimizer can
/// cache repeated evaluations. The `r_hit_ratio` (0–100) indicates how
/// often the cache was reused.
fn parse_mariadb_subquery_cache(cache: &serde_json::Value, counter: &mut u32) -> ExplainNode {
    let id = format!("node_{}", counter);
    *counter += 1;

    let actual_loops = cache.get("r_loops").and_then(|v| v.as_u64()).or_else(|| {
        cache
            .get("r_loops")
            .and_then(|v| v.as_f64())
            .map(|f| f as u64)
    });

    let mut extra = std::collections::HashMap::new();
    if let Some(hit) = cache.get("r_hit_ratio") {
        extra.insert("r_hit_ratio".to_string(), hit.clone());
    }

    let mut children = Vec::new();
    if let Some(qb) = cache.get("query_block") {
        children.push(parse_mysql_query_block(qb, counter));
    }

    ExplainNode {
        id,
        node_type: "Subquery Cache".to_string(),
        relation: None,
        startup_cost: None,
        total_cost: None,
        plan_rows: None,
        actual_rows: None,
        actual_time_ms: None,
        actual_loops,
        buffers_hit: None,
        buffers_read: None,
        filter: None,
        index_condition: None,
        join_type: None,
        hash_condition: None,
        extra,
        children,
    }
}

/// Generic parser for MariaDB wrapper nodes (materialized, union_result,
/// buffer_result, window_functions_computation, expression_cache,
/// read_sorted_file). These share a common pattern: an object that may
/// contain nested_loop, table, filesort, query_specifications, or other
/// recursive structures.
fn parse_mariadb_wrapper(obj: &serde_json::Value, label: &str, counter: &mut u32) -> ExplainNode {
    let id = format!("node_{}", counter);
    *counter += 1;

    let actual_time_ms = obj.get("r_total_time_ms").and_then(|v| v.as_f64());
    let actual_rows = obj
        .get("r_rows")
        .or_else(|| obj.get("r_output_rows"))
        .and_then(|v| v.as_f64());
    let actual_loops = obj.get("r_loops").and_then(|v| v.as_u64()).or_else(|| {
        obj.get("r_loops")
            .and_then(|v| v.as_f64())
            .map(|f| f as u64)
    });

    let mut children = Vec::new();

    // The wrapper may directly contain a table
    if obj.get("table").is_some() {
        children.push(parse_mysql_query_block(obj, counter));
    }

    if let Some(nl) = obj.get("nested_loop").and_then(|v| v.as_array()) {
        for item in nl {
            children.push(parse_mysql_query_block(item, counter));
        }
    }
    if let Some(fs) = obj.get("filesort") {
        if fs.is_object() {
            children.push(parse_mariadb_filesort(fs, counter));
        }
    }
    if let Some(tmp) = obj.get("temporary_table") {
        children.push(parse_mariadb_temporary_table(tmp, counter));
    }
    if let Some(qb) = obj.get("query_block") {
        children.push(parse_mysql_query_block(qb, counter));
    }
    if let Some(specs) = obj.get("query_specifications").and_then(|v| v.as_array()) {
        for spec in specs {
            children.push(parse_mysql_query_block(spec, counter));
        }
    }
    if let Some(order_op) = obj.get("ordering_operation") {
        children.push(parse_mysql_query_block(order_op, counter));
    }
    if let Some(group_op) = obj.get("grouping_operation") {
        children.push(parse_mysql_query_block(group_op, counter));
    }
    if let Some(subs) = obj.get("attached_subqueries").and_then(|v| v.as_array()) {
        for sq in subs {
            children.push(parse_mysql_query_block(sq, counter));
        }
    }

    ExplainNode {
        id,
        node_type: label.to_string(),
        relation: None,
        startup_cost: None,
        total_cost: obj.get("cost").and_then(parse_json_number),
        plan_rows: None,
        actual_rows,
        actual_time_ms,
        actual_loops,
        buffers_hit: None,
        buffers_read: None,
        filter: None,
        index_condition: None,
        join_type: None,
        hash_condition: None,
        extra: std::collections::HashMap::new(),
        children,
    }
}

pub(super) fn parse_mysql_query_block(block: &serde_json::Value, counter: &mut u32) -> ExplainNode {
    let id = format!("node_{}", counter);
    *counter += 1;

    // Determine node type from the query block structure
    let (node_type, relation, plan_rows, startup_cost, total_cost, filter) =
        if let Some(table) = block.get("table") {
            let access = table
                .get("access_type")
                .and_then(|v| v.as_str())
                .unwrap_or("ALL");
            let node_type = match access {
                "ALL" => "Full Table Scan",
                "index" => "Index Scan",
                "range" => "Range Scan",
                "ref" => "Index Lookup",
                "eq_ref" => "Unique Index Lookup",
                "const" | "system" => "Const Lookup",
                "fulltext" => "Fulltext Search",
                other => other,
            }
            .to_string();
            let rel = table
                .get("table_name")
                .and_then(|v| v.as_str())
                .map(String::from);

            // Rows: MySQL 8 uses rows_examined_per_scan, MariaDB uses rows
            let rows = table
                .get("rows_examined_per_scan")
                .and_then(|v| v.as_f64())
                .or_else(|| table.get("rows").and_then(|v| v.as_f64()));

            // Cost: MySQL 8 uses cost_info.prefix_cost / read_cost;
            // MariaDB puts "cost" directly on the table object.
            let cost_info = table.get("cost_info");
            let startup = cost_info
                .and_then(|c| c.get("read_cost"))
                .and_then(parse_json_number);
            let total = cost_info
                .and_then(|c| c.get("prefix_cost"))
                .and_then(parse_json_number)
                .or(startup)
                .or_else(|| table.get("cost").and_then(parse_json_number));

            let filt = table
                .get("attached_condition")
                .and_then(|v| v.as_str())
                .map(String::from);
            (node_type, rel, rows, startup, total, filt)
        } else {
            // Non-table node: detect operation type from child keys
            let node_type = if block
                .get("using_filesort")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                "Filesort".to_string()
            } else if block.get("grouping_operation").is_some() {
                "Group".to_string()
            } else if block.get("duplicates_removal").is_some() {
                "Duplicate Removal".to_string()
            } else if block.get("having_condition").is_some() {
                "Having Filter".to_string()
            } else if block.get("window_functions_computation").is_some() {
                "Window Functions".to_string()
            } else {
                "Query Block".to_string()
            };

            // Extract cost from block-level cost_info (MySQL) or direct "cost" (MariaDB)
            let cost_info = block.get("cost_info");
            let total = cost_info
                .and_then(|c| {
                    c.get("query_cost")
                        .or_else(|| c.get("sort_cost"))
                        .or_else(|| c.get("prefix_cost"))
                })
                .and_then(parse_json_number)
                .or_else(|| block.get("cost").and_then(parse_json_number));

            let filt = block
                .get("having_condition")
                .and_then(|v| v.as_str())
                .map(String::from);

            (node_type, None, None, None, total, filt)
        };

    // Collect extra fields from the table object
    let known_keys: &[&str] = &[
        "access_type",
        "table_name",
        "rows_examined_per_scan",
        "rows",
        "cost_info",
        "attached_condition",
        "key",
        "possible_keys",
        "used_key_parts",
    ];
    let mut extra = std::collections::HashMap::new();
    if let Some(table) = block.get("table").and_then(|t| t.as_object()) {
        for (k, v) in table {
            if !known_keys.contains(&k.as_str()) {
                extra.insert(k.clone(), v.clone());
            }
        }
    }
    if let Some(table) = block.get("table") {
        if let Some(key) = table.get("key").and_then(|v| v.as_str()) {
            extra.insert(
                "key".to_string(),
                serde_json::Value::String(key.to_string()),
            );
        }
    }

    // Parse children from nested_loop, ordering_operation, subqueries, etc.
    let mut children = Vec::new();

    if let Some(nested_loop) = block.get("nested_loop").and_then(|v| v.as_array()) {
        for item in nested_loop {
            if item.get("table").is_some() {
                children.push(parse_mysql_query_block(item, counter));
            } else if let Some(rsf) = item.get("read_sorted_file") {
                children.push(parse_mariadb_wrapper(rsf, "Read Sorted File", counter));
            } else if let Some(fs) = item.get("filesort") {
                if fs.is_object() {
                    children.push(parse_mariadb_filesort(fs, counter));
                }
            } else if let Some(tmp) = item.get("temporary_table") {
                children.push(parse_mariadb_temporary_table(tmp, counter));
            } else if let Some(mat) = item.get("materialized") {
                children.push(parse_mariadb_wrapper(mat, "Materialized Subquery", counter));
            } else if let Some(buf) = item.get("buffer_result") {
                children.push(parse_mariadb_wrapper(buf, "Buffer Result", counter));
            }
        }
    }

    if let Some(order_op) = block.get("ordering_operation") {
        children.push(parse_mysql_query_block(order_op, counter));
    }

    if let Some(group_op) = block.get("grouping_operation") {
        children.push(parse_mysql_query_block(group_op, counter));
    }

    if let Some(dup_op) = block.get("duplicates_removal") {
        children.push(parse_mysql_query_block(dup_op, counter));
    }

    if let Some(subqueries) = block
        .get("optimized_away_subqueries")
        .and_then(|v| v.as_array())
    {
        for sq in subqueries {
            children.push(parse_mysql_query_block(sq, counter));
        }
    }

    if let Some(attached) = block.get("attached_subqueries").and_then(|v| v.as_array()) {
        for sq in attached {
            children.push(parse_mysql_query_block(sq, counter));
        }
    }

    // MariaDB: "subqueries" array — each entry may be a subquery_cache wrapper
    // or a direct query_block.
    if let Some(subqueries) = block.get("subqueries").and_then(|v| v.as_array()) {
        for sq in subqueries {
            if let Some(cache) = sq.get("subquery_cache") {
                children.push(parse_mariadb_subquery_cache(cache, counter));
            } else if sq.get("query_block").is_some() || sq.get("table").is_some() {
                children.push(parse_mysql_query_block(sq, counter));
            }
        }
    }

    // MariaDB: filesort as nested object (not the boolean using_filesort flag)
    if let Some(filesort) = block.get("filesort") {
        if filesort.is_object() {
            children.push(parse_mariadb_filesort(filesort, counter));
        }
    }

    // MariaDB: temporary_table wrapper around nested_loop
    if let Some(tmp_tbl) = block.get("temporary_table") {
        children.push(parse_mariadb_temporary_table(tmp_tbl, counter));
    }

    // MariaDB: materialized subquery (e.g. IN (SELECT …) materialised as temp table)
    if let Some(mat) = block.get("materialized") {
        children.push(parse_mariadb_wrapper(mat, "Materialized Subquery", counter));
    }

    // MariaDB / MySQL: union_result — combines rows from UNION branches
    if let Some(union_res) = block.get("union_result") {
        children.push(parse_mariadb_wrapper(union_res, "Union Result", counter));
    }

    // MariaDB: buffer_result (SQL_BUFFER_RESULT hint)
    if let Some(buf) = block.get("buffer_result") {
        children.push(parse_mariadb_wrapper(buf, "Buffer Result", counter));
    }

    // MariaDB: window_functions_computation (window functions)
    if let Some(wf) = block.get("window_functions_computation") {
        children.push(parse_mariadb_wrapper(wf, "Window Functions", counter));
    }

    // MariaDB: expression_cache (cached subquery results)
    if let Some(ec) = block.get("expression_cache") {
        children.push(parse_mariadb_wrapper(ec, "Expression Cache", counter));
    }

    // MariaDB: read_sorted_file (after filesort writes to disk)
    if let Some(rsf) = block.get("read_sorted_file") {
        children.push(parse_mariadb_wrapper(rsf, "Read Sorted File", counter));
    }

    // MariaDB: query_specifications inside union_result
    if let Some(specs) = block.get("query_specifications").and_then(|v| v.as_array()) {
        for spec in specs {
            children.push(parse_mysql_query_block(spec, counter));
        }
    }

    let index_condition = block
        .get("table")
        .and_then(|t| t.get("key"))
        .and_then(|v| v.as_str())
        .map(String::from);

    // MariaDB ANALYZE data: r_total_time_ms, r_rows, r_loops.
    // Table objects may use r_table_time_ms + r_other_time_ms instead of
    // r_total_time_ms. Non-table nodes (query_block) carry these at block level.
    let table_obj = block.get("table");
    let actual_time_ms = table_obj
        .and_then(|t| t.get("r_total_time_ms"))
        .and_then(|v| v.as_f64())
        .or_else(|| {
            // MariaDB tables: r_table_time_ms + r_other_time_ms
            let tbl = table_obj?;
            let table_ms = tbl.get("r_table_time_ms").and_then(|v| v.as_f64());
            let other_ms = tbl.get("r_other_time_ms").and_then(|v| v.as_f64());
            match (table_ms, other_ms) {
                (Some(t), Some(o)) => Some(t + o),
                (Some(t), None) => Some(t),
                _ => None,
            }
        })
        // Fallback: block-level r_total_time_ms (non-table nodes)
        .or_else(|| block.get("r_total_time_ms").and_then(|v| v.as_f64()));
    let actual_rows = table_obj
        .and_then(|t| t.get("r_rows"))
        .and_then(|v| v.as_f64())
        .or_else(|| block.get("r_rows").and_then(|v| v.as_f64()));
    let actual_loops = table_obj
        .and_then(|t| t.get("r_loops"))
        .and_then(|v| v.as_u64())
        .or_else(|| {
            table_obj
                .and_then(|t| t.get("r_loops"))
                .and_then(|v| v.as_f64())
                .map(|f| f as u64)
        })
        // Fallback: block-level r_loops
        .or_else(|| block.get("r_loops").and_then(|v| v.as_u64()))
        .or_else(|| {
            block
                .get("r_loops")
                .and_then(|v| v.as_f64())
                .map(|f| f as u64)
        });

    ExplainNode {
        id,
        node_type,
        relation,
        startup_cost,
        total_cost,
        plan_rows,
        actual_rows,
        actual_time_ms,
        actual_loops,
        buffers_hit: None,
        buffers_read: None,
        filter,
        index_condition,
        join_type: None,
        hash_condition: None,
        extra,
        children,
    }
}

// ---------------------------------------------------------------------------
// EXPLAIN ANALYZE text parser (MySQL 8.0.18+)
// ---------------------------------------------------------------------------

struct AnalyzeParsedLine {
    depth: usize,
    node_type: String,
    relation: Option<String>,
    filter: Option<String>,
    index_condition: Option<String>,
    join_type: Option<String>,
    est_cost: Option<f64>,
    est_rows: Option<f64>,
    actual_time_ms: Option<f64>,
    actual_rows: Option<f64>,
    actual_loops: Option<u64>,
}

/// Check recursively whether any node in the tree has actual analyze data.
fn has_analyze_data_recursive(node: &ExplainNode) -> bool {
    if node.actual_rows.is_some() || node.actual_time_ms.is_some() {
        return true;
    }
    node.children.iter().any(has_analyze_data_recursive)
}

/// Parse MySQL EXPLAIN ANALYZE text output into a plan tree.
///
/// Each line looks like:
/// `    -> Table scan on t1  (cost=1.25 rows=10) (actual time=0.045..0.145 rows=10 loops=1)`
fn parse_mysql_analyze_text(text: &str, counter: &mut u32) -> ExplainNode {
    let mut parsed_lines: Vec<AnalyzeParsedLine> = Vec::new();

    for line in text.lines() {
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            continue;
        }

        // Count leading spaces for depth (4 spaces = 1 level)
        let leading = trimmed.len() - trimmed.trim_start().len();
        let depth = leading / 4;

        let content = trimmed.trim_start();

        // Lines must start with "-> "
        let desc_rest = match content.strip_prefix("-> ") {
            Some(r) => r,
            None => continue,
        };

        // Description ends at double-space-paren "  ("
        let desc_end = desc_rest.find("  (").unwrap_or(desc_rest.len());
        let description = &desc_rest[..desc_end];
        let metrics = &desc_rest[desc_end..];

        let (est_cost, est_rows) = parse_analyze_estimated(metrics);
        let (actual_time_ms, actual_rows, actual_loops) = parse_analyze_actual(metrics);
        let (node_type, relation, filter, index_condition, join_type) =
            map_analyze_description(description);

        parsed_lines.push(AnalyzeParsedLine {
            depth,
            node_type,
            relation,
            filter,
            index_condition,
            join_type,
            est_cost,
            est_rows,
            actual_time_ms,
            actual_rows,
            actual_loops,
        });
    }

    if parsed_lines.is_empty() {
        let id = format!("node_{}", counter);
        *counter += 1;
        return ExplainNode {
            id,
            node_type: "Query".to_string(),
            relation: None,
            startup_cost: None,
            total_cost: None,
            plan_rows: None,
            actual_rows: None,
            actual_time_ms: None,
            actual_loops: None,
            buffers_hit: None,
            buffers_read: None,
            filter: None,
            index_condition: None,
            join_type: None,
            hash_condition: None,
            extra: std::collections::HashMap::new(),
            children: vec![],
        };
    }

    let (mut roots, _) = build_analyze_tree(&parsed_lines, 0, -1, counter);
    if roots.len() == 1 {
        roots.remove(0)
    } else {
        // Multiple roots — wrap in a Query node
        let id = format!("node_{}", counter);
        *counter += 1;
        ExplainNode {
            id,
            node_type: "Query".to_string(),
            relation: None,
            startup_cost: None,
            total_cost: None,
            plan_rows: None,
            actual_rows: None,
            actual_time_ms: None,
            actual_loops: None,
            buffers_hit: None,
            buffers_read: None,
            filter: None,
            index_condition: None,
            join_type: None,
            hash_condition: None,
            extra: std::collections::HashMap::new(),
            children: roots,
        }
    }
}

/// Recursively build a tree from parsed lines using indentation depth.
fn build_analyze_tree(
    lines: &[AnalyzeParsedLine],
    start: usize,
    parent_depth: i32,
    counter: &mut u32,
) -> (Vec<ExplainNode>, usize) {
    let mut children = Vec::new();
    let mut i = start;

    while i < lines.len() {
        let depth = lines[i].depth as i32;
        if depth <= parent_depth {
            break;
        }

        let id = format!("node_{}", counter);
        *counter += 1;

        let (grandchildren, next_i) = build_analyze_tree(lines, i + 1, depth, counter);

        children.push(ExplainNode {
            id,
            node_type: lines[i].node_type.clone(),
            relation: lines[i].relation.clone(),
            startup_cost: None,
            total_cost: lines[i].est_cost,
            plan_rows: lines[i].est_rows,
            actual_rows: lines[i].actual_rows,
            actual_time_ms: lines[i].actual_time_ms,
            actual_loops: lines[i].actual_loops,
            buffers_hit: None,
            buffers_read: None,
            filter: lines[i].filter.clone(),
            index_condition: lines[i].index_condition.clone(),
            join_type: lines[i].join_type.clone(),
            hash_condition: None,
            extra: std::collections::HashMap::new(),
            children: grandchildren,
        });

        i = next_i;
    }

    (children, i)
}

/// Extract estimated cost and rows from "(cost=X rows=Y)" section.
fn parse_analyze_estimated(s: &str) -> (Option<f64>, Option<f64>) {
    // Find "(cost=" that is NOT inside "(actual"
    let idx = match s.find("(cost=") {
        Some(i) => i,
        None => return (None, None),
    };
    let section = &s[idx..];
    let end = match section.find(')') {
        Some(e) => e,
        None => return (None, None),
    };
    let inner = &section[1..end]; // "cost=X rows=Y"
    let mut cost = None;
    let mut rows = None;
    for part in inner.split_whitespace() {
        if let Some(val) = part.strip_prefix("cost=") {
            cost = val.parse().ok();
        } else if let Some(val) = part.strip_prefix("rows=") {
            rows = val.parse().ok();
        }
    }
    (cost, rows)
}

/// Extract actual time, rows, loops from "(actual time=X..Y rows=Z loops=W)" section.
fn parse_analyze_actual(s: &str) -> (Option<f64>, Option<f64>, Option<u64>) {
    let idx = match s.find("(actual time=") {
        Some(i) => i,
        None => return (None, None, None),
    };
    let section = &s[idx..];
    let end = match section.find(')') {
        Some(e) => e,
        None => return (None, None, None),
    };
    let inner = &section[1..end]; // "actual time=X..Y rows=Z loops=W"
    let mut time_ms = None;
    let mut rows = None;
    let mut loops = None;
    for part in inner.split_whitespace() {
        if let Some(val) = part.strip_prefix("time=") {
            // Use end time (after "..") as total time
            if let Some(dot_pos) = val.find("..") {
                time_ms = val[dot_pos + 2..].parse().ok();
            } else {
                time_ms = val.parse().ok();
            }
        } else if let Some(val) = part.strip_prefix("rows=") {
            rows = val.parse().ok();
        } else if let Some(val) = part.strip_prefix("loops=") {
            loops = val.parse().ok();
        }
    }
    (time_ms, rows, loops)
}

/// Map an EXPLAIN ANALYZE description to (node_type, relation, filter, index_condition, join_type).
fn map_analyze_description(
    desc: &str,
) -> (
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
) {
    let lower = desc.to_lowercase();
    let relation = extract_on_relation(desc);
    let index_cond = extract_using_index(desc);

    let (node_type, filter, join_type) = if lower.starts_with("table scan") {
        ("Full Table Scan".into(), None, None)
    } else if lower.starts_with("covering index scan") {
        ("Index Only Scan".into(), None, None)
    } else if lower.starts_with("index range scan") || lower.starts_with("range scan") {
        ("Range Scan".into(), None, None)
    } else if lower.starts_with("index scan") {
        ("Index Scan".into(), None, None)
    } else if lower.starts_with("single-row index lookup") {
        ("Unique Index Lookup".into(), None, None)
    } else if lower.starts_with("index lookup") || lower.starts_with("multi-range index lookup") {
        ("Index Lookup".into(), None, None)
    } else if lower.starts_with("constant row") {
        ("Const Lookup".into(), None, None)
    } else if lower.starts_with("nested loop") {
        let jt = if lower.contains("inner") {
            Some("Inner".into())
        } else if lower.contains("left") {
            Some("Left".into())
        } else if lower.contains("semijoin") {
            Some("Semi".into())
        } else if lower.contains("antijoin") || lower.contains("anti") {
            Some("Anti".into())
        } else {
            None
        };
        ("Nested Loop".into(), None, jt)
    } else if lower.contains("hash join") {
        let jt = if lower.contains("left") {
            Some("Left".into())
        } else {
            Some("Inner".into())
        };
        ("Hash Join".into(), None, jt)
    } else if lower.starts_with("filter:") {
        let filt = desc
            .get(7..)
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        ("Filter".into(), filt, None)
    } else if lower.starts_with("sort:") || lower.starts_with("sort row") {
        ("Sort".into(), None, None)
    } else if lower.starts_with("limit:") || lower.starts_with("limit ") {
        ("Limit".into(), None, None)
    } else if lower.starts_with("group aggregate") || lower.starts_with("aggregate") {
        ("Aggregate".into(), None, None)
    } else if lower.starts_with("temporary table") || lower.starts_with("materialize") {
        ("Materialize".into(), None, None)
    } else if lower.starts_with("stream results") || lower.starts_with("stream") {
        ("Stream".into(), None, None)
    } else if lower.starts_with("window aggregate") || lower.starts_with("window") {
        ("Window".into(), None, None)
    } else {
        (desc.to_string(), None, None)
    };

    (node_type, relation, filter, index_cond, join_type)
}

/// Extract table/relation name from "... on <table> ..." pattern.
fn extract_on_relation(desc: &str) -> Option<String> {
    let pos = desc.find(" on ")?;
    let after = &desc[pos + 4..];
    let end = after
        .find(|c: char| c == ' ' || c == '(')
        .unwrap_or(after.len());
    let name = after[..end].trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

/// Extract index name from "... using <index> ..." pattern.
fn extract_using_index(desc: &str) -> Option<String> {
    let lower = desc.to_lowercase();
    let pos = lower.find(" using ")?;
    let after = &desc[pos + 7..];
    let end = after
        .find(|c: char| c == ' ' || c == '(')
        .unwrap_or(after.len());
    let name = after[..end].trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}
