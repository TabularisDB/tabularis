mod format;
mod progress;
mod sink;

#[cfg(test)]
mod tests;

pub use format::{parse_csv_delimiter, value_to_csv_string, ExportFormat, DEFAULT_CSV_DELIMITER};
pub use progress::{ProgressEmitter, DEFAULT_INTERVAL as DEFAULT_PROGRESS_INTERVAL};
pub use sink::{CsvSink, JsonSink, RowSink};

use std::collections::HashMap;
use std::fs::File;
use std::io::BufWriter;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Runtime, State};

use crate::commands::{
    expand_ssh_connection_params, find_connection_by_id, register_abort_handle,
    resolve_connection_params_with_id, unregister_abort_handle, AbortHandleMap,
};
use crate::drivers::{mysql, postgres, sqlite};
use crate::models::ConnectionParams;

pub struct ExportCancellationState {
    pub handles: Arc<Mutex<AbortHandleMap>>,
}

impl Default for ExportCancellationState {
    fn default() -> Self {
        Self {
            handles: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[derive(Clone, Serialize)]
struct ExportProgressPayload {
    rows_processed: u64,
}

const EXPORT_PROGRESS_EVENT: &str = "export_progress";

fn sanitize_query(query: &str) -> String {
    query.trim().trim_end_matches(';').to_string()
}

#[tauri::command]
pub async fn cancel_export(
    state: State<'_, ExportCancellationState>,
    connection_id: String,
) -> Result<(), String> {
    let entries = {
        let mut handles = state.handles.lock().unwrap();
        handles.remove(&connection_id).unwrap_or_default()
    };
    for handle in entries {
        handle.abort();
    }
    Ok(())
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
    let sanitized_query = sanitize_query(&query);
    let saved_conn = find_connection_by_id(&app, &connection_id)?;
    let expanded_params = expand_ssh_connection_params(&app, &saved_conn.params).await?;
    let params = resolve_connection_params_with_id(&expanded_params, &connection_id)?;
    let driver = saved_conn.params.driver.clone();

    let export_format = ExportFormat::parse(&format)?;
    let delimiter = parse_csv_delimiter(csv_delimiter.as_deref());

    let app_for_task = app.clone();
    let task_connection_id = connection_id.clone();

    let task = tokio::spawn(async move {
        let file = File::create(&file_path).map_err(|e| e.to_string())?;
        let writer = BufWriter::new(file);
        run_export(
            app_for_task,
            &driver,
            &params,
            &sanitized_query,
            writer,
            export_format,
            delimiter,
        )
        .await
    });

    let abort_handle = Arc::new(task.abort_handle());
    register_abort_handle(
        &state.handles,
        task_connection_id.clone(),
        abort_handle.clone(),
    );

    let result = task.await;

    unregister_abort_handle(&state.handles, &task_connection_id, &abort_handle);

    match result {
        Ok(res) => res,
        Err(_) => Err("Export cancelled".into()),
    }
}

/// Wires the driver stream, the row sink, and the progress emitter together.
/// Kept as a free function so the spawned task body stays linear and the
/// pieces remain individually unit-testable.
async fn run_export<R: Runtime>(
    app: AppHandle<R>,
    driver: &str,
    params: &ConnectionParams,
    query: &str,
    writer: BufWriter<File>,
    format: ExportFormat,
    delimiter: u8,
) -> Result<(), String> {
    let app_for_progress = app.clone();
    let mut progress = ProgressEmitter::new(DEFAULT_PROGRESS_INTERVAL, move |count| {
        let _ = app_for_progress.emit(
            EXPORT_PROGRESS_EVENT,
            ExportProgressPayload {
                rows_processed: count,
            },
        );
    });

    match format {
        ExportFormat::Csv => {
            let mut sink = CsvSink::new(writer, delimiter);
            stream_to_sink(driver, params, query, &mut sink, &mut progress).await?;
            sink.finish()?;
        }
        ExportFormat::Json => {
            let mut sink = JsonSink::new(writer);
            stream_to_sink(driver, params, query, &mut sink, &mut progress).await?;
            sink.finish()?;
        }
    }

    progress.finish();
    Ok(())
}

async fn stream_to_sink<S, F>(
    driver: &str,
    params: &ConnectionParams,
    query: &str,
    sink: &mut S,
    progress: &mut ProgressEmitter<F>,
) -> Result<(), String>
where
    S: RowSink + Send,
    F: FnMut(u64) + Send,
{
    let mut on_row = |headers: &[String], values: &[Value]| -> Result<(), String> {
        sink.write_row(headers, values)?;
        progress.tick();
        Ok(())
    };

    match driver {
        "mysql" => mysql::export::stream_query(params, query, &mut on_row).await,
        "postgres" => postgres::export::stream_query(params, query, &mut on_row).await,
        "sqlite" => sqlite::export::stream_query(params, query, &mut on_row).await,
        other => Err(format!("Unsupported driver for export: {}", other)),
    }
}
