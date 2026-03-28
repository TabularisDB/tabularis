use crate::commands::{find_connection_by_id, resolve_connection_params};
use crate::drivers::mysql::extract::extract_value as extract_mysql_value;
use crate::drivers::postgres::extract::extract_value as extract_postgres_value;
use crate::drivers::sqlite::extract::extract_value as extract_sqlite_value;
use crate::pool_manager::{get_mysql_pool, get_postgres_pool, get_sqlite_pool};
use futures::StreamExt;
use serde::Serialize;
use sqlx::{Column, Row};
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Runtime, State};
use tokio::task::AbortHandle;

pub struct ExportCancellationState {
    pub handles: Arc<Mutex<HashMap<String, AbortHandle>>>,
}

impl Default for ExportCancellationState {
    fn default() -> Self {
        Self {
            handles: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[derive(Clone, Serialize)]
struct ExportProgress {
    rows_processed: u64,
}

fn value_to_string(val: serde_json::Value) -> String {
    match val {
        serde_json::Value::String(s) => s,
        serde_json::Value::Null => "NULL".to_string(),
        v => v.to_string(),
    }
}

macro_rules! export_rows {
    ($rows:expr, $extract_fn:expr, $format:expr, $delimiter_byte:expr, $writer:expr, $app:expr) => {{
        let mut count = 0u64;

        if $format == "csv" {
            let mut csv_wtr = csv::WriterBuilder::new()
                .delimiter($delimiter_byte)
                .from_writer($writer);
            let mut headers_written = false;

            while let Some(row_res) = $rows.next().await {
                let row = row_res.map_err(|e| e.to_string())?;

                if !headers_written {
                    let headers: Vec<String> =
                        row.columns().iter().map(|c| c.name().to_string()).collect();
                    csv_wtr.write_record(&headers).map_err(|e| e.to_string())?;
                    headers_written = true;
                }

                let record: Vec<String> = (0..row.columns().len())
                    .map(|i| value_to_string($extract_fn(&row, i, None)))
                    .collect();
                csv_wtr.write_record(&record).map_err(|e| e.to_string())?;

                count += 1;
                if count % 100 == 0 {
                    $app.emit(
                        "export_progress",
                        ExportProgress {
                            rows_processed: count,
                        },
                    )
                    .unwrap_or(());
                }
            }
            csv_wtr.flush().map_err(|e| e.to_string())?;
        } else {
            let mut writer = $writer;
            writer.write_all(b"[").map_err(|e| e.to_string())?;
            let mut first = true;

            while let Some(row_res) = $rows.next().await {
                let row = row_res.map_err(|e| e.to_string())?;

                if !first {
                    writer.write_all(b",").map_err(|e| e.to_string())?;
                }
                first = false;

                let mut obj = serde_json::Map::new();
                let columns = row.columns();
                for i in 0..columns.len() {
                    let name = columns[i].name().to_string();
                    let val = $extract_fn(&row, i);
                    obj.insert(name, val);
                }
                serde_json::to_writer(&mut writer, &obj).map_err(|e| e.to_string())?;

                count += 1;
                if count % 100 == 0 {
                    $app.emit(
                        "export_progress",
                        ExportProgress {
                            rows_processed: count,
                        },
                    )
                    .unwrap_or(());
                }
            }
            writer.write_all(b"]").map_err(|e| e.to_string())?;
            writer.flush().map_err(|e| e.to_string())?;
        }

        Ok::<(), String>(())
    }};
}

#[tauri::command]
pub async fn cancel_export(
    state: State<'_, ExportCancellationState>,
    connection_id: String,
) -> Result<(), String> {
    let mut handles = state.handles.lock().unwrap();
    if let Some(handle) = handles.remove(&connection_id) {
        handle.abort();
        Ok(())
    } else {
        Ok(())
    }
}

#[tauri::command]
pub async fn export_query_to_file<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, ExportCancellationState>,
    connection_id: String,
    query: String,
    file_path: String,
    format: String,
    csv_delimiter: Option<String>,
) -> Result<(), String> {
    let sanitized_query = query.trim().trim_end_matches(';').to_string();
    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let params = resolve_connection_params(&saved_conn.params)?;
    let driver = saved_conn.params.driver.clone();

    let delimiter_byte = csv_delimiter.and_then(|d| d.bytes().next()).unwrap_or(b',');

    let task = tokio::spawn(async move {
        let file = File::create(&file_path).map_err(|e| e.to_string())?;
        let writer = BufWriter::new(file);

        match driver.as_str() {
            "mysql" => {
                let pool = get_mysql_pool(&params).await?;
                let mut rows = sqlx::query(&sanitized_query).fetch(&pool);
                export_rows!(
                    rows,
                    extract_mysql_value,
                    format,
                    delimiter_byte,
                    writer,
                    app
                )
            }
            "postgres" => {
                let pool = get_postgres_pool(&params).await?;
                let client = pool
                    .get()
                    .await
                    .map_err(|e| format!("failed to get postgres client: {:?}", e))?;

                let params: Vec<i32> = vec![];
                let mut rows = std::pin::pin!(client
                    .query_raw(&sanitized_query, &params)
                    .await
                    .map_err(|e| format!("failed to execute postgres query: {:?}", e))?);

                export_rows!(
                    rows,
                    extract_postgres_value,
                    format,
                    delimiter_byte,
                    writer,
                    app
                )
            }
            "sqlite" => {
                let pool = get_sqlite_pool(&params).await?;
                let mut rows = sqlx::query(&sanitized_query).fetch(&pool);
                export_rows!(
                    rows,
                    extract_sqlite_value,
                    format,
                    delimiter_byte,
                    writer,
                    app
                )
            }
            _ => Err("Unsupported driver".into()),
        }
    });

    let abort_handle = task.abort_handle();
    {
        let mut handles = state.handles.lock().unwrap();
        handles.insert(connection_id.clone(), abort_handle);
    }

    let result = task.await;

    {
        let mut handles = state.handles.lock().unwrap();
        handles.remove(&connection_id);
    }

    match result {
        Ok(res) => res,
        Err(_) => Err("Export cancelled".into()),
    }
}
