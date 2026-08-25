mod format;
mod progress;
mod sink;

#[cfg(test)]
mod tests;

pub use format::{parse_csv_delimiter, value_to_csv_string, ExportFormat, DEFAULT_CSV_DELIMITER};
pub use progress::{ProgressEmitter, DEFAULT_INTERVAL as DEFAULT_PROGRESS_INTERVAL};
pub use sink::{CsvSink, JsonSink, MarkdownSink, RowSink};

use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde_json::Value;
use tauri::State;

use crate::commands::AbortHandleMap;
use crate::drivers::{mysql, postgres, sqlite};
use crate::models::ConnectionParams;
use crate::runtime::RuntimeContext;

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

#[tauri::command]
pub async fn cancel_export(
    state: State<'_, ExportCancellationState>,
    connection_id: String,
) -> Result<(), String> {
    crate::application::generic_exports::cancel_export(state.inner(), None, &connection_id)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn export_query_to_file(
    runtime: State<'_, RuntimeContext>,
    state: State<'_, ExportCancellationState>,
    connection_id: String,
    query: String,
    file_path: String,
    format: String,
    csv_delimiter: Option<String>,
    database: Option<String>,
) -> Result<Option<crate::application::connection_files::GeneratedFile>, String> {
    crate::application::generic_exports::export_query(
        runtime.inner(),
        state.inner(),
        None,
        connection_id,
        query,
        crate::application::generic_exports::ExportDestination::ServerPath(PathBuf::from(
            file_path,
        )),
        format,
        csv_delimiter,
        database,
    )
    .await
}

/// Wires the driver stream, the row sink, and the progress emitter together.
pub async fn run_export<W, F>(
    driver: &str,
    params: &ConnectionParams,
    query: &str,
    writer: W,
    format: ExportFormat,
    delimiter: u8,
    on_progress: F,
) -> Result<(), String>
where
    W: Write + Send,
    F: FnMut(u64) + Send,
{
    let mut progress = ProgressEmitter::new(DEFAULT_PROGRESS_INTERVAL, on_progress);

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
        ExportFormat::Markdown => {
            let mut sink = MarkdownSink::new(writer);
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
        other => stream_query_via_plugin(other, params, query, &mut on_row).await,
    }
}

/// Streams a query for an external plugin driver by repeatedly calling its
/// paginated execution API and forwarding each row to the export sink.
async fn stream_query_via_plugin<F>(
    driver_id: &str,
    params: &ConnectionParams,
    query: &str,
    mut on_row: F,
) -> Result<(), String>
where
    F: FnMut(&[String], &[Value]) -> Result<(), String> + Send,
{
    const PAGE_SIZE: u32 = 1000;

    let driver = crate::drivers::registry::get_driver(driver_id)
        .await
        .ok_or_else(|| format!("Unsupported driver for export: {driver_id}"))?;

    let mut page: u32 = 1;
    loop {
        let result = driver
            .execute_query(params, query, Some(PAGE_SIZE), page, None)
            .await?;

        for row in &result.rows {
            on_row(&result.columns, row)?;
        }

        let fetched = result.rows.len() as u32;
        let has_more = result
            .pagination
            .as_ref()
            .map(|pagination| pagination.has_more)
            .unwrap_or(fetched >= PAGE_SIZE);

        if fetched == 0 || !has_more {
            break;
        }
        page += 1;
    }

    Ok(())
}
