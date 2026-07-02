pub mod export;
pub mod extract;
pub mod types;

mod explain;
mod helpers;
mod stmt_classify;

#[cfg(test)]
mod stmt_classify_tests;

#[cfg(test)]
mod tests;

use crate::drivers::common::parse_unsafe_bigint_string;
use crate::models::{
    ConnectionParams, ForeignKey, Index, Pagination, QueryResult, RoutineInfo, RoutineParameter,
    TableColumn, TableInfo, TriggerInfo, ViewInfo,
};
use crate::pool_manager::get_mysql_pool;
pub use explain::explain_query;
use extract::extract_value;
use helpers::{
    escape_identifier, inline_str_placeholders, is_raw_sql_function, is_wkt_geometry,
    mysql_bytes_literal, mysql_row_str, mysql_row_str_opt, mysql_string_literal,
};
use sqlx::{Column, Row};
use stmt_classify::is_text_protocol_stmt;

/// Whether this connection must avoid the prepared-statement protocol.
///
/// Bastions like Warpgate proxy MySQL but do **not** implement
/// `COM_STMT_PREPARE`; any `sqlx::query()` (which always prepares) fails with
/// server error 1047 ("Not implemented"). The cleartext auth plugin is only
/// ever enabled to authenticate through such a bastion, so we treat it as the
/// signal to route every statement through the text protocol (`COM_QUERY` via
/// `sqlx::raw_sql`) instead. See [`crate::pool_manager::build_mysql_options`].
pub(super) fn force_text_protocol(params: &ConnectionParams) -> bool {
    params.enable_cleartext_plugin.unwrap_or(false)
}

/// How a single operation must render statements on the wire.
///
/// Resolved once per public driver call via [`resolve_text_proto`]. In the
/// normal case values are bound through the prepared-statement protocol; behind
/// a bastion (`enabled`) they are inlined as escaped literals, whose escaping
/// must match the server's `sql_mode` (`no_backslash_escapes`).
#[derive(Clone, Copy)]
pub(super) struct TextProto {
    /// Inline values as literals instead of binding them.
    enabled: bool,
    /// Server runs with `NO_BACKSLASH_ESCAPES`, so string literals double the
    /// quote (`''`) instead of backslash-escaping it.
    no_backslash_escapes: bool,
}

impl TextProto {
    /// Prepared-statement mode: bind everything, never inline.
    const PREPARED: TextProto = TextProto {
        enabled: false,
        no_backslash_escapes: false,
    };

    /// Protocol selection only, for paths that run SQL verbatim and never
    /// inline literals — so the `sql_mode`-dependent escaping is irrelevant and
    /// no `@@sql_mode` roundtrip is needed.
    const fn protocol_only(enabled: bool) -> TextProto {
        TextProto {
            enabled,
            no_backslash_escapes: false,
        }
    }
}

/// Resolves how to render statements for one operation. When the text protocol
/// is forced (bastion path) the server's `sql_mode` is queried once so inlined
/// literals are escaped correctly; otherwise no extra roundtrip is made.
async fn resolve_text_proto(
    pool: &sqlx::MySqlPool,
    params: &ConnectionParams,
) -> Result<TextProto, String> {
    if force_text_protocol(params) {
        Ok(TextProto {
            enabled: true,
            no_backslash_escapes: server_no_backslash_escapes(pool).await?,
        })
    } else {
        Ok(TextProto::PREPARED)
    }
}

/// Reads `@@sql_mode` and reports whether `NO_BACKSLASH_ESCAPES` is in effect.
/// Issued over the text protocol because the bastion path can't prepare.
async fn server_no_backslash_escapes(pool: &sqlx::MySqlPool) -> Result<bool, String> {
    use sqlx::Executor;
    let row = pool
        .fetch_one(sqlx::raw_sql("SELECT @@sql_mode"))
        .await
        .map_err(|e| e.to_string())?;
    let mode = mysql_row_str(&row, 0);
    Ok(mode
        .split(',')
        .any(|m| m.trim().eq_ignore_ascii_case("NO_BACKSLASH_ESCAPES")))
}

/// Runs a `SELECT` and returns all rows, choosing the wire protocol from
/// `text`. In text mode the `?` placeholders are inlined as escaped string
/// literals (see [`inline_str_placeholders`]); otherwise they are bound
/// through the normal prepared-statement path. `binds` are always string
/// parameters — the only kind the introspection queries use.
async fn fetch_all_rows(
    pool: &sqlx::MySqlPool,
    text: TextProto,
    sql: &str,
    binds: &[&str],
) -> Result<Vec<sqlx::mysql::MySqlRow>, String> {
    use sqlx::Executor;
    if text.enabled {
        let rendered = inline_str_placeholders(sql, binds, text.no_backslash_escapes);
        pool.fetch_all(sqlx::raw_sql(&rendered))
            .await
            .map_err(|e| e.to_string())
    } else {
        let mut q = sqlx::query(sql);
        for b in binds {
            q = q.bind(*b);
        }
        pool.fetch_all(q).await.map_err(|e| e.to_string())
    }
}

/// `fetch_one` variant of [`fetch_all_rows`].
async fn fetch_one_row(
    pool: &sqlx::MySqlPool,
    text: TextProto,
    sql: &str,
    binds: &[&str],
) -> Result<sqlx::mysql::MySqlRow, String> {
    use sqlx::Executor;
    if text.enabled {
        let rendered = inline_str_placeholders(sql, binds, text.no_backslash_escapes);
        pool.fetch_one(sqlx::raw_sql(&rendered))
            .await
            .map_err(|e| e.to_string())
    } else {
        let mut q = sqlx::query(sql);
        for b in binds {
            q = q.bind(*b);
        }
        pool.fetch_one(q).await.map_err(|e| e.to_string())
    }
}

/// `fetch_optional` variant of [`fetch_all_rows`].
async fn fetch_optional_row(
    pool: &sqlx::MySqlPool,
    text: TextProto,
    sql: &str,
    binds: &[&str],
) -> Result<Option<sqlx::mysql::MySqlRow>, String> {
    use sqlx::Executor;
    if text.enabled {
        let rendered = inline_str_placeholders(sql, binds, text.no_backslash_escapes);
        pool.fetch_optional(sqlx::raw_sql(&rendered))
            .await
            .map_err(|e| e.to_string())
    } else {
        let mut q = sqlx::query(sql);
        for b in binds {
            q = q.bind(*b);
        }
        pool.fetch_optional(q).await.map_err(|e| e.to_string())
    }
}

/// Executes a statement that returns no result set (DDL), choosing the wire
/// protocol from `text`. Used for the bind-free `CREATE/ALTER/DROP` helpers.
async fn exec_stmt(
    pool: &sqlx::MySqlPool,
    text: TextProto,
    sql: &str,
) -> Result<sqlx::mysql::MySqlQueryResult, String> {
    use sqlx::Executor;
    if text.enabled {
        pool.execute(sqlx::raw_sql(sql))
            .await
            .map_err(|e| e.to_string())
    } else {
        pool.execute(sqlx::query(sql))
            .await
            .map_err(|e| e.to_string())
    }
}

/// Appends a primary-key comparison value to a `QueryBuilder`, choosing between
/// the prepared-statement (`push_bind`) and text (`push` an inlined literal)
/// protocols based on `text`. Centralises the value rendering shared by
/// [`mysql_fetch_one_with_pk`], [`mysql_execute_with_pk`] and `update_record`'s
/// `WHERE` clause so the bastion (text) path stays consistent with the bound path.
fn push_pk_value(
    qb: &mut sqlx::QueryBuilder<'_, sqlx::MySql>,
    val: &serde_json::Value,
    text: TextProto,
) -> Result<(), String> {
    match val {
        serde_json::Value::Number(n) => {
            if text.enabled {
                qb.push(n.to_string());
            } else if n.is_i64() {
                qb.push_bind(n.as_i64());
            } else if n.is_f64() {
                qb.push_bind(n.as_f64());
            } else {
                qb.push_bind(n.to_string());
            }
        }
        serde_json::Value::String(s) => {
            if let Some(n) = parse_unsafe_bigint_string(s) {
                if text.enabled {
                    qb.push(n.to_string());
                } else {
                    qb.push_bind(n);
                }
            } else if text.enabled {
                qb.push(mysql_string_literal(s, text.no_backslash_escapes));
            } else {
                qb.push_bind(s.clone());
            }
        }
        _ => return Err("Unsupported PK type".into()),
    }
    Ok(())
}

pub async fn get_schemas(_params: &ConnectionParams) -> Result<Vec<String>, String> {
    Ok(vec![])
}

pub async fn get_databases(params: &ConnectionParams) -> Result<Vec<String>, String> {
    let pool = get_mysql_pool(params).await?;
    let text = resolve_text_proto(&pool, params).await?;
    let rows = fetch_all_rows(&pool, text, "SHOW DATABASES", &[]).await?;
    Ok(rows.iter().map(|r| mysql_row_str(r, 0)).collect())
}

pub async fn get_tables(
    params: &ConnectionParams,
    schema: Option<&str>,
) -> Result<Vec<TableInfo>, String> {
    let db_name = schema.unwrap_or_else(|| params.database.primary());
    log::debug!("MySQL: Fetching tables for database: {}", db_name);
    let pool = get_mysql_pool(params).await?;
    let text = resolve_text_proto(&pool, params).await?;
    let rows = fetch_all_rows(
        &pool,
        text,
        "SELECT table_name as name FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE' ORDER BY table_name ASC",
        &[db_name],
    )
    .await?;
    let tables: Vec<TableInfo> = rows
        .iter()
        .map(|r| TableInfo {
            name: mysql_row_str(r, 0),
        })
        .collect();
    log::debug!("MySQL: Found {} tables in {}", tables.len(), db_name);
    Ok(tables)
}

pub async fn get_columns(
    params: &ConnectionParams,
    table_name: &str,
    schema: Option<&str>,
) -> Result<Vec<TableColumn>, String> {
    let db_name = schema.unwrap_or_else(|| params.database.primary());
    let pool = get_mysql_pool(params).await?;
    let text = resolve_text_proto(&pool, params).await?;

    let query = r#"
        SELECT column_name, data_type, column_key, is_nullable, extra, column_default, character_maximum_length
        FROM information_schema.columns
        WHERE table_schema = ? AND table_name = ?
        ORDER BY ordinal_position
    "#;

    let rows = fetch_all_rows(&pool, text, query, &[db_name, table_name]).await?;

    Ok(rows
        .iter()
        .map(|r| {
            let column_name = mysql_row_str(r, 0);
            let data_type = mysql_row_str(r, 1);
            let key = mysql_row_str(r, 2);
            let null_str = mysql_row_str(r, 3);
            let extra = mysql_row_str(r, 4);
            let default_val = mysql_row_str_opt(r, 5);
            let character_maximum_length: Option<u64> = r.try_get(6).ok();

            let is_auto_increment = extra.contains("auto_increment");

            let default_value = if !is_auto_increment {
                match default_val {
                    Some(val) if !val.is_empty() && !val.eq_ignore_ascii_case("null") => Some(val),
                    _ => None,
                }
            } else {
                None
            };

            TableColumn {
                name: column_name,
                data_type,
                is_pk: key == "PRI",
                is_nullable: null_str == "YES",
                is_auto_increment,
                default_value,
                character_maximum_length,
            }
        })
        .collect())
}

pub async fn get_foreign_keys(
    params: &ConnectionParams,
    table_name: &str,
    schema: Option<&str>,
) -> Result<Vec<ForeignKey>, String> {
    let db_name = schema.unwrap_or_else(|| params.database.primary());
    let pool = get_mysql_pool(params).await?;
    let text = resolve_text_proto(&pool, params).await?;

    let query = r#"
        SELECT
            kcu.CONSTRAINT_NAME,
            kcu.COLUMN_NAME,
            kcu.REFERENCED_TABLE_NAME,
            kcu.REFERENCED_COLUMN_NAME,
            rc.UPDATE_RULE,
            rc.DELETE_RULE
        FROM information_schema.KEY_COLUMN_USAGE kcu
        JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
        ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
        AND kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
        WHERE kcu.TABLE_SCHEMA = ?
        AND kcu.TABLE_NAME = ?
        AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
        ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION
    "#;

    let rows = fetch_all_rows(&pool, text, query, &[db_name, table_name]).await?;

    Ok(rows
        .iter()
        .map(|r| ForeignKey {
            name: mysql_row_str(r, 0),
            column_name: mysql_row_str(r, 1),
            ref_table: mysql_row_str(r, 2),
            ref_column: mysql_row_str(r, 3),
            on_update: mysql_row_str_opt(r, 4),
            on_delete: mysql_row_str_opt(r, 5),
        })
        .collect())
}

// Batch function: Get all columns for all tables in one query
pub async fn get_all_columns_batch(
    params: &ConnectionParams,
    schema: Option<&str>,
) -> Result<std::collections::HashMap<String, Vec<TableColumn>>, String> {
    use std::collections::HashMap;
    let db_name = schema.unwrap_or_else(|| params.database.primary());
    let pool = get_mysql_pool(params).await?;
    let text = resolve_text_proto(&pool, params).await?;

    let query = r#"
        SELECT table_name, column_name, data_type, column_key, is_nullable, extra, column_default, character_maximum_length
        FROM information_schema.columns
        WHERE table_schema = ?
        ORDER BY table_name, ordinal_position
    "#;

    let rows = fetch_all_rows(&pool, text, query, &[db_name]).await?;

    let mut result: HashMap<String, Vec<TableColumn>> = HashMap::new();

    for row in &rows {
        let table_name = mysql_row_str(row, 0);
        let column_name = mysql_row_str(row, 1);
        let data_type = mysql_row_str(row, 2);
        let key = mysql_row_str(row, 3);
        let null_str = mysql_row_str(row, 4);
        let extra = mysql_row_str(row, 5);
        let default_val = mysql_row_str_opt(row, 6);
        let character_maximum_length: Option<u64> = row.try_get(7).ok();

        let is_auto_increment = extra.contains("auto_increment");

        let default_value = if !is_auto_increment {
            match default_val {
                Some(val) if !val.is_empty() && !val.eq_ignore_ascii_case("null") => Some(val),
                _ => None,
            }
        } else {
            None
        };

        let column = TableColumn {
            name: column_name,
            data_type,
            is_pk: key == "PRI",
            is_nullable: null_str == "YES",
            is_auto_increment,
            default_value,
            character_maximum_length,
        };

        result
            .entry(table_name)
            .or_insert_with(Vec::new)
            .push(column);
    }

    Ok(result)
}

// Batch function: Get all foreign keys for all tables in one query
pub async fn get_all_foreign_keys_batch(
    params: &ConnectionParams,
    schema: Option<&str>,
) -> Result<std::collections::HashMap<String, Vec<ForeignKey>>, String> {
    use std::collections::HashMap;
    let db_name = schema.unwrap_or_else(|| params.database.primary());
    let pool = get_mysql_pool(params).await?;
    let text = resolve_text_proto(&pool, params).await?;

    let query = r#"
        SELECT
            kcu.TABLE_NAME,
            kcu.CONSTRAINT_NAME,
            kcu.COLUMN_NAME,
            kcu.REFERENCED_TABLE_NAME,
            kcu.REFERENCED_COLUMN_NAME,
            rc.UPDATE_RULE,
            rc.DELETE_RULE
        FROM information_schema.KEY_COLUMN_USAGE kcu
        JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
        ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
        AND kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
        WHERE kcu.TABLE_SCHEMA = ?
        AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
        ORDER BY kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION
    "#;

    let rows = fetch_all_rows(&pool, text, query, &[db_name]).await?;

    let mut result: HashMap<String, Vec<ForeignKey>> = HashMap::new();

    for row in &rows {
        let table_name = mysql_row_str(row, 0);

        let fk = ForeignKey {
            name: mysql_row_str(row, 1),
            column_name: mysql_row_str(row, 2),
            ref_table: mysql_row_str(row, 3),
            ref_column: mysql_row_str(row, 4),
            on_update: mysql_row_str_opt(row, 5),
            on_delete: mysql_row_str_opt(row, 6),
        };

        result.entry(table_name).or_insert_with(Vec::new).push(fk);
    }

    Ok(result)
}

pub async fn get_indexes(
    params: &ConnectionParams,
    table_name: &str,
    schema: Option<&str>,
) -> Result<Vec<Index>, String> {
    let db_name = schema.unwrap_or_else(|| params.database.primary());
    let pool = get_mysql_pool(params).await?;
    let text = resolve_text_proto(&pool, params).await?;

    let query = r#"
        SELECT
            INDEX_NAME,
            COLUMN_NAME,
            NON_UNIQUE,
            SEQ_IN_INDEX
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = ?
        ORDER BY INDEX_NAME, SEQ_IN_INDEX
    "#;

    let rows = fetch_all_rows(&pool, text, query, &[db_name, table_name]).await?;

    Ok(rows
        .iter()
        .map(|r| {
            let index_name = mysql_row_str(r, 0);
            let non_unique: i64 = r.try_get(2).unwrap_or(1);
            Index {
                name: index_name.clone(),
                column_name: mysql_row_str(r, 1),
                is_unique: non_unique == 0,
                is_primary: index_name == "PRIMARY",
                seq_in_index: r.try_get::<i64, _>(3).unwrap_or(0) as i32,
            }
        })
        .collect())
}

/// Sort the pk_map into a deterministic (col, val) vec for use with QueryBuilder.
fn build_mysql_pk_where(
    pk_map: &HashMap<String, serde_json::Value>,
) -> Result<Vec<(String, serde_json::Value)>, String> {
    if pk_map.is_empty() {
        return Err("pk_map must not be empty".into());
    }
    let mut pairs: Vec<(String, serde_json::Value)> = pk_map
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    pairs.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(pairs)
}


pub async fn save_blob_column_to_file(
    params: &ConnectionParams,
    table: &str,
    col_name: &str,
    pk_map: &HashMap<String, serde_json::Value>,
    file_path: &str,
) -> Result<(), String> {
    let row = mysql_fetch_one_with_pk(
        params,
        &format!(
            "SELECT `{}` FROM `{}`",
            escape_identifier(col_name),
            escape_identifier(table)
        ),
        pk_map,
    )
    .await?;
    let bytes: Vec<u8> = row.try_get(0).map_err(|e| e.to_string())?;
    std::fs::write(file_path, bytes).map_err(|e| e.to_string())
}

pub async fn fetch_blob_column_as_data_url(
    params: &ConnectionParams,
    table: &str,
    col_name: &str,
    pk_map: &HashMap<String, serde_json::Value>,
) -> Result<String, String> {
    let row = mysql_fetch_one_with_pk(
        params,
        &format!(
            "SELECT `{}` FROM `{}`",
            escape_identifier(col_name),
            escape_identifier(table)
        ),
        pk_map,
    )
    .await?;
    let bytes: Vec<u8> = row.try_get(0).map_err(|e| e.to_string())?;
    Ok(crate::drivers::common::encode_blob_full(&bytes))
}

/// Execute a SELECT query appending a WHERE clause built from pk_map and return the first row.
async fn mysql_fetch_one_with_pk(
    params: &ConnectionParams,
    select_from: &str,
    pk_map: &HashMap<String, serde_json::Value>,
) -> Result<sqlx::mysql::MySqlRow, String> {
    let pool = get_mysql_pool(params).await?;
    let text = resolve_text_proto(&pool, params).await?;
    let pairs = build_mysql_pk_where(pk_map)?;
    let mut first = true;
    let mut qb3 = sqlx::QueryBuilder::<sqlx::MySql>::new(format!("{} WHERE ", select_from));
    for (col, val) in &pairs {
        if !first {
            qb3.push(" AND ");
        }
        qb3.push(format!("`{}` = ", escape_identifier(col)));
        push_pk_value(&mut qb3, val, text)?;
        first = false;
    }
    if text.enabled {
        use sqlx::Executor;
        pool.fetch_one(sqlx::raw_sql(&qb3.into_sql()))
            .await
            .map_err(|e| e.to_string())
    } else {
        qb3.build().fetch_one(&pool).await.map_err(|e| e.to_string())
    }
}

/// Execute a DELETE/UPDATE query appending a WHERE clause from pk_map.
/// Returns the number of affected rows.
async fn mysql_execute_with_pk(
    params: &ConnectionParams,
    prefix: &str,
    pk_map: &HashMap<String, serde_json::Value>,
) -> Result<u64, String> {
    let pool = get_mysql_pool(params).await?;
    let text = resolve_text_proto(&pool, params).await?;
    let pairs = build_mysql_pk_where(pk_map)?;
    let mut qb = sqlx::QueryBuilder::<sqlx::MySql>::new(format!("{} WHERE ", prefix));
    let mut first = true;
    for (col, val) in &pairs {
        if !first {
            qb.push(" AND ");
        }
        qb.push(format!("`{}` = ", escape_identifier(col)));
        push_pk_value(&mut qb, val, text)?;
        first = false;
    }
    let result = if text.enabled {
        exec_stmt(&pool, text, &qb.into_sql()).await?
    } else {
        qb.build().execute(&pool).await.map_err(|e| e.to_string())?
    };
    Ok(result.rows_affected())
}

pub async fn delete_record(
    params: &ConnectionParams,
    table: &str,
    pk_map: &HashMap<String, serde_json::Value>,
) -> Result<u64, String> {
    mysql_execute_with_pk(
        params,
        &format!("DELETE FROM `{}`", escape_identifier(table)),
        pk_map,
    )
    .await
}

pub async fn update_record(
    params: &ConnectionParams,
    table: &str,
    pk_map: &HashMap<String, serde_json::Value>,
    col_name: &str,
    new_val: serde_json::Value,
    max_blob_size: u64,
) -> Result<u64, String> {
    let pool = get_mysql_pool(params).await?;
    // Behind a prepared-statement-less bastion every value is inlined as an
    // escaped literal instead of bound (see `force_text_protocol`).
    let text = resolve_text_proto(&pool, params).await?;
    let pk_pairs = build_mysql_pk_where(pk_map)?;

    let mut qb = sqlx::QueryBuilder::new(format!(
        "UPDATE `{}` SET `{}` = ",
        escape_identifier(table),
        escape_identifier(col_name)
    ));

    match new_val {
        serde_json::Value::Number(n) => {
            if n.is_i64() {
                if text.enabled {
                    qb.push(n.to_string());
                } else {
                    qb.push_bind(n.as_i64());
                }
            } else if text.enabled {
                qb.push(n.to_string());
            } else {
                qb.push_bind(n.as_f64());
            }
        }
        serde_json::Value::String(s) => {
            if s == "__USE_DEFAULT__" {
                qb.push("DEFAULT");
            } else if let Some(bytes) =
                crate::drivers::common::decode_blob_wire_format(&s, max_blob_size)
            {
                // Blob wire format: decode to raw bytes so the DB stores binary data,
                // not the internal wire format string.
                if text.enabled {
                    qb.push(mysql_bytes_literal(&bytes));
                } else {
                    qb.push_bind(bytes);
                }
            } else if is_raw_sql_function(&s) {
                qb.push(s);
            } else if is_wkt_geometry(&s) {
                qb.push("ST_GeomFromText(");
                if text.enabled {
                    qb.push(mysql_string_literal(&s, text.no_backslash_escapes));
                } else {
                    qb.push_bind(s);
                }
                qb.push(")");
            } else if let Some(n) = parse_unsafe_bigint_string(&s) {
                // Bigints outside JS safe range come back from the UI as strings
                // (see drivers::common::i64_to_json). Bind them as native i64 so
                // BIGINT columns receive the exact value.
                if text.enabled {
                    qb.push(n.to_string());
                } else {
                    qb.push_bind(n);
                }
            } else if text.enabled {
                qb.push(mysql_string_literal(&s, text.no_backslash_escapes));
            } else {
                qb.push_bind(s);
            }
        }
        serde_json::Value::Bool(b) => {
            if text.enabled {
                qb.push(if b { "1" } else { "0" });
            } else {
                qb.push_bind(b);
            }
        }
        serde_json::Value::Null => {
            qb.push("NULL");
        }
        serde_json::Value::Object(_) | serde_json::Value::Array(_) => {
            let json_str = serde_json::to_string(&new_val).map_err(|e| e.to_string())?;
            qb.push("CAST(");
            if text.enabled {
                qb.push(mysql_string_literal(&json_str, text.no_backslash_escapes));
            } else {
                qb.push_bind(json_str);
            }
            qb.push(" AS JSON)");
        }
    }

    qb.push(" WHERE ");
    let mut first = true;
    for (col, val) in &pk_pairs {
        if !first {
            qb.push(" AND ");
        }
        qb.push(format!("`{}` = ", escape_identifier(col)));
        push_pk_value(&mut qb, val, text)?;
        first = false;
    }

    let result = if text.enabled {
        exec_stmt(&pool, text, &qb.into_sql()).await?
    } else {
        qb.build().execute(&pool).await.map_err(|e| e.to_string())?
    };
    Ok(result.rows_affected())
}

pub async fn insert_record(
    params: &ConnectionParams,
    table: &str,
    data: std::collections::HashMap<String, serde_json::Value>,
    max_blob_size: u64,
) -> Result<u64, String> {
    let pool = get_mysql_pool(params).await?;
    // Behind a prepared-statement-less bastion every value is inlined as an
    // escaped literal instead of bound (see `force_text_protocol`).
    let text = resolve_text_proto(&pool, params).await?;

    let mut cols = Vec::new();
    let mut vals = Vec::new();

    for (k, v) in data {
        cols.push(format!("`{}`", k));
        vals.push(v);
    }

    // Allow empty inserts for auto-generated values (e.g., auto-increment PKs)
    let mut qb = if cols.is_empty() {
        sqlx::QueryBuilder::new(format!("INSERT INTO `{}` () VALUES ()", table))
    } else {
        let mut qb = sqlx::QueryBuilder::new(format!(
            "INSERT INTO `{}` ({}) VALUES (",
            table,
            cols.join(", ")
        ));

        let mut separated = qb.separated(", ");
        for val in vals {
            match val {
                serde_json::Value::Number(n) => {
                    if n.is_i64() {
                        if text.enabled {
                            separated.push(n.to_string());
                        } else {
                            separated.push_bind(n.as_i64());
                        }
                    } else if text.enabled {
                        separated.push(n.to_string());
                    } else {
                        separated.push_bind(n.as_f64());
                    }
                }
                serde_json::Value::String(s) => {
                    if let Some(bytes) =
                        crate::drivers::common::decode_blob_wire_format(&s, max_blob_size)
                    {
                        // Blob wire format: decode to raw bytes so the DB stores binary data,
                        // not the internal wire format string.
                        if text.enabled {
                            separated.push(mysql_bytes_literal(&bytes));
                        } else {
                            separated.push_bind(bytes);
                        }
                    } else if is_raw_sql_function(&s) {
                        // If it's a raw SQL function (e.g., ST_GeomFromText('POINT(1 2)', 4326))
                        // insert it directly without parameter binding
                        separated.push_unseparated(&s);
                    } else if is_wkt_geometry(&s) {
                        // If it's WKT geometry format, wrap with ST_GeomFromText
                        separated.push_unseparated("ST_GeomFromText(");
                        if text.enabled {
                            separated.push_unseparated(mysql_string_literal(
                                &s,
                                text.no_backslash_escapes,
                            ));
                        } else {
                            separated.push_bind_unseparated(s);
                        }
                        separated.push_unseparated(")");
                    } else if let Some(n) = parse_unsafe_bigint_string(&s) {
                        if text.enabled {
                            separated.push(n.to_string());
                        } else {
                            separated.push_bind(n);
                        }
                    } else if text.enabled {
                        separated.push(mysql_string_literal(&s, text.no_backslash_escapes));
                    } else {
                        separated.push_bind(s);
                    }
                }
                serde_json::Value::Bool(b) => {
                    if text.enabled {
                        separated.push(if b { "1" } else { "0" });
                    } else {
                        separated.push_bind(b);
                    }
                }
                serde_json::Value::Null => {
                    separated.push("NULL");
                }
                serde_json::Value::Object(_) | serde_json::Value::Array(_) => {
                    let json_str = serde_json::to_string(&val).map_err(|e| e.to_string())?;
                    separated.push_unseparated("CAST(");
                    if text.enabled {
                        separated.push_unseparated(mysql_string_literal(
                            &json_str,
                            text.no_backslash_escapes,
                        ));
                    } else {
                        separated.push_bind_unseparated(json_str);
                    }
                    separated.push_unseparated(" AS JSON)");
                }
            }
        }
        separated.push_unseparated(")");
        qb
    };

    let result = if text.enabled {
        exec_stmt(&pool, text, &qb.into_sql()).await?
    } else {
        qb.build().execute(&pool).await.map_err(|e| e.to_string())?
    };
    Ok(result.rows_affected())
}

pub async fn get_table_ddl(params: &ConnectionParams, table_name: &str) -> Result<String, String> {
    let pool = get_mysql_pool(params).await?;
    let text = resolve_text_proto(&pool, params).await?;
    let query = format!("SHOW CREATE TABLE `{}`", table_name);
    let row = fetch_one_row(&pool, text, &query, &[]).await?;

    let create_sql = mysql_row_str(&row, 1);
    Ok(format!("{};", create_sql))
}

pub async fn get_views(
    params: &ConnectionParams,
    schema: Option<&str>,
) -> Result<Vec<ViewInfo>, String> {
    let db_name = schema.unwrap_or_else(|| params.database.primary());
    log::debug!("MySQL: Fetching views for database: {}", db_name);
    let pool = get_mysql_pool(params).await?;
    let text = resolve_text_proto(&pool, params).await?;
    let rows = fetch_all_rows(
        &pool,
        text,
        "SELECT table_name as name FROM information_schema.views WHERE table_schema = ? ORDER BY table_name ASC",
        &[db_name],
    )
    .await?;
    let views: Vec<ViewInfo> = rows
        .iter()
        .map(|r| ViewInfo {
            name: mysql_row_str(r, 0),
            definition: None,
        })
        .collect();
    log::debug!("MySQL: Found {} views in {}", views.len(), db_name);
    Ok(views)
}

pub async fn get_view_definition(
    params: &ConnectionParams,
    view_name: &str,
) -> Result<String, String> {
    let pool = get_mysql_pool(params).await?;
    let text = resolve_text_proto(&pool, params).await?;
    let escaped_name = escape_identifier(view_name);
    let query = format!("SHOW CREATE VIEW `{}`", escaped_name);
    let row = fetch_one_row(&pool, text, &query, &[])
        .await
        .map_err(|e| format!("Failed to get view definition: {}", e))?;
    let definition = mysql_row_str(&row, 1);

    Ok(definition)
}

pub async fn create_view(
    params: &ConnectionParams,
    view_name: &str,
    definition: &str,
) -> Result<(), String> {
    let pool = get_mysql_pool(params).await?;
    let escaped_name = escape_identifier(view_name);
    let query = format!("CREATE VIEW `{}` AS {}", escaped_name, definition);
    sqlx::raw_sql(&query)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to create view: {}", e))?;
    Ok(())
}

pub async fn alter_view(
    params: &ConnectionParams,
    view_name: &str,
    definition: &str,
) -> Result<(), String> {
    let pool = get_mysql_pool(params).await?;
    let escaped_name = escape_identifier(view_name);
    let query = format!("ALTER VIEW `{}` AS {}", escaped_name, definition);
    // `ALTER VIEW` is not supported by MySQL's prepared-statement protocol
    // (server error 1295), so it must go through `raw_sql()` (text protocol)
    // rather than `sqlx::query()`. See `is_text_protocol_stmt` for context.
    sqlx::raw_sql(&query)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to alter view: {}", e))?;
    Ok(())
}

pub async fn drop_view(params: &ConnectionParams, view_name: &str) -> Result<(), String> {
    let pool = get_mysql_pool(params).await?;
    let escaped_name = escape_identifier(view_name);
    let query = format!("DROP VIEW IF EXISTS `{}`", escaped_name);
    // Routed through `raw_sql()` (text protocol) for consistency with
    // create/alter view, which the prepared-statement protocol rejects
    // with server error 1295.
    sqlx::raw_sql(&query)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to drop view: {}", e))?;
    Ok(())
}

pub async fn get_view_columns(
    params: &ConnectionParams,
    view_name: &str,
    schema: Option<&str>,
) -> Result<Vec<TableColumn>, String> {
    let db_name = schema.unwrap_or_else(|| params.database.primary());
    // Views in MySQL can be queried like tables for column info
    let pool = get_mysql_pool(params).await?;
    let text = resolve_text_proto(&pool, params).await?;

    let query = r#"
            SELECT column_name, data_type, column_key, is_nullable, extra, column_default, character_maximum_length
            FROM information_schema.columns
            WHERE table_schema = ? AND table_name = ?
            ORDER BY ordinal_position
        "#;

    let rows = fetch_all_rows(&pool, text, query, &[db_name, view_name]).await?;

    Ok(rows
        .iter()
        .map(|r| {
            let column_name = mysql_row_str(r, 0);
            let data_type = mysql_row_str(r, 1);
            let key = mysql_row_str(r, 2);
            let null_str = mysql_row_str(r, 3);
            let extra = mysql_row_str(r, 4);
            let default_val = mysql_row_str_opt(r, 5);
            let character_maximum_length: Option<u64> = r.try_get(6).ok();

            let is_auto_increment = extra.contains("auto_increment");

            let default_value = if !is_auto_increment {
                match default_val {
                    Some(val) if !val.is_empty() && !val.eq_ignore_ascii_case("null") => Some(val),
                    _ => None,
                }
            } else {
                None
            };

            TableColumn {
                name: column_name,
                data_type,
                is_pk: key == "PRI",
                is_nullable: null_str == "YES",
                is_auto_increment,
                default_value,
                character_maximum_length,
            }
        })
        .collect())
}

pub async fn get_routines(
    params: &ConnectionParams,
    schema: Option<&str>,
) -> Result<Vec<RoutineInfo>, String> {
    let db_name = schema.unwrap_or_else(|| params.database.primary());
    let pool = get_mysql_pool(params).await?;
    let text = resolve_text_proto(&pool, params).await?;
    let query = r#"
            SELECT routine_name, routine_type, routine_definition
            FROM information_schema.routines
            WHERE routine_schema = ?
            ORDER BY routine_name
        "#;

    let rows = fetch_all_rows(&pool, text, query, &[db_name]).await?;

    Ok(rows
        .iter()
        .map(|r| RoutineInfo {
            name: mysql_row_str(r, 0),
            routine_type: mysql_row_str(r, 1),
            definition: mysql_row_str_opt(r, 2),
        })
        .collect())
}

pub async fn get_routine_parameters(
    params: &ConnectionParams,
    routine_name: &str,
    schema: Option<&str>,
) -> Result<Vec<RoutineParameter>, String> {
    let db_name = schema.unwrap_or_else(|| params.database.primary());
    let pool = get_mysql_pool(params).await?;
    let text = resolve_text_proto(&pool, params).await?;

    // 1. Get return type for functions from routines table
    let return_type_query = r#"
            SELECT DATA_TYPE, ROUTINE_TYPE
            FROM information_schema.routines
            WHERE ROUTINE_SCHEMA = ? AND ROUTINE_NAME = ?
        "#;

    let routine_info =
        fetch_optional_row(&pool, text, return_type_query, &[db_name, routine_name]).await?;

    let mut parameters = Vec::new();

    if let Some(info) = routine_info {
        let data_type = mysql_row_str(&info, 0);
        let routine_type = mysql_row_str(&info, 1);
        if routine_type == "FUNCTION" {
            if !data_type.is_empty() {
                parameters.push(RoutineParameter {
                    name: "".to_string(), // Empty name for return value
                    data_type,
                    mode: "OUT".to_string(),
                    ordinal_position: 0,
                });
            }
        }
    }

    // 2. Get parameters
    let query = r#"
            SELECT parameter_name, data_type, parameter_mode, ordinal_position
            FROM information_schema.parameters
            WHERE specific_schema = ? AND specific_name = ?
            ORDER BY ordinal_position
        "#;

    let rows = fetch_all_rows(&pool, text, query, &[db_name, routine_name]).await?;

    parameters.extend(rows.iter().map(|r| RoutineParameter {
        name: mysql_row_str(r, 0),
        data_type: mysql_row_str(r, 1),
        mode: mysql_row_str(r, 2),
        ordinal_position: r.try_get(3).unwrap_or(0),
    }));

    Ok(parameters)
}

pub async fn get_routine_definition(
    params: &ConnectionParams,
    routine_name: &str,
    routine_type: &str,
) -> Result<String, String> {
    let pool = get_mysql_pool(params).await?;
    let text = resolve_text_proto(&pool, params).await?;
    let query = format!(
        "SHOW CREATE {} `{}`",
        routine_type,
        escape_identifier(routine_name)
    );

    let row = fetch_one_row(&pool, text, &query, &[]).await?;

    let definition = mysql_row_str(&row, 2);

    Ok(definition)
}

/// Acquires a single MySQL connection from the pool, honouring the optional
/// schema override (which routes to a per-database pool to avoid invalidating
/// the prepared-statement cache via `USE`).
async fn acquire_mysql_conn(
    params: &ConnectionParams,
    schema: Option<&str>,
) -> Result<sqlx::pool::PoolConnection<sqlx::MySql>, String> {
    let pool = if let Some(db) = schema {
        let mut p = params.clone();
        p.database = crate::models::DatabaseSelection::Single(db.to_string());
        get_mysql_pool(&p).await?
    } else {
        get_mysql_pool(params).await?
    };
    pool.acquire().await.map_err(|e| e.to_string())
}

/// Executes one statement on an already-acquired connection. Used by both
/// `execute_query` (one statement, one connection) and `execute_batch`
/// (many statements, one shared connection — required for session-local
/// state like `SET @var`, `LAST_INSERT_ID()`, transactions, temp tables).
async fn exec_on_mysql_conn(
    conn: &mut sqlx::MySqlConnection,
    query: &str,
    limit: Option<u32>,
    page: u32,
    text: TextProto,
) -> Result<QueryResult, String> {
    // Transaction-control statements have to bypass the prepared-statement
    // protocol — see `is_text_protocol_stmt`. They never return a result
    // set, so we can short-circuit with an empty `QueryResult`.
    if is_text_protocol_stmt(query) {
        use sqlx::Executor;
        let exec_result = conn
            .execute(sqlx::raw_sql(query))
            .await
            .map_err(|e| e.to_string())?;
        return Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            affected_rows: exec_result.rows_affected(),
            truncated: false,
            pagination: None,
        });
    }

    // Non-result-set statements (INSERT / UPDATE / DELETE / DDL) go through
    // `execute()` so we can return the actual `rows_affected`. In text mode
    // they must use `raw_sql` (COM_QUERY) since the bastion rejects prepares.
    if !crate::drivers::common::returns_result_set(query) {
        use sqlx::Executor;
        let exec_result = if text.enabled {
            conn.execute(sqlx::raw_sql(query)).await
        } else {
            conn.execute(sqlx::query(query)).await
        }
        .map_err(|e| e.to_string())?;
        return Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            affected_rows: exec_result.rows_affected(),
            truncated: false,
            pagination: None,
        });
    }

    let is_select = crate::drivers::common::is_select_query(query);
    let mut pagination: Option<Pagination> = None;
    let final_query: String;
    let mut manual_limit = limit;
    let mut truncated = false;

    if is_select && limit.is_some() {
        let l = limit.unwrap();

        final_query = crate::drivers::common::build_paginated_query(query, l, page);

        pagination = Some(Pagination {
            page,
            page_size: l,
            total_rows: None,
            has_more: false, // will be updated after streaming
        });

        manual_limit = None;
    } else {
        final_query = query.to_string();
    }

    let mut columns: Vec<String> = Vec::new();
    let mut json_rows = Vec::new();

    // Scope the stream so `conn` borrow is released before returning
    {
        use futures::stream::StreamExt;
        let mut rows_stream = if text.enabled {
            use sqlx::Executor;
            (&mut *conn).fetch(sqlx::raw_sql(&final_query))
        } else {
            sqlx::query(&final_query).fetch(&mut *conn)
        };

        while let Some(result) = rows_stream.next().await {
            match result {
                Ok(row) => {
                    // Initialize columns from the first row
                    if columns.is_empty() {
                        columns = row.columns().iter().map(|c| c.name().to_string()).collect();
                    }

                    // Check limit (only if manual_limit is set)
                    if let Some(l) = manual_limit {
                        if json_rows.len() >= l as usize {
                            truncated = true;
                            break;
                        }
                    }

                    // Map row using type extraction function
                    let mut json_row = Vec::new();
                    for (i, _) in row.columns().iter().enumerate() {
                        let val = extract_value(&row, i, None);
                        json_row.push(val);
                    }
                    json_rows.push(json_row);
                }
                Err(e) => return Err(e.to_string()),
            }
        }
    } // rows_stream dropped here — conn borrow released

    // Apply LIMIT +1 result: if we got page_size+1 rows, has_more=true
    if let Some(ref mut p) = pagination {
        let has_more = json_rows.len() > p.page_size as usize;
        if has_more {
            json_rows.truncate(p.page_size as usize);
        }
        p.has_more = has_more;
        truncated = has_more;
    }

    Ok(QueryResult {
        columns,
        rows: json_rows,
        affected_rows: 0,
        truncated,
        pagination,
    })
}

pub async fn execute_query(
    params: &ConnectionParams,
    query: &str,
    limit: Option<u32>,
    page: u32,
    schema: Option<&str>,
) -> Result<QueryResult, String> {
    let mut conn = acquire_mysql_conn(params, schema).await?;
    // `exec_on_mysql_conn` runs the user's SQL verbatim (no literal inlining),
    // so it only needs to know whether to use the text protocol.
    let text = TextProto::protocol_only(force_text_protocol(params));
    exec_on_mysql_conn(&mut *conn, query, limit, page, text).await
}

/// Runs a sequence of statements on a single pooled connection so that
/// session-local state (user variables, `LAST_INSERT_ID()`, transactions,
/// `TEMPORARY TABLE`, `PREPARE`/`EXECUTE`) is preserved across statements.
///
/// Statements run sequentially in input order. A failed statement is
/// reported in its `BatchStatementResult` slot but does NOT abort the batch
/// — later statements still run, mirroring MySQL CLI's `--force` behaviour.
/// When the script uses transactions, MySQL itself will refuse subsequent
/// statements inside the aborted transaction, surfacing the error.
pub async fn execute_batch(
    params: &ConnectionParams,
    queries: &[String],
    limit: Option<u32>,
    page: u32,
    schema: Option<&str>,
    on_progress: Option<&crate::drivers::driver_trait::BatchProgressFn>,
) -> Result<Vec<crate::models::BatchStatementResult>, String> {
    let mut conn = acquire_mysql_conn(params, schema).await?;
    // See `execute_query`: statements run verbatim, so only the protocol flag
    // is needed here, not the literal-escaping mode.
    let text = TextProto::protocol_only(force_text_protocol(params));
    let mut results = Vec::with_capacity(queries.len());
    for (idx, q) in queries.iter().enumerate() {
        let start = std::time::Instant::now();
        let outcome = exec_on_mysql_conn(&mut *conn, q, limit, page, text).await;
        let res = crate::models::BatchStatementResult::from_outcome(start, outcome);
        if let Some(cb) = on_progress {
            cb(idx, &res);
        }
        results.push(res);
    }
    Ok(results)
}

pub async fn get_triggers(
    params: &ConnectionParams,
    schema: Option<&str>,
) -> Result<Vec<TriggerInfo>, String> {
    let db_name = schema.unwrap_or_else(|| params.database.primary());
    log::debug!("MySQL: Fetching triggers for database: {}", db_name);
    let pool = get_mysql_pool(params).await?;
    let text = resolve_text_proto(&pool, params).await?;
    let query = r#"
        SELECT trigger_name, event_object_table, event_manipulation, action_timing
        FROM information_schema.triggers
        WHERE trigger_schema = ?
        ORDER BY trigger_name ASC
    "#;
    let rows = fetch_all_rows(&pool, text, query, &[db_name]).await?;
    let triggers: Vec<TriggerInfo> = rows
        .iter()
        .map(|r| TriggerInfo {
            name: mysql_row_str(r, 0),
            table_name: mysql_row_str(r, 1),
            event: mysql_row_str(r, 2),
            timing: mysql_row_str(r, 3),
            definition: None,
        })
        .collect();
    log::debug!("MySQL: Found {} triggers in {}", triggers.len(), db_name);
    Ok(triggers)
}

pub async fn get_trigger_definition(
    params: &ConnectionParams,
    trigger_name: &str,
    schema: Option<&str>,
) -> Result<String, String> {
    let pool = get_mysql_pool(params).await?;
    let qualified = match schema {
        Some(s) => format!(
            "`{}`.`{}`",
            escape_identifier(s),
            escape_identifier(trigger_name)
        ),
        None => format!("`{}`", escape_identifier(trigger_name)),
    };
    let query = format!("SHOW CREATE TRIGGER {}", qualified);
    let text = resolve_text_proto(&pool, params).await?;
    let row = fetch_one_row(&pool, text, &query, &[])
        .await
        .map_err(|e| format!("Failed to get trigger definition: {}", e))?;
    // SHOW CREATE TRIGGER returns: Trigger, sql_mode, SQL Original Statement, ...
    Ok(mysql_row_str(&row, 2))
}

pub async fn create_trigger(
    params: &ConnectionParams,
    trigger_sql: &str,
    schema: Option<&str>,
) -> Result<(), String> {
    let effective_params;
    let use_params = if let Some(s) = schema {
        effective_params = ConnectionParams {
            database: crate::models::DatabaseSelection::Single(s.to_string()),
            ..params.clone()
        };
        &effective_params
    } else {
        params
    };
    let pool = get_mysql_pool(use_params).await?;
    sqlx::raw_sql(trigger_sql)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to create trigger: {}", e))?;
    Ok(())
}

pub async fn drop_trigger(
    params: &ConnectionParams,
    trigger_name: &str,
    schema: Option<&str>,
) -> Result<(), String> {
    let pool = get_mysql_pool(params).await?;
    let qualified = match schema {
        Some(s) => format!(
            "`{}`.`{}`",
            escape_identifier(s),
            escape_identifier(trigger_name)
        ),
        None => format!("`{}`", escape_identifier(trigger_name)),
    };
    let query = format!("DROP TRIGGER IF EXISTS {}", qualified);
    sqlx::raw_sql(&query)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to drop trigger: {}", e))?;
    Ok(())
}

// ============================================================
// Plugin wrapper
// ============================================================

use crate::drivers::driver_trait::{
    DatabaseDriver, DriverCapabilities, PluginManifest, PluginSettingDefinition, SqlDialect,
};
use async_trait::async_trait;
use std::collections::HashMap;

const DEFAULT_MYSQL_MAX_ALLOWED_PACKET: u64 = 1_073_741_824;
const DEFAULT_MYSQL_SOCKET_TIMEOUT_MS: u64 = 600_000;
const DEFAULT_MYSQL_CONNECT_TIMEOUT_MS: u64 = 60_000;
const DEFAULT_MYSQL_TIMEZONE: &str = "SYSTEM";

fn mysql_setting_value(key: &str) -> Option<serde_json::Value> {
    crate::config::get_cached_config()
        .plugins
        .and_then(|plugins| plugins.get("mysql").cloned())
        .and_then(|plugin| plugin.settings.get(key).cloned())
}

fn mysql_string_setting(key: &str, default: &str) -> String {
    mysql_setting_value(key)
        .and_then(|value| value.as_str().map(ToOwned::to_owned))
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| default.to_string())
}

fn mysql_numeric_setting(key: &str, default: u64) -> u64 {
    mysql_setting_value(key)
        .and_then(|value| {
            value
                .as_u64()
                .or_else(|| value.as_i64().and_then(|item| u64::try_from(item).ok()))
                .or_else(|| value.as_str().and_then(|item| item.parse::<u64>().ok()))
        })
        .unwrap_or(default)
}

pub struct MysqlDriver {
    manifest: PluginManifest,
}

impl MysqlDriver {
    pub fn new() -> Self {
        Self {
            manifest: PluginManifest {
                id: "mysql".to_string(),
                name: "MySQL".to_string(),
                version: "1.0.0".to_string(),
                description: "MySQL and MariaDB databases".to_string(),
                default_port: Some(3306),
                capabilities: DriverCapabilities {
                    schemas: false,
                    views: true,
                    materialized_views: false,
                    routines: true,
                    file_based: false,
                    folder_based: false,
                    connection_string: true,
                    connection_string_example: "mysql://user:pass@localhost:3306/db".into(),
                    identifier_quote: "`".into(),
                    alter_primary_key: true,
                    auto_increment_keyword: "AUTO_INCREMENT".into(),
                    serial_type: String::new(),
                    inline_pk: false,
                    alter_column: true,
                    create_foreign_keys: true,
                    no_connection_required: false,
                    manage_tables: true,
                    readonly: false,
                    triggers: true,
                    supports_ssl: true,
                    sql_dialect: SqlDialect::Mysql,
                },
                is_builtin: true,
                default_username: "root".to_string(),
                color: "#f97316".to_string(),
                icon: "mysql".to_string(),
                settings: vec![
                    PluginSettingDefinition {
                        key: "maxAllowedPacket".to_string(),
                        label: "Max Allowed Packet".to_string(),
                        setting_type: "number".to_string(),
                        default: Some(serde_json::json!(DEFAULT_MYSQL_MAX_ALLOWED_PACKET)),
                        description: Some(
                            "Maximum packet size used by the MySQL connector.".to_string(),
                        ),
                        required: false,
                        options: vec![],
                    },
                    PluginSettingDefinition {
                        key: "socketTimeout".to_string(),
                        label: "Socket Timeout".to_string(),
                        setting_type: "number".to_string(),
                        default: Some(serde_json::json!(DEFAULT_MYSQL_SOCKET_TIMEOUT_MS)),
                        description: Some("Socket timeout in milliseconds.".to_string()),
                        required: false,
                        options: vec![],
                    },
                    PluginSettingDefinition {
                        key: "connectTimeout".to_string(),
                        label: "Connect Timeout".to_string(),
                        setting_type: "number".to_string(),
                        default: Some(serde_json::json!(DEFAULT_MYSQL_CONNECT_TIMEOUT_MS)),
                        description: Some("Connection timeout in milliseconds.".to_string()),
                        required: false,
                        options: vec![],
                    },
                    PluginSettingDefinition {
                        key: "timezone".to_string(),
                        label: "Timezone".to_string(),
                        setting_type: "string".to_string(),
                        default: Some(serde_json::json!(DEFAULT_MYSQL_TIMEZONE)),
                        description: Some(
                            "Session timezone sent to MySQL after connect.".to_string(),
                        ),
                        required: false,
                        options: vec![],
                    },
                ],
                ui_extensions: None,
            },
        }
    }
}

#[async_trait]
impl DatabaseDriver for MysqlDriver {
    fn manifest(&self) -> &PluginManifest {
        &self.manifest
    }

    fn get_data_types(&self) -> Vec<crate::models::DataTypeInfo> {
        types::get_data_types()
    }

    fn map_inferred_type(&self, kind: &str) -> String {
        match kind {
            "REAL" => "DOUBLE".to_string(),
            other => other.to_string(),
        }
    }

    fn build_connection_url(
        &self,
        params: &crate::models::ConnectionParams,
    ) -> Result<String, String> {
        use urlencoding::encode;
        let user = encode(params.username.as_deref().unwrap_or_default());
        let raw_pass = params.password.as_deref().unwrap_or_default();
        let credentials = if raw_pass.is_empty() {
            user.into_owned()
        } else {
            format!("{}:{}", user, encode(raw_pass))
        };
        let max_allowed_packet =
            mysql_numeric_setting("maxAllowedPacket", DEFAULT_MYSQL_MAX_ALLOWED_PACKET);
        let socket_timeout =
            mysql_numeric_setting("socketTimeout", DEFAULT_MYSQL_SOCKET_TIMEOUT_MS);
        let connect_timeout =
            mysql_numeric_setting("connectTimeout", DEFAULT_MYSQL_CONNECT_TIMEOUT_MS);
        let timezone = mysql_string_setting("timezone", DEFAULT_MYSQL_TIMEZONE);
        let ssl_mode = match params.ssl_mode.as_deref() {
            Some("disabled") | Some("disable") => "disabled",
            Some("preferred") | Some("prefer") => "preferred",
            Some("required") | Some("require") => "required",
            Some("verify_ca") => "verify_ca",
            Some("verify_identity") => "verify_identity",
            _ => "required",
        };
        Ok(format!(
            "mysql://{}@{}:{}/{}?maxAllowedPacket={}&socketTimeout={}&connectTimeout={}&timezone={}&ssl-mode={}",
            credentials,
            params.host.as_deref().unwrap_or("localhost"),
            params.port.unwrap_or(3306),
            params.database,
            max_allowed_packet,
            socket_timeout,
            connect_timeout,
            encode(&timezone),
            ssl_mode,
        ))
    }

    async fn test_connection(
        &self,
        params: &crate::models::ConnectionParams,
    ) -> Result<(), String> {
        use sqlx::{ConnectOptions, Connection};
        // Route through `build_mysql_options` rather than the connection URL so
        // MySQL-specific flags are honored: the sqlx URL parser silently ignores
        // unknown query parameters, which would let a Vitess/PlanetScale
        // connection pass the test but fail at pool time. Going through the
        // builder also applies the cleartext plugin gating (mysql_clear_password
        // requires an enforced TLS mode) to the test, exactly as for the live pool.
        let options = crate::pool_manager::build_mysql_options(params, None)?;
        match options.connect().await {
            Ok(mut conn) => {
                let result = conn.ping().await.map_err(|e| e.to_string());
                let _ = conn.close().await;
                result
            }
            // Mirror the pool's auto-fallback: in auto mode (`pipes_as_concat`
            // unset), retry without the forced sql_mode so a PlanetScale/Vitess
            // connection that the pool will accept also passes the test.
            Err(e) => {
                let e = e.to_string();
                if params.pipes_as_concat.is_none()
                    && crate::pool_manager::is_pipes_as_concat_unsupported(&e)
                {
                    let mut fallback = params.clone();
                    fallback.pipes_as_concat = Some(false);
                    let options = crate::pool_manager::build_mysql_options(&fallback, None)?;
                    let mut conn = options.connect().await.map_err(|e| e.to_string())?;
                    let result = conn.ping().await.map_err(|e| e.to_string());
                    let _ = conn.close().await;
                    result
                } else {
                    Err(e)
                }
            }
        }
    }

    async fn ping(&self, params: &crate::models::ConnectionParams) -> Result<(), String> {
        let conn_id = params.connection_id.as_deref();
        if !crate::pool_manager::has_pool(params, conn_id).await {
            return Err("No active connection pool".into());
        }
        let pool = crate::pool_manager::get_mysql_pool_with_id(params, conn_id).await?;
        let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
        sqlx::Connection::ping(&mut *conn)
            .await
            .map_err(|e| e.to_string())
    }

    async fn get_databases(
        &self,
        params: &crate::models::ConnectionParams,
    ) -> Result<Vec<String>, String> {
        // MySQL requires connecting to information_schema to list databases
        let mut p = params.clone();
        p.database = crate::models::DatabaseSelection::Single("information_schema".to_string());
        p.connection_id = None; // avoid caching under the real connection key
        get_databases(&p).await
    }

    async fn get_schemas(
        &self,
        params: &crate::models::ConnectionParams,
    ) -> Result<Vec<String>, String> {
        get_schemas(params).await
    }

    async fn get_tables(
        &self,
        params: &crate::models::ConnectionParams,
        schema: Option<&str>,
    ) -> Result<Vec<crate::models::TableInfo>, String> {
        get_tables(params, schema).await
    }

    async fn get_columns(
        &self,
        params: &crate::models::ConnectionParams,
        table: &str,
        schema: Option<&str>,
    ) -> Result<Vec<crate::models::TableColumn>, String> {
        get_columns(params, table, schema).await
    }

    async fn get_foreign_keys(
        &self,
        params: &crate::models::ConnectionParams,
        table: &str,
        schema: Option<&str>,
    ) -> Result<Vec<crate::models::ForeignKey>, String> {
        get_foreign_keys(params, table, schema).await
    }

    async fn get_indexes(
        &self,
        params: &crate::models::ConnectionParams,
        table: &str,
        schema: Option<&str>,
    ) -> Result<Vec<crate::models::Index>, String> {
        get_indexes(params, table, schema).await
    }

    async fn get_views(
        &self,
        params: &crate::models::ConnectionParams,
        schema: Option<&str>,
    ) -> Result<Vec<crate::models::ViewInfo>, String> {
        get_views(params, schema).await
    }

    async fn get_view_definition(
        &self,
        params: &crate::models::ConnectionParams,
        view_name: &str,
        _schema: Option<&str>,
    ) -> Result<String, String> {
        get_view_definition(params, view_name).await
    }

    async fn get_view_columns(
        &self,
        params: &crate::models::ConnectionParams,
        view_name: &str,
        schema: Option<&str>,
    ) -> Result<Vec<crate::models::TableColumn>, String> {
        get_view_columns(params, view_name, schema).await
    }

    async fn create_view(
        &self,
        params: &crate::models::ConnectionParams,
        view_name: &str,
        definition: &str,
        _schema: Option<&str>,
    ) -> Result<(), String> {
        create_view(params, view_name, definition).await
    }

    async fn alter_view(
        &self,
        params: &crate::models::ConnectionParams,
        view_name: &str,
        definition: &str,
        _schema: Option<&str>,
    ) -> Result<(), String> {
        alter_view(params, view_name, definition).await
    }

    async fn drop_view(
        &self,
        params: &crate::models::ConnectionParams,
        view_name: &str,
        _schema: Option<&str>,
    ) -> Result<(), String> {
        drop_view(params, view_name).await
    }

    async fn get_routines(
        &self,
        params: &crate::models::ConnectionParams,
        schema: Option<&str>,
    ) -> Result<Vec<crate::models::RoutineInfo>, String> {
        get_routines(params, schema).await
    }

    async fn get_routine_parameters(
        &self,
        params: &crate::models::ConnectionParams,
        routine_name: &str,
        schema: Option<&str>,
    ) -> Result<Vec<crate::models::RoutineParameter>, String> {
        get_routine_parameters(params, routine_name, schema).await
    }

    async fn get_routine_definition(
        &self,
        params: &crate::models::ConnectionParams,
        routine_name: &str,
        routine_type: &str,
        _schema: Option<&str>,
    ) -> Result<String, String> {
        get_routine_definition(params, routine_name, routine_type).await
    }

    async fn get_triggers(
        &self,
        params: &crate::models::ConnectionParams,
        schema: Option<&str>,
    ) -> Result<Vec<crate::models::TriggerInfo>, String> {
        get_triggers(params, schema).await
    }

    async fn get_trigger_definition(
        &self,
        params: &crate::models::ConnectionParams,
        trigger_name: &str,
        _table_name: &str,
        schema: Option<&str>,
    ) -> Result<String, String> {
        get_trigger_definition(params, trigger_name, schema).await
    }

    async fn create_trigger(
        &self,
        params: &crate::models::ConnectionParams,
        trigger_sql: &str,
        schema: Option<&str>,
    ) -> Result<(), String> {
        create_trigger(params, trigger_sql, schema).await
    }

    async fn drop_trigger(
        &self,
        params: &crate::models::ConnectionParams,
        trigger_name: &str,
        _table_name: &str,
        schema: Option<&str>,
    ) -> Result<(), String> {
        drop_trigger(params, trigger_name, schema).await
    }

    async fn execute_query(
        &self,
        params: &crate::models::ConnectionParams,
        query: &str,
        limit: Option<u32>,
        page: u32,
        schema: Option<&str>,
    ) -> Result<crate::models::QueryResult, String> {
        execute_query(params, query, limit, page, schema).await
    }

    async fn execute_batch(
        &self,
        params: &crate::models::ConnectionParams,
        queries: &[String],
        limit: Option<u32>,
        page: u32,
        schema: Option<&str>,
        on_progress: Option<&crate::drivers::driver_trait::BatchProgressFn>,
    ) -> Result<Vec<crate::models::BatchStatementResult>, String> {
        execute_batch(params, queries, limit, page, schema, on_progress).await
    }

    async fn explain_query(
        &self,
        params: &crate::models::ConnectionParams,
        query: &str,
        analyze: bool,
        schema: Option<&str>,
    ) -> Result<crate::models::ExplainPlan, String> {
        explain_query(params, query, analyze, schema).await
    }

    async fn insert_record(
        &self,
        params: &crate::models::ConnectionParams,
        table: &str,
        data: std::collections::HashMap<String, serde_json::Value>,
        _schema: Option<&str>,
        max_blob_size: u64,
    ) -> Result<u64, String> {
        insert_record(params, table, data, max_blob_size).await
    }

    async fn update_record(
        &self,
        params: &crate::models::ConnectionParams,
        table: &str,
        pk_map: &std::collections::HashMap<String, serde_json::Value>,
        col_name: &str,
        new_val: serde_json::Value,
        _schema: Option<&str>,
        max_blob_size: u64,
    ) -> Result<u64, String> {
        update_record(params, table, pk_map, col_name, new_val, max_blob_size).await
    }

    async fn delete_record(
        &self,
        params: &crate::models::ConnectionParams,
        table: &str,
        pk_map: &std::collections::HashMap<String, serde_json::Value>,
        _schema: Option<&str>,
    ) -> Result<u64, String> {
        delete_record(params, table, pk_map).await
    }

    async fn save_blob_to_file(
        &self,
        params: &crate::models::ConnectionParams,
        table: &str,
        col_name: &str,
        pk_map: &std::collections::HashMap<String, serde_json::Value>,
        _schema: Option<&str>,
        file_path: &str,
    ) -> Result<(), String> {
        save_blob_column_to_file(params, table, col_name, pk_map, file_path).await
    }

    async fn fetch_blob_as_data_url(
        &self,
        params: &crate::models::ConnectionParams,
        table: &str,
        col_name: &str,
        pk_map: &std::collections::HashMap<String, serde_json::Value>,
        _schema: Option<&str>,
    ) -> Result<String, String> {
        fetch_blob_column_as_data_url(params, table, col_name, pk_map).await
    }

    async fn get_create_table_sql(
        &self,
        table_name: &str,
        columns: Vec<crate::models::ColumnDefinition>,
        _schema: Option<&str>,
    ) -> Result<Vec<String>, String> {
        let mut col_defs = Vec::new();
        let mut pk_cols = Vec::new();
        for col in &columns {
            let mut def = format!("`{}` {}", escape_identifier(&col.name), col.data_type);
            if !col.is_nullable {
                def.push_str(" NOT NULL");
            }
            if col.is_auto_increment {
                def.push_str(" AUTO_INCREMENT");
            }
            if let Some(default) = &col.default_value {
                def.push_str(&format!(" DEFAULT {}", default));
            }
            col_defs.push(def);
            if col.is_pk {
                pk_cols.push(format!("`{}`", escape_identifier(&col.name)));
            }
        }
        if !pk_cols.is_empty() {
            col_defs.push(format!("PRIMARY KEY ({})", pk_cols.join(", ")));
        }
        Ok(vec![format!(
            "CREATE TABLE `{}` (\n  {}\n)",
            escape_identifier(table_name),
            col_defs.join(",\n  ")
        )])
    }

    async fn get_add_column_sql(
        &self,
        table: &str,
        column: crate::models::ColumnDefinition,
        _schema: Option<&str>,
    ) -> Result<Vec<String>, String> {
        let mut def = format!(
            "ALTER TABLE `{}` ADD COLUMN `{}` {}",
            escape_identifier(table),
            escape_identifier(&column.name),
            column.data_type
        );
        if !column.is_nullable {
            def.push_str(" NOT NULL");
        } else {
            def.push_str(" NULL");
        }
        if column.is_auto_increment {
            def.push_str(" AUTO_INCREMENT");
        }
        if let Some(default) = &column.default_value {
            def.push_str(&format!(" DEFAULT {}", default));
        }
        if column.is_pk {
            def.push_str(" PRIMARY KEY");
        }
        Ok(vec![def])
    }

    async fn get_alter_column_sql(
        &self,
        table: &str,
        old_column: crate::models::ColumnDefinition,
        new_column: crate::models::ColumnDefinition,
        _schema: Option<&str>,
    ) -> Result<Vec<String>, String> {
        let mut def = String::new();
        if old_column.name != new_column.name {
            def.push_str(&format!(
                "ALTER TABLE `{}` CHANGE `{}` `{}` {}",
                escape_identifier(table),
                escape_identifier(&old_column.name),
                escape_identifier(&new_column.name),
                new_column.data_type
            ));
        } else {
            def.push_str(&format!(
                "ALTER TABLE `{}` MODIFY COLUMN `{}` {}",
                escape_identifier(table),
                escape_identifier(&new_column.name),
                new_column.data_type
            ));
        }
        if !new_column.is_nullable {
            def.push_str(" NOT NULL");
        } else {
            def.push_str(" NULL");
        }
        if new_column.is_auto_increment {
            def.push_str(" AUTO_INCREMENT");
        }
        if let Some(default) = &new_column.default_value {
            def.push_str(&format!(" DEFAULT {}", default));
        }
        Ok(vec![def])
    }

    async fn get_create_index_sql(
        &self,
        table: &str,
        index_name: &str,
        columns: Vec<String>,
        is_unique: bool,
        _schema: Option<&str>,
    ) -> Result<Vec<String>, String> {
        let unique = if is_unique { "UNIQUE " } else { "" };
        let cols: Vec<String> = columns
            .iter()
            .map(|c| format!("`{}`", escape_identifier(c)))
            .collect();
        Ok(vec![format!(
            "CREATE {}INDEX `{}` ON `{}` ({})",
            unique,
            escape_identifier(index_name),
            escape_identifier(table),
            cols.join(", ")
        )])
    }

    async fn get_create_foreign_key_sql(
        &self,
        table: &str,
        fk_name: &str,
        column: &str,
        ref_table: &str,
        ref_column: &str,
        on_delete: Option<&str>,
        on_update: Option<&str>,
        _schema: Option<&str>,
    ) -> Result<Vec<String>, String> {
        let mut sql = format!(
            "ALTER TABLE `{}` ADD CONSTRAINT `{}` FOREIGN KEY (`{}`) REFERENCES `{}` (`{}`)",
            escape_identifier(table),
            escape_identifier(fk_name),
            escape_identifier(column),
            escape_identifier(ref_table),
            escape_identifier(ref_column)
        );
        if let Some(action) = on_delete {
            sql.push_str(&format!(" ON DELETE {}", action));
        }
        if let Some(action) = on_update {
            sql.push_str(&format!(" ON UPDATE {}", action));
        }
        Ok(vec![sql])
    }

    async fn drop_index(
        &self,
        params: &crate::models::ConnectionParams,
        table: &str,
        index_name: &str,
        _schema: Option<&str>,
    ) -> Result<(), String> {
        let sql = format!(
            "DROP INDEX `{}` ON `{}`",
            escape_identifier(index_name),
            escape_identifier(table)
        );
        execute_query(params, &sql, None, 1, None).await?;
        Ok(())
    }

    async fn drop_foreign_key(
        &self,
        params: &crate::models::ConnectionParams,
        table: &str,
        fk_name: &str,
        _schema: Option<&str>,
    ) -> Result<(), String> {
        let sql = format!(
            "ALTER TABLE `{}` DROP FOREIGN KEY `{}`",
            escape_identifier(table),
            escape_identifier(fk_name)
        );
        execute_query(params, &sql, None, 1, None).await?;
        Ok(())
    }

    async fn get_all_columns_batch(
        &self,
        params: &crate::models::ConnectionParams,
        schema: Option<&str>,
    ) -> Result<HashMap<String, Vec<crate::models::TableColumn>>, String> {
        get_all_columns_batch(params, schema).await
    }

    async fn get_all_foreign_keys_batch(
        &self,
        params: &crate::models::ConnectionParams,
        schema: Option<&str>,
    ) -> Result<HashMap<String, Vec<crate::models::ForeignKey>>, String> {
        get_all_foreign_keys_batch(params, schema).await
    }

    async fn get_schema_snapshot(
        &self,
        params: &crate::models::ConnectionParams,
        schema: Option<&str>,
    ) -> Result<Vec<crate::models::TableSchema>, String> {
        let tables = self.get_tables(params, schema).await?;
        let mut columns_map = self.get_all_columns_batch(params, schema).await?;
        let mut fks_map = self.get_all_foreign_keys_batch(params, schema).await?;
        Ok(tables
            .into_iter()
            .map(|t| crate::models::TableSchema {
                name: t.name.clone(),
                columns: columns_map.remove(&t.name).unwrap_or_default(),
                foreign_keys: fks_map.remove(&t.name).unwrap_or_default(),
            })
            .collect())
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
