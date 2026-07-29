//! Runs `EXPLAIN QUERY PLAN` against SQLite and hands the decoded
//! `(id, parent, detail)` triples to the frontend as a JSON array, where
//! `@tabularis/explain` builds the plan tree.

use crate::models::{ConnectionParams, ExplainQueryOutput, RawExplainOutput};
use crate::pool_manager::get_sqlite_pool;
use sqlx::Row;

pub async fn explain_query(
    params: &ConnectionParams,
    query: &str,
) -> Result<ExplainQueryOutput, String> {
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

    let entries: Vec<serde_json::Value> = rows
        .iter()
        .map(|row| {
            let id: i32 = row.try_get("id").unwrap_or(0);
            let parent: i32 = row.try_get("parent").unwrap_or(0);
            let detail: String = row.try_get("detail").unwrap_or_default();
            serde_json::json!({ "id": id, "parent": parent, "detail": detail })
        })
        .collect();

    let payload = serde_json::to_string(&entries)
        .map_err(|e| format!("Failed to serialise EXPLAIN QUERY PLAN rows: {e}"))?;

    Ok(ExplainQueryOutput::Raw {
        raw: RawExplainOutput {
            engine: "sqlite".to_string(),
            format: "sqlite-eqp-rows".to_string(),
            payload,
            original_query: query.to_string(),
        },
    })
}
