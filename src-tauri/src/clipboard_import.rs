use std::sync::Arc;
use crate::{
    commands::{
        expand_k8s_connection_params, expand_ssh_connection_params, find_connection_by_id,
        resolve_connection_params_with_id,
    },
    drivers::{driver_trait::DatabaseDriver, registry::get_driver},
    models::ColumnDefinition,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

#[derive(Deserialize, Debug)]
pub struct ClipboardImportRequest {
    pub connection_id: String,
    pub table_name: String,
    pub schema: Option<String>,
    pub columns: Vec<ColumnDefinition>,
    pub rows: Vec<Vec<Option<String>>>,
    pub create_table: bool,
    pub if_exists: IfExistsStrategy,
    /// Columns to add to an existing table via `ALTER TABLE ADD COLUMN` before
    /// inserting rows. Only applied when `create_table` is false.
    #[serde(default)]
    pub add_columns: Vec<ColumnDefinition>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "snake_case")]
pub enum IfExistsStrategy {
    Fail,
    Append,
    Replace,
}

#[derive(Serialize, Debug)]
pub struct ClipboardImportResult {
    pub rows_inserted: usize,
    pub table_created: bool,
}

fn escape_sql_string(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

fn row_to_values_clause(row: &[Option<String>]) -> String {
    let values: Vec<String> = row
        .iter()
        .map(|cell| match cell {
            None => "NULL".to_string(),
            Some(v) if v.is_empty() => "NULL".to_string(),
            Some(v) => escape_sql_string(v),
        })
        .collect();
    format!("({})", values.join(", "))
}

fn quote_identifier(name: &str, quote: &str) -> String {
    format!("{quote}{}{quote}", name.replace(quote, &quote.repeat(2)))
}

fn table_ref(table_name: &str, schema: Option<&str>, quote: &str) -> String {
    match schema {
        Some(s) => format!(
            "{}.{}",
            quote_identifier(s, quote),
            quote_identifier(table_name, quote)
        ),
        None => quote_identifier(table_name, quote),
    }
}

#[tauri::command]
pub async fn execute_clipboard_import<R: Runtime>(
    app: AppHandle<R>,
    req: ClipboardImportRequest,
) -> Result<ClipboardImportResult, String> {
    log::info!(
        "Clipboard import: table='{}', rows={}, create_table={}",
        req.table_name,
        req.rows.len(),
        req.create_table
    );

    let saved_conn = find_connection_by_id(&app, &req.connection_id)?;
    let expanded = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let expanded = expand_k8s_connection_params(&app, &expanded).await?;
    let params = resolve_connection_params_with_id(&expanded, &req.connection_id)?;
    let drv: Arc<dyn DatabaseDriver> = get_driver(&saved_conn.params.driver)
        .await
        .ok_or_else(|| format!("Unsupported driver: {}", saved_conn.params.driver))?;

    let dynamic_metadata = drv.has_connection_metadata();
    let drv = drv.for_connection(&params).await?.unwrap_or(drv);
    // Preserve the legacy import quoting for static drivers.
    let quote = if dynamic_metadata {
        drv.manifest().capabilities.identifier_quote.as_str()
    } else {
        "\""
    };
    let schema_ref = req.schema.as_deref();
    let tbl_ref = table_ref(&req.table_name, schema_ref, quote);
    let mut table_created = false;

    if req.create_table {
        match req.if_exists {
            IfExistsStrategy::Replace => {
                let drop_sql = format!("DROP TABLE IF EXISTS {}", tbl_ref);
                drv.execute_query(&params, &drop_sql, None, 1, schema_ref)
                    .await
                    .map_err(|e| format!("Failed to drop existing table: {e}"))?;
            }
            IfExistsStrategy::Append => {
                add_new_columns(drv.as_ref(), &params, &req, schema_ref, &tbl_ref, quote).await?;
                return insert_rows(
                    drv.as_ref(),
                    &params,
                    &req,
                    schema_ref,
                    &tbl_ref,
                    quote,
                    false,
                )
                .await;
            }
            IfExistsStrategy::Fail => {}
        }

        let stmts = drv
            .get_create_table_sql(&req.table_name, req.columns.clone(), schema_ref)
            .await
            .map_err(|e| format!("Failed to generate CREATE TABLE SQL: {e}"))?;

        for stmt in &stmts {
            drv.execute_query(&params, stmt, None, 1, schema_ref)
                .await
                .map_err(|e| format!("Failed to create table: {e}"))?;
        }
        table_created = true;
    } else {
        add_new_columns(drv.as_ref(), &params, &req, schema_ref, &tbl_ref, quote).await?;
    }

    insert_rows(
        drv.as_ref(),
        &params,
        &req,
        schema_ref,
        &tbl_ref,
        quote,
        table_created,
    )
    .await
}

async fn add_new_columns(
    drv: &dyn DatabaseDriver,
    params: &crate::models::ConnectionParams,
    req: &ClipboardImportRequest,
    schema_ref: Option<&str>,
    tbl_ref: &str,
    quote: &str,
) -> Result<(), String> {
    for col in &req.add_columns {
        let null_clause = if col.is_nullable { "" } else { " NOT NULL" };
        let sql = format!(
            "ALTER TABLE {} ADD COLUMN {} {}{}",
            tbl_ref,
            quote_identifier(&col.name, quote),
            col.data_type,
            null_clause,
        );
        drv.execute_query(params, &sql, None, 1, schema_ref)
            .await
            .map_err(|e| format!("Failed to add column '{}': {e}", col.name))?;
    }
    Ok(())
}

async fn insert_rows(
    drv: &dyn DatabaseDriver,
    params: &crate::models::ConnectionParams,
    req: &ClipboardImportRequest,
    schema_ref: Option<&str>,
    tbl_ref: &str,
    quote: &str,
    table_created: bool,
) -> Result<ClipboardImportResult, String> {
    if req.rows.is_empty() {
        return Ok(ClipboardImportResult { rows_inserted: 0, table_created });
    }

    let col_list = req
        .columns
        .iter()
        .map(|c| quote_identifier(&c.name, quote))
        .collect::<Vec<_>>()
        .join(", ");

    const BATCH_SIZE: usize = 500;
    let mut rows_inserted = 0;

    for chunk in req.rows.chunks(BATCH_SIZE) {
        let values_clauses: Vec<String> = chunk.iter().map(|r| row_to_values_clause(r)).collect();
        let insert_sql = format!(
            "INSERT INTO {} ({}) VALUES {}",
            tbl_ref,
            col_list,
            values_clauses.join(", ")
        );

        drv.execute_query(params, &insert_sql, None, 1, schema_ref)
            .await
            .map_err(|e| format!("Failed to insert rows (batch starting at {}): {e}", rows_inserted))?;

        rows_inserted += chunk.len();
    }

    log::info!("Clipboard import complete: {} rows inserted into {}", rows_inserted, tbl_ref);
    Ok(ClipboardImportResult { rows_inserted, table_created })
}

#[cfg(test)]
#[path = "clipboard_import_tests.rs"]
mod tests;
