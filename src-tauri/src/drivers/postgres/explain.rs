use super::client::{format_pg_error, query_all};
use super::helpers::escape_identifier;
use crate::models::{ConnectionParams, ExplainNode, ExplainPlan};
use crate::pool_manager::get_postgres_pool;
pub async fn explain_query(
    params: &ConnectionParams,
    query: &str,
    analyze: bool,
    schema: Option<&str>,
) -> Result<ExplainPlan, String> {
    let pool = get_postgres_pool(params).await?;

    if let Some(s) = schema {
        let search_path = format!("SET search_path TO \"{}\"", escape_identifier(s));
        query_all(&pool, &search_path, &[]).await?;
    }

    let explain_sql = if analyze {
        format!("EXPLAIN (FORMAT JSON, ANALYZE, BUFFERS) {}", query)
    } else {
        format!("EXPLAIN (FORMAT JSON) {}", query)
    };

    let rows = query_all(&pool, &explain_sql, &[]).await?;

    if rows.is_empty() {
        return Err("EXPLAIN returned no output".into());
    }

    // PostgreSQL returns a single row with a single text column containing JSON
    let plan_json_str: String = rows[0].try_get(0).map_err(|e| format_pg_error(&e))?;
    let raw_output = plan_json_str.clone();

    let plan_json: serde_json::Value = serde_json::from_str(&plan_json_str)
        .map_err(|e| format!("Failed to parse EXPLAIN JSON: {}", e))?;

    let plan_array = plan_json.as_array().ok_or("EXPLAIN JSON is not an array")?;

    if plan_array.is_empty() {
        return Err("EXPLAIN JSON array is empty".into());
    }

    let top = &plan_array[0];
    let plan_obj = top.get("Plan").ok_or("EXPLAIN JSON missing 'Plan' key")?;

    let mut counter: u32 = 0;
    let root = parse_pg_plan_node(plan_obj, &mut counter);

    let planning_time_ms = top.get("Planning Time").and_then(|v| v.as_f64());
    let execution_time_ms = top.get("Execution Time").and_then(|v| v.as_f64());

    let has_analyze_data = root.actual_rows.is_some() || root.actual_time_ms.is_some();

    Ok(ExplainPlan {
        root,
        planning_time_ms,
        execution_time_ms,
        original_query: query.to_string(),
        driver: "postgres".to_string(),
        has_analyze_data,
        raw_output: Some(raw_output),
    })
}

fn parse_pg_plan_node(node: &serde_json::Value, counter: &mut u32) -> ExplainNode {
    let id = format!("node_{}", counter);
    *counter += 1;

    let obj = node.as_object();

    let node_type = node
        .get("Node Type")
        .and_then(|v| v.as_str())
        .unwrap_or("Unknown")
        .to_string();

    let relation = node
        .get("Relation Name")
        .and_then(|v| v.as_str())
        .map(String::from);
    let startup_cost = node.get("Startup Cost").and_then(|v| v.as_f64());
    let total_cost = node.get("Total Cost").and_then(|v| v.as_f64());
    let plan_rows = node.get("Plan Rows").and_then(|v| v.as_f64());
    let actual_rows = node.get("Actual Rows").and_then(|v| v.as_f64());
    let actual_time_ms = node.get("Actual Total Time").and_then(|v| v.as_f64());
    let actual_loops = node.get("Actual Loops").and_then(|v| v.as_u64());
    let buffers_hit = node.get("Shared Hit Blocks").and_then(|v| v.as_u64());
    let buffers_read = node.get("Shared Read Blocks").and_then(|v| v.as_u64());
    let filter = node
        .get("Filter")
        .and_then(|v| v.as_str())
        .map(String::from);
    let index_condition = node
        .get("Index Cond")
        .and_then(|v| v.as_str())
        .map(String::from);
    let join_type = node
        .get("Join Type")
        .and_then(|v| v.as_str())
        .map(String::from);
    let hash_condition = node
        .get("Hash Cond")
        .and_then(|v| v.as_str())
        .map(String::from);

    // Collect all fields not explicitly mapped into `extra`
    let known_keys: &[&str] = &[
        "Node Type",
        "Relation Name",
        "Startup Cost",
        "Total Cost",
        "Plan Rows",
        "Actual Rows",
        "Actual Total Time",
        "Actual Loops",
        "Shared Hit Blocks",
        "Shared Read Blocks",
        "Filter",
        "Index Cond",
        "Join Type",
        "Hash Cond",
        "Plans",
    ];
    let mut extra = std::collections::HashMap::new();
    if let Some(map) = obj {
        for (k, v) in map {
            if !known_keys.contains(&k.as_str()) {
                extra.insert(k.clone(), v.clone());
            }
        }
    }

    let children = node
        .get("Plans")
        .and_then(|v| v.as_array())
        .map(|plans| {
            plans
                .iter()
                .map(|child| parse_pg_plan_node(child, counter))
                .collect()
        })
        .unwrap_or_default();

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
        buffers_hit,
        buffers_read,
        filter,
        index_condition,
        join_type,
        hash_condition,
        extra,
        children,
    }
}
