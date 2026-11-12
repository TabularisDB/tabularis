//! "Preview changes" for a reviewed subset of PostgreSQL `UPDATE` and
//! `DELETE` statements (issue #1404), shared by the desktop and web
//! transports.
//!
//! The statement is parsed by a strict allowlist grammar (`statement.rs`)
//! and rewritten into a `SELECT` (`render.rs`). Only that `SELECT` is sent to
//! the server, inside the driver's read-only transaction, which is rolled
//! back. The read-only transaction is a second guard: anything the grammar
//! does not model is rejected before any SQL is sent.

mod render;
mod statement;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::drivers::driver_trait::{DatabaseDriver, SqlDialect};
use crate::models::{ConnectionParams, QueryResult};
use crate::runtime::RuntimeContext;

pub use statement::Rejection;

pub const DEFAULT_LIMIT: u32 = 100;
pub const MAX_LIMIT: u32 = 1_000;
const MAX_SQL_LEN: usize = 100_000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DmlPreviewRequest {
    pub connection_id: String,
    /// The statement as the editor would run it, with editor parameters
    /// already filled in.
    pub sql: String,
    #[serde(default)]
    pub schema: Option<String>,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DmlKind {
    Update,
    Delete,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DmlPreview {
    pub kind: DmlKind,
    /// The target as written, quoted: `"public"."orders"`.
    pub target: String,
    /// Echoed so the UI can tell when the editor text, the connection or the
    /// schema no longer match this preview.
    pub source_sql: String,
    pub connection_id: String,
    pub schema: Option<String>,
    pub database: Option<String>,
    /// The `SELECT` that produced `result`, shown to the user.
    pub preview_sql: String,
    /// For an `UPDATE`, result columns `2i` and `2i + 1` hold the current and
    /// proposed value of `assigned_columns[i]`.
    pub assigned_columns: Vec<String>,
    /// False when the statement has no `WHERE` clause.
    pub has_filter: bool,
    pub limit: u32,
    /// More than `limit` rows matched; only the first `limit` are returned.
    pub truncated: bool,
    /// User triggers and rules on the target. They run on execution, not in
    /// the preview, so the final effect can differ.
    pub triggers: u64,
    pub rules: u64,
    pub result: QueryResult,
}

pub async fn preview(
    runtime: &RuntimeContext,
    session_id: Option<Uuid>,
    request: DmlPreviewRequest,
) -> Result<DmlPreview, String> {
    if request.sql.trim().is_empty() || request.sql.len() > MAX_SQL_LEN {
        return Err(Rejection::Empty.to_string());
    }
    let (driver, params) = super::queries::driver_and_params(
        runtime,
        session_id,
        &request.connection_id,
        request.database.clone(),
    )
    .await?;
    preview_with_driver(driver.as_ref(), &params, request).await
}

pub(crate) async fn preview_with_driver(
    driver: &dyn DatabaseDriver,
    params: &ConnectionParams,
    request: DmlPreviewRequest,
) -> Result<DmlPreview, String> {
    if request.sql.trim().is_empty() || request.sql.len() > MAX_SQL_LEN {
        return Err(Rejection::Empty.to_string());
    }
    let capabilities = &driver.manifest().capabilities;
    if capabilities.sql_dialect != Some(SqlDialect::Postgres) {
        return Err("Preview changes is available for PostgreSQL connections only.".into());
    }
    super::read_only::validate_support(params, capabilities)?;

    let sql = super::queries::sanitize_user_query(&request.sql);
    let parsed = statement::parse(&sql).map_err(|e| e.to_string())?;
    let limit = request.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let query = render::build(&parsed, limit).map_err(|e| e.to_string())?;
    let target = render::target_name(parsed.target());
    let schema = request.schema.as_deref();

    let facts = target_facts(driver, params, &target, schema).await?;
    let mut result = driver
        .execute_read_only_query(params, &query.sql, None, 1, schema)
        .await?;
    let truncated = result.rows.len() > limit as usize;
    result.rows.truncate(limit as usize);
    result.truncated = truncated;

    Ok(DmlPreview {
        kind: match parsed {
            statement::Statement::Update { .. } => DmlKind::Update,
            statement::Statement::Delete { .. } => DmlKind::Delete,
        },
        target,
        source_sql: request.sql,
        connection_id: request.connection_id,
        schema: request.schema,
        database: request.database,
        preview_sql: query.sql,
        assigned_columns: query.assigned_columns,
        has_filter: query.has_filter,
        limit,
        truncated,
        triggers: facts.triggers,
        rules: facts.rules,
        result,
    })
}

struct TargetFacts {
    triggers: u64,
    rules: u64,
}

/// Resolves the target the way the statement would and refuses anything but
/// a plain or partitioned table: selecting from a view or a foreign table
/// runs code the grammar never saw.
async fn target_facts(
    driver: &dyn DatabaseDriver,
    params: &ConnectionParams,
    target: &str,
    schema: Option<&str>,
) -> Result<TargetFacts, String> {
    let sql = render::target_facts_query(target);
    let result = driver
        .execute_read_only_query(params, &sql, None, 1, schema)
        .await?;
    let row = result
        .rows
        .first()
        .ok_or_else(|| format!("Table {target} was not found."))?;
    let relkind = row.first().and_then(|v| v.as_str()).unwrap_or_default();
    if !matches!(relkind, "r" | "p") {
        let what = match relkind {
            "v" => "a view",
            "m" => "a materialized view",
            "f" => "a foreign table",
            _ => "not a table",
        };
        return Err(format!("Preview works on tables only; {target} is {what}."));
    }
    Ok(TargetFacts {
        triggers: count(row.get(1)),
        rules: count(row.get(2)),
    })
}

fn count(value: Option<&serde_json::Value>) -> u64 {
    match value {
        Some(serde_json::Value::Number(n)) => n.as_u64().unwrap_or(0),
        Some(serde_json::Value::String(s)) => s.parse().unwrap_or(0),
        _ => 0,
    }
}

#[cfg(test)]
mod live;
#[cfg(test)]
mod tests;
