//! Recorded single-row updates and their restoration on PostgreSQL.
//!
//! Every value is read through `column::text` and written back through
//! `CAST($n AS <type>)`, so what a restore writes is byte-for-byte what was
//! read. The row is locked with `SELECT ... FOR UPDATE` inside the same
//! transaction that reads, compares and writes it, which is the atomic
//! concurrency check: no other writer can change the row between the
//! comparison and the update.

use super::binding::{build_pk_map_predicate, TypedPgParam};
use super::client::{format_pg_error, get_client};
use super::helpers::escape_identifier;
use super::{get_pk_column_types, prepare_update};
use crate::drivers::recorded_save::{
    CellImage, ColumnCapture, RecordedCapture, RecordedUpdate, RestoreColumn, RestoreOutcome,
    RowCapture, MAX_CAPTURED_VALUE_BYTES, OMITTED_KEY_CHANGED, OMITTED_TOO_LARGE,
};
use crate::models::ConnectionParams;
use crate::pool_manager::get_postgres_pool;
use std::collections::{HashMap, HashSet};
use tokio_postgres::types::{ToSql, Type};
use tokio_postgres::{GenericClient, Row};

const RESTORE_LOCK_TIMEOUT_SQL: &str = "SET LOCAL lock_timeout = '5s'";
const OMITTED_ROW_MISSING: &str = "row_missing";

pub(super) const UNSUPPORTED_NOT_A_BASE_TABLE: &str = "not_a_base_table";
pub(super) const UNSUPPORTED_NO_PRIMARY_KEY: &str = "no_primary_key";
pub(super) const UNSUPPORTED_KEY_MISMATCH: &str = "key_mismatch";
pub(super) const UNSUPPORTED_UNKNOWN_COLUMN: &str = "unknown_column";

pub(super) struct ColumnMeta {
    pub data_type: String,
    pub generated: bool,
}

pub(super) struct TableMeta {
    pub relkind: String,
    pub has_triggers: bool,
    pub pk_columns: Vec<String>,
    pub columns: HashMap<String, ColumnMeta>,
}

/// Why a target cannot be recorded, or `None` when it can: an ordinary table
/// with a primary key, addressed by exactly that key, and known columns.
pub(super) fn unsupported_reason(
    meta: Option<&TableMeta>,
    pk_map: &HashMap<String, serde_json::Value>,
    columns: &[String],
) -> Option<&'static str> {
    let Some(meta) = meta else {
        return Some(UNSUPPORTED_NOT_A_BASE_TABLE);
    };
    if meta.relkind != "r" {
        return Some(UNSUPPORTED_NOT_A_BASE_TABLE);
    }
    if meta.pk_columns.is_empty() {
        return Some(UNSUPPORTED_NO_PRIMARY_KEY);
    }
    let key: HashSet<&str> = pk_map.keys().map(String::as_str).collect();
    let expected: HashSet<&str> = meta.pk_columns.iter().map(String::as_str).collect();
    if key != expected {
        return Some(UNSUPPORTED_KEY_MISMATCH);
    }
    if columns.iter().any(|name| !meta.columns.contains_key(name)) {
        return Some(UNSUPPORTED_UNKNOWN_COLUMN);
    }
    None
}

fn qualified_table(schema: &str, table: &str) -> String {
    format!(
        "\"{}\".\"{}\"",
        escape_identifier(schema),
        escape_identifier(table)
    )
}

/// `SELECT` returning, for every column, an `IS NULL` flag and the text form
/// (withheld when it exceeds the capture limit).
pub(super) fn image_select_sql(
    schema: &str,
    table: &str,
    columns: &[String],
    predicate: &str,
    lock_row: bool,
) -> String {
    let projections: Vec<String> = columns
        .iter()
        .map(|name| {
            let column = format!("\"{}\"", escape_identifier(name));
            format!(
                "({column} IS NULL), CASE WHEN octet_length({column}::text) > {MAX_CAPTURED_VALUE_BYTES} THEN NULL ELSE {column}::text END"
            )
        })
        .collect();
    format!(
        "SELECT {} FROM {} WHERE {}{}",
        projections.join(", "),
        qualified_table(schema, table),
        predicate,
        if lock_row { " FOR UPDATE" } else { "" }
    )
}

/// `UPDATE` writing every target through a cast from its text form. The
/// placeholders `$1..$n` carry the values, the predicate follows.
pub(super) fn restore_update_sql(
    schema: &str,
    table: &str,
    assignments: &[(&str, &str)],
    predicate: &str,
) -> String {
    let set_clause: Vec<String> = assignments
        .iter()
        .enumerate()
        .map(|(index, (name, data_type))| {
            format!(
                "\"{}\" = CAST(${} AS {})",
                escape_identifier(name),
                index + 1,
                data_type
            )
        })
        .collect();
    format!(
        "UPDATE {} SET {} WHERE {}",
        qualified_table(schema, table),
        set_clause.join(", "),
        predicate
    )
}

fn images_from_row(row: &Row, count: usize) -> Result<Vec<CellImage>, String> {
    let mut images = Vec::with_capacity(count);
    for index in 0..count {
        let is_null: bool = row.try_get(index * 2).map_err(|e| format_pg_error(&e))?;
        let text: Option<String> = row
            .try_get(index * 2 + 1)
            .map_err(|e| format_pg_error(&e))?;
        images.push(match (is_null, text) {
            (true, _) => CellImage::Null,
            (false, Some(value)) => CellImage::Text { value },
            (false, None) => CellImage::Omitted {
                reason: OMITTED_TOO_LARGE.to_string(),
            },
        });
    }
    Ok(images)
}

fn values_of(params: &[TypedPgParam]) -> (Vec<Type>, Vec<&(dyn ToSql + Sync)>) {
    (
        params.iter().map(|(_, t)| t.clone()).collect(),
        params
            .iter()
            .map(|(b, _)| b.as_ref() as &(dyn ToSql + Sync))
            .collect(),
    )
}

async fn select_images(
    client: &impl GenericClient,
    sql: &str,
    key_params: &[TypedPgParam],
    count: usize,
) -> Result<Option<Vec<CellImage>>, String> {
    let (types, values) = values_of(key_params);
    let statement = client
        .prepare_typed(sql, &types)
        .await
        .map_err(|e| format_pg_error(&e))?;
    let rows = client
        .query(&statement, &values)
        .await
        .map_err(|e| format_pg_error(&e))?;
    match rows.as_slice() {
        [] => Ok(None),
        [row] => images_from_row(row, count).map(Some),
        _ => Err("The row identity matched more than one row".to_string()),
    }
}

async fn load_table_meta(
    client: &impl GenericClient,
    schema: &str,
    table: &str,
    columns: &[String],
) -> Result<Option<TableMeta>, String> {
    let rows = client
        .query(
            "SELECT c.oid, c.relkind::text, \
EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal AND t.tgenabled <> 'D') \
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
WHERE n.nspname = $1 AND c.relname = $2",
            &[&schema, &table],
        )
        .await
        .map_err(|e| format_pg_error(&e))?;
    let Some(row) = rows.first() else {
        return Ok(None);
    };
    let oid: u32 = row.get(0);
    let relkind: String = row.get(1);
    let has_triggers: bool = row.get(2);

    let pk_columns = client
        .query(
            "SELECT a.attname::text FROM pg_index i \
JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey) \
WHERE i.indrelid = $1 AND i.indisprimary ORDER BY a.attname::text",
            &[&oid],
        )
        .await
        .map_err(|e| format_pg_error(&e))?
        .iter()
        .map(|row| row.get::<_, String>(0))
        .collect();

    let wanted: Vec<String> = columns.to_vec();
    let columns = client
        .query(
            "SELECT a.attname::text, format_type(a.atttypid, a.atttypmod), a.attgenerated::text <> '' \
FROM pg_attribute a \
WHERE a.attrelid = $1 AND a.attnum > 0 AND NOT a.attisdropped AND a.attname::text = ANY ($2)",
            &[&oid, &wanted],
        )
        .await
        .map_err(|e| format_pg_error(&e))?
        .iter()
        .map(|row| {
            (
                row.get::<_, String>(0),
                ColumnMeta {
                    data_type: row.get(1),
                    generated: row.get(2),
                },
            )
        })
        .collect();

    Ok(Some(TableMeta {
        relkind,
        has_triggers,
        pk_columns,
        columns,
    }))
}

pub(super) async fn update_row_recorded(
    params: &ConnectionParams,
    table: &str,
    pk_map: &HashMap<String, serde_json::Value>,
    changes: Vec<(String, serde_json::Value)>,
    schema: &str,
    max_blob_size: u64,
) -> Result<RecordedUpdate, String> {
    if changes.is_empty() {
        return Err("There are no changes to save".to_string());
    }
    let pool = get_postgres_pool(params).await?;
    let names: Vec<String> = changes.iter().map(|(name, _)| name.clone()).collect();

    // Everything that needs the pool is done before the transaction takes a
    // connection of its own.
    let mut prepared = Vec::with_capacity(changes.len());
    for (name, value) in changes {
        prepared
            .push(prepare_update(&pool, table, pk_map, &name, value, schema, max_blob_size).await?);
    }
    let pk_types = get_pk_column_types(&pool, schema, table, pk_map).await;
    let (predicate, key_params) = build_pk_map_predicate(pk_map, &pk_types, 1)?;

    let mut client = get_client(&pool).await?;
    let meta = match load_table_meta(&**client, schema, table, &names).await {
        Ok(meta) => meta,
        Err(error) => {
            log::debug!("Could not inspect {schema}.{table} for a recorded save: {error}");
            None
        }
    };
    let unsupported = unsupported_reason(meta.as_ref(), pk_map, &names);

    let tx = client
        .transaction()
        .await
        .map_err(|e| format_pg_error(&e))?;

    let mut before = None;
    if unsupported.is_none() {
        let sql = image_select_sql(schema, table, &names, &predicate, true);
        match select_images(&*tx, &sql, &key_params, names.len()).await? {
            Some(images) => before = Some(images),
            None => {
                let _ = tx.rollback().await;
                return Ok(RecordedUpdate {
                    affected: 0,
                    capture: RecordedCapture::Skipped {
                        reason: OMITTED_ROW_MISSING.to_string(),
                    },
                });
            }
        }
    }

    let mut affected = 0;
    for update in &prepared {
        let params_ref = update.params_ref();
        let types: Vec<Type> = params_ref.iter().map(|(_, t)| t.clone()).collect();
        let values: Vec<&(dyn ToSql + Sync)> = params_ref.iter().map(|(v, _)| *v).collect();
        let statement = tx
            .prepare_typed(&update.query, &types)
            .await
            .map_err(|e| update.describe_error(format_pg_error(&e)))?;
        affected += tx
            .execute(&statement, &values)
            .await
            .map_err(|e| update.describe_error(format_pg_error(&e)))?;
    }

    let capture = match (unsupported, before, meta) {
        (None, Some(before), Some(meta)) => {
            let key_changed = names.iter().any(|name| meta.pk_columns.contains(name));
            let after = if key_changed {
                omitted_images(names.len(), OMITTED_KEY_CHANGED)
            } else {
                let sql = image_select_sql(schema, table, &names, &predicate, false);
                select_images(&*tx, &sql, &key_params, names.len())
                    .await?
                    .unwrap_or_else(|| omitted_images(names.len(), OMITTED_ROW_MISSING))
            };
            let columns = names
                .iter()
                .zip(before)
                .zip(after)
                .map(|((name, pre), post)| {
                    let column = &meta.columns[name];
                    ColumnCapture {
                        name: name.clone(),
                        data_type: column.data_type.clone(),
                        generated: column.generated,
                        pre,
                        post,
                    }
                })
                .collect();
            RecordedCapture::Captured(RowCapture {
                columns,
                has_triggers: meta.has_triggers,
                key_changed,
            })
        }
        (reason, _, _) => RecordedCapture::Skipped {
            reason: reason.unwrap_or(UNSUPPORTED_NOT_A_BASE_TABLE).to_string(),
        },
    };

    tx.commit().await.map_err(|e| format_pg_error(&e))?;
    Ok(RecordedUpdate { affected, capture })
}

fn omitted_images(count: usize, reason: &str) -> Vec<CellImage> {
    (0..count)
        .map(|_| CellImage::Omitted {
            reason: reason.to_string(),
        })
        .collect()
}

pub(super) async fn read_row_images(
    params: &ConnectionParams,
    table: &str,
    pk_map: &HashMap<String, serde_json::Value>,
    columns: &[String],
    schema: &str,
) -> Result<Option<Vec<CellImage>>, String> {
    let pool = get_postgres_pool(params).await?;
    let pk_types = get_pk_column_types(&pool, schema, table, pk_map).await;
    let (predicate, key_params) = build_pk_map_predicate(pk_map, &pk_types, 1)?;
    let client = get_client(&pool).await?;
    let sql = image_select_sql(schema, table, columns, &predicate, false);
    select_images(&**client, &sql, &key_params, columns.len()).await
}

pub(super) async fn restore_row_images(
    params: &ConnectionParams,
    table: &str,
    pk_map: &HashMap<String, serde_json::Value>,
    columns: &[RestoreColumn],
    schema: &str,
) -> Result<RestoreOutcome, String> {
    if columns.is_empty() {
        return Err("There is nothing to restore".to_string());
    }
    let pool = get_postgres_pool(params).await?;
    let names: Vec<String> = columns.iter().map(|c| c.name.clone()).collect();
    let pk_types = get_pk_column_types(&pool, schema, table, pk_map).await;
    let (select_predicate, select_params) = build_pk_map_predicate(pk_map, &pk_types, 1)?;
    let (update_predicate, update_key_params) =
        build_pk_map_predicate(pk_map, &pk_types, columns.len() + 1)?;

    let mut client = get_client(&pool).await?;
    let meta = load_table_meta(&**client, schema, table, &names).await?;
    if let Some(reason) = unsupported_reason(meta.as_ref(), pk_map, &names) {
        return Err(format!("This target cannot be restored ({reason})"));
    }
    let meta = meta.ok_or_else(|| UNSUPPORTED_NOT_A_BASE_TABLE.to_string())?;
    if meta.has_triggers {
        return Err("This table has triggers, so a restore is refused".to_string());
    }
    let mut assignments = Vec::with_capacity(columns.len());
    let mut value_params: Vec<TypedPgParam> = Vec::with_capacity(columns.len());
    for column in columns {
        let info = &meta.columns[&column.name];
        if info.generated {
            return Err(format!("Column {} is generated", column.name));
        }
        let value: Option<String> = match &column.target {
            CellImage::Null => None,
            CellImage::Text { value } => Some(value.clone()),
            CellImage::Omitted { .. } => {
                return Err(format!("No value was recorded for column {}", column.name))
            }
        };
        assignments.push((column.name.as_str(), info.data_type.as_str()));
        value_params.push((Box::new(value), Type::TEXT));
    }
    value_params.extend(update_key_params);
    let update_sql = restore_update_sql(schema, table, &assignments, &update_predicate);

    let tx = client
        .transaction()
        .await
        .map_err(|e| format_pg_error(&e))?;
    tx.batch_execute(RESTORE_LOCK_TIMEOUT_SQL)
        .await
        .map_err(|e| format_pg_error(&e))?;

    let locked_sql = image_select_sql(schema, table, &names, &select_predicate, true);
    let Some(current) = select_images(&*tx, &locked_sql, &select_params, names.len()).await? else {
        let _ = tx.rollback().await;
        return Ok(RestoreOutcome::RowMissing);
    };
    let unchanged = columns
        .iter()
        .zip(&current)
        .all(|(column, now)| column.expected.same_value(now));
    if !unchanged {
        let _ = tx.rollback().await;
        return Ok(RestoreOutcome::Conflict { current });
    }

    let (types, values) = values_of(&value_params);
    let statement = tx
        .prepare_typed(&update_sql, &types)
        .await
        .map_err(|e| format_pg_error(&e))?;
    let affected = tx
        .execute(&statement, &values)
        .await
        .map_err(|e| format_pg_error(&e))?;
    if affected != 1 {
        return Err(format!(
            "The restore changed {affected} rows instead of 1 and was rolled back"
        ));
    }

    let verify_sql = image_select_sql(schema, table, &names, &select_predicate, false);
    let after = select_images(&*tx, &verify_sql, &select_params, names.len()).await?;
    let verified = after.is_some_and(|after| {
        columns
            .iter()
            .zip(&after)
            .all(|(column, now)| column.target.same_value(now))
    });
    if !verified {
        return Err(
            "The restored values could not be verified and the restore was rolled back".to_string(),
        );
    }

    tx.commit().await.map_err(|e| format_pg_error(&e))?;
    Ok(RestoreOutcome::Restored { affected })
}
