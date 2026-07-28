//! Runs `EXPLAIN` against MySQL / MariaDB and hands the raw output to the
//! frontend, where the parsers in `@tabularis/explain` build the plan tree.
//!
//! The fallback chain stays here because it needs the connection: which
//! variant a server accepts is discovered by running it. Each stage only
//! checks that its output is structurally sound (non-empty text, JSON with a
//! `query_block` key) — the same conditions that used to make the parsers
//! bail — before handing the payload over untouched.
//!
//! The tabular `EXPLAIN` form is decoded here too: it arrives as `sqlx` rows
//! rather than a serialisable payload, so the driver re-serialises the row
//! values as a JSON array for the `mysql-tabular-rows` format.

use super::helpers::{mysql_row_str, mysql_row_str_opt};
use crate::models::{ConnectionParams, ExplainQueryOutput, RawExplainOutput};
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

/// The structural check that used to live in the JSON parser: a plan document
/// must be valid JSON hanging its tree off a `query_block` key. Anything else
/// makes the chain fall through to the next EXPLAIN variant.
fn is_mysql_plan_json(raw: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(raw)
        .map(|v| v.get("query_block").is_some())
        .unwrap_or(false)
}

fn raw_output(format: &str, payload: String, query: &str) -> ExplainQueryOutput {
    ExplainQueryOutput::Raw {
        raw: RawExplainOutput {
            engine: "mysql".to_string(),
            format: format.to_string(),
            payload,
            original_query: query.to_string(),
        },
    }
}

pub async fn explain_query(
    params: &ConnectionParams,
    query: &str,
    analyze: bool,
    schema: Option<&str>,
) -> Result<ExplainQueryOutput, String> {
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

    // Behind a bastion that rejects prepared statements, EXPLAIN variants must
    // run over the text protocol (COM_QUERY) — see `super::force_text_protocol`.
    let text = super::force_text_protocol(params);

    // Detect server version to skip unsupported EXPLAIN variants
    let caps = {
        let mut vc = pool.acquire().await.map_err(|e| e.to_string())?;
        let ver_row = if text {
            use sqlx::Executor;
            (&mut *vc)
                .fetch_one(sqlx::raw_sql("SELECT VERSION()"))
                .await
        } else {
            sqlx::query("SELECT VERSION()").fetch_one(&mut *vc).await
        }
        .ok();
        let ver_str: String = ver_row.and_then(|r| r.try_get(0).ok()).unwrap_or_default();
        log::debug!("MySQL/MariaDB version: {}", ver_str);
        parse_mysql_version(&ver_str)
    };

    // EXPLAIN ANALYZE — MySQL 8.0.18+ text tree with estimated + actual data
    if analyze && caps.supports_explain_analyze {
        let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
        let analyze_sql = format!("EXPLAIN ANALYZE {}", query);
        let analyze_res = if text {
            use sqlx::Executor;
            (&mut *conn).fetch_all(sqlx::raw_sql(&analyze_sql)).await
        } else {
            sqlx::query(&analyze_sql).fetch_all(&mut *conn).await
        };
        if let Ok(rows) = analyze_res {
            let mut lines = Vec::new();
            for row in &rows {
                if let Ok(line) = row.try_get::<String, _>(0) {
                    lines.push(line);
                }
            }
            let payload = lines.join("\n");
            if !payload.trim().is_empty() {
                return Ok(raw_output("mysql-analyze-text", payload, query));
            }
        }
    }

    // ANALYZE FORMAT=JSON — MariaDB 10.1+ (executes the query and returns JSON
    // with both estimated and r_* actual fields)
    if analyze && caps.supports_analyze_format {
        let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
        let maria_sql = format!("ANALYZE FORMAT=JSON {}", query);
        let maria_res = if text {
            use sqlx::Executor;
            (&mut *conn).fetch_one(sqlx::raw_sql(&maria_sql)).await
        } else {
            sqlx::query(&maria_sql).fetch_one(&mut *conn).await
        };
        if let Ok(row) = maria_res {
            if let Ok(raw_json) = row.try_get::<String, _>(0) {
                // Falls through to plain FORMAT=JSON when malformed.
                if is_mysql_plan_json(&raw_json) {
                    return Ok(raw_output("mysql-json", raw_json, query));
                }
            }
        }
    }

    // EXPLAIN FORMAT=JSON — MySQL 5.6+ / MariaDB 10.1+
    if caps.supports_json_format {
        let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
        let json_sql = format!("EXPLAIN FORMAT=JSON {}", query);
        let json_result: Result<String, String> = async {
            let row = if text {
                use sqlx::Executor;
                (&mut *conn).fetch_one(sqlx::raw_sql(&json_sql)).await
            } else {
                sqlx::query(&json_sql).fetch_one(&mut *conn).await
            }
            .map_err(|e| e.to_string())?;
            row.try_get::<String, _>(0).map_err(|e| e.to_string())
        }
        .await;

        if let Ok(raw_json) = json_result {
            if is_mysql_plan_json(&raw_json) {
                return Ok(raw_output("mysql-json", raw_json, query));
            }
        }
    }

    // Tabular fallback — works on all MySQL/MariaDB versions
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    let explain_sql = format!("EXPLAIN {}", query);
    let rows = if text {
        use sqlx::Executor;
        (&mut *conn).fetch_all(sqlx::raw_sql(&explain_sql)).await
    } else {
        sqlx::query(&explain_sql).fetch_all(&mut *conn).await
    }
    .map_err(|e| e.to_string())?;

    let payload = serialize_mysql_tabular_rows(&rows)?;
    Ok(raw_output("mysql-tabular-rows", payload, query))
}

/// Serialise the decoded rows of plain `EXPLAIN` into the `mysql-tabular-rows`
/// JSON array consumed by `@tabularis/explain`.
///
/// MySQL 5.5: id, select_type, table, type, possible_keys, key, key_len, ref, rows, Extra
/// MySQL 5.7+: id, select_type, table, partitions, type, possible_keys, key, key_len, ref, rows, filtered, Extra
///
/// Uses column-name lookup + `mysql_row_str` / `mysql_row_str_opt` to handle
/// MySQL versions that return VARBINARY instead of VARCHAR.
fn serialize_mysql_tabular_rows(rows: &[sqlx::mysql::MySqlRow]) -> Result<String, String> {
    /// Find a column index by name (case-insensitive).
    fn col_idx(row: &sqlx::mysql::MySqlRow, name: &str) -> Option<usize> {
        row.columns()
            .iter()
            .position(|c| c.name().eq_ignore_ascii_case(name))
    }

    let mut entries = Vec::new();
    for row in rows {
        let select_type = col_idx(row, "select_type")
            .map(|idx| mysql_row_str(row, idx))
            .unwrap_or_default();
        let table = col_idx(row, "table").and_then(|idx| mysql_row_str_opt(row, idx));
        let access_type = col_idx(row, "type").and_then(|idx| mysql_row_str_opt(row, idx));
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

        entries.push(serde_json::json!({
            "select_type": select_type,
            "table": table,
            "access_type": access_type,
            "possible_keys": possible_keys,
            "key": key,
            "rows": plan_rows,
            "filtered": filtered,
            "extra": extra,
        }));
    }

    serde_json::to_string(&entries).map_err(|e| format!("Failed to serialise EXPLAIN rows: {e}"))
}
