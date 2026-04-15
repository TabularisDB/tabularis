use crate::models::{ConnectionParams, ExplainNode, ExplainPlan};
use crate::pool_manager::get_sqlite_pool;
use sqlx::Row;

pub async fn explain_query(params: &ConnectionParams, query: &str) -> Result<ExplainPlan, String> {
    let pool = get_sqlite_pool(params).await?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    let explain_sql = format!("EXPLAIN QUERY PLAN {}", query);

    let rows = sqlx::query(&explain_sql)
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;

    if rows.is_empty() {
        return Err("EXPLAIN QUERY PLAN returned no output".into());
    }

    // Build raw output text
    let mut raw_lines = Vec::new();
    // Collect flat entries: (id, parent, detail)
    let mut entries: Vec<(i64, i64, String)> = Vec::new();

    for row in &rows {
        let id: i32 = row.try_get("id").unwrap_or(0);
        let parent: i32 = row.try_get("parent").unwrap_or(0);
        let detail: String = row.try_get("detail").unwrap_or_default();
        raw_lines.push(format!("{}|{}|{}", id, parent, &detail));
        entries.push((id as i64, parent as i64, detail));
    }

    let raw_output = raw_lines.join("\n");

    // Build tree from flat entries
    let mut counter: u32 = 0;
    let root = build_sqlite_tree(&entries, 0, &mut counter);

    Ok(ExplainPlan {
        root,
        planning_time_ms: None,
        execution_time_ms: None,
        original_query: query.to_string(),
        driver: "sqlite".to_string(),
        has_analyze_data: false,
        raw_output: Some(raw_output),
    })
}

pub(super) fn build_sqlite_tree(
    entries: &[(i64, i64, String)],
    parent_id: i64,
    counter: &mut u32,
) -> ExplainNode {
    // Find the first entry with the given parent_id to use as the root node
    let root_entry = entries.iter().find(|(id, parent, _)| {
        if parent_id == 0 {
            *parent == 0 && *id == 0
        } else {
            *id == parent_id
        }
    });

    let (node_type, relation, index_condition) = if let Some((_, _, detail)) = root_entry {
        parse_sqlite_detail(detail)
    } else {
        ("Query Plan".to_string(), None, None)
    };

    let id = format!("node_{}", counter);
    *counter += 1;

    // Find children: entries whose parent matches the root entry's id
    let root_id = root_entry.map(|(id, _, _)| *id).unwrap_or(0);
    let child_ids: Vec<i64> = entries
        .iter()
        .filter(|(_, parent, _)| {
            *parent == root_id && root_entry.map(|(id, _, _)| *id != root_id).unwrap_or(true)
                || (*parent == root_id && root_id == 0 && root_entry.is_some())
        })
        .filter(|(id, _, _)| *id != root_id)
        .map(|(id, _, _)| *id)
        .collect();

    let children: Vec<ExplainNode> = child_ids
        .iter()
        .map(|child_id| {
            let child_entry = entries.iter().find(|(id, _, _)| *id == *child_id);
            let (ct, cr, ci) = child_entry
                .map(|(_, _, detail)| parse_sqlite_detail(detail))
                .unwrap_or(("Unknown".to_string(), None, None));

            let child_node_id = format!("node_{}", counter);
            *counter += 1;

            // Recursively find grandchildren
            let grandchild_ids: Vec<i64> = entries
                .iter()
                .filter(|(_, parent, _)| *parent == *child_id)
                .map(|(id, _, _)| *id)
                .collect();

            let grandchildren: Vec<ExplainNode> = grandchild_ids
                .iter()
                .map(|gc_id| build_sqlite_tree(entries, *gc_id, counter))
                .collect();

            ExplainNode {
                id: child_node_id,
                node_type: ct,
                relation: cr,
                startup_cost: None,
                total_cost: None,
                plan_rows: None,
                actual_rows: None,
                actual_time_ms: None,
                actual_loops: None,
                buffers_hit: None,
                buffers_read: None,
                filter: None,
                index_condition: ci,
                join_type: None,
                hash_condition: None,
                extra: std::collections::HashMap::new(),
                children: grandchildren,
            }
        })
        .collect();

    ExplainNode {
        id,
        node_type,
        relation,
        startup_cost: None,
        total_cost: None,
        plan_rows: None,
        actual_rows: None,
        actual_time_ms: None,
        actual_loops: None,
        buffers_hit: None,
        buffers_read: None,
        filter: None,
        index_condition,
        join_type: None,
        hash_condition: None,
        extra: std::collections::HashMap::new(),
        children,
    }
}

pub(super) fn parse_sqlite_detail(detail: &str) -> (String, Option<String>, Option<String>) {
    let detail_upper = detail.to_uppercase();

    if detail_upper.starts_with("SCAN") {
        // "SCAN t1" or "SCAN t1 USING ..."
        let parts: Vec<&str> = detail.splitn(3, ' ').collect();
        let relation = parts.get(1).map(|s| s.to_string());
        let index = if detail_upper.contains("USING INDEX") {
            detail
                .find("USING INDEX")
                .map(|pos| detail[pos + 12..].trim().to_string())
        } else if detail_upper.contains("USING COVERING INDEX") {
            detail
                .find("USING COVERING INDEX")
                .map(|pos| detail[pos + 21..].trim().to_string())
        } else {
            None
        };
        ("Scan".to_string(), relation, index)
    } else if detail_upper.starts_with("SEARCH") {
        let parts: Vec<&str> = detail.splitn(3, ' ').collect();
        let relation = parts.get(1).map(|s| s.to_string());
        let index = if detail_upper.contains("USING INDEX") {
            detail
                .find("USING INDEX")
                .map(|pos| detail[pos + 12..].trim().to_string())
        } else if detail_upper.contains("USING INTEGER PRIMARY KEY") {
            Some("PRIMARY KEY".to_string())
        } else if detail_upper.contains("USING COVERING INDEX") {
            detail
                .find("USING COVERING INDEX")
                .map(|pos| detail[pos + 21..].trim().to_string())
        } else {
            None
        };
        ("Search".to_string(), relation, index)
    } else if detail_upper.contains("TEMP B-TREE") {
        ("Sort".to_string(), None, None)
    } else if detail_upper.starts_with("CO-ROUTINE") {
        ("Co-routine".to_string(), None, None)
    } else if detail_upper.starts_with("COMPOUND SUBQUERIES") {
        ("Compound Subquery".to_string(), None, None)
    } else if detail_upper.starts_with("MATERIALIZE") {
        ("Materialize".to_string(), None, None)
    } else {
        (detail.to_string(), None, None)
    }
}
