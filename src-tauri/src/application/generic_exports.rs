use super::connection_files::GeneratedFile;
use super::file_transfers::{FileTransferStore, MAX_FILE_TRANSFER_BYTES};
use crate::ai_activity::{self, EventFilter};
use crate::ai_notebook_export::{self, NotebookExport};
use crate::commands::{register_abort_handle, unregister_abort_handle};
use crate::export::{ExportCancellationState, ExportFormat};
use crate::logger::SharedLogBuffer;
use crate::models::DatabaseSelection;
use crate::runtime::RuntimeContext;
use serde::Deserialize;
use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio_util::io::ReaderStream;
use uuid::Uuid;

const QUERY_EXPORT_PURPOSE: &str = "query-export";
const LOG_EXPORT_PURPOSE: &str = "logs-export";
const TEXT_MIME_TYPE: &str = "text/plain";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GenericExportCommand {
    ExportQuery {
        connection_id: String,
        query: String,
        format: String,
        csv_delimiter: Option<String>,
        database: Option<String>,
    },
    CancelExport {
        connection_id: String,
    },
    ExportAiActivityJson,
    ExportAiActivityCsv,
    ExportAiSessionAsNotebook {
        session_id: String,
    },
    ExportLogs,
}

pub enum ExportDestination {
    ServerPath(PathBuf),
    SessionDownload(Uuid),
}

pub async fn execute(
    runtime: &RuntimeContext,
    state: &ExportCancellationState,
    session_id: Option<Uuid>,
    command: GenericExportCommand,
) -> Result<serde_json::Value, String> {
    match command {
        GenericExportCommand::ExportQuery {
            connection_id,
            query,
            format,
            csv_delimiter,
            database,
        } => {
            let owner = session_id.ok_or_else(|| "A browser session is required".to_string())?;
            json(
                export_query(
                    runtime,
                    state,
                    session_id,
                    connection_id,
                    query,
                    ExportDestination::SessionDownload(owner),
                    format,
                    csv_delimiter,
                    database,
                )
                .await?
                .ok_or_else(|| "The browser export did not create a download".to_string())?,
            )
        }
        GenericExportCommand::CancelExport { connection_id } => {
            cancel_export(state, session_id, &connection_id)?;
            Ok(serde_json::Value::Null)
        }
        GenericExportCommand::ExportAiActivityJson => json(generate_ai_activity_json().await?),
        GenericExportCommand::ExportAiActivityCsv => json(generate_ai_activity_csv().await?),
        GenericExportCommand::ExportAiSessionAsNotebook { session_id } => {
            json(generate_ai_session_notebook(session_id).await?)
        }
        GenericExportCommand::ExportLogs => {
            let owner = session_id.ok_or_else(|| "A browser session is required".to_string())?;
            json(
                export_logs(
                    runtime,
                    crate::runtime::bootstrap::get_log_buffer(),
                    ExportDestination::SessionDownload(owner),
                )
                .await?
                .ok_or_else(|| "The browser log export did not create a download".to_string())?,
            )
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub async fn export_query(
    runtime: &RuntimeContext,
    state: &ExportCancellationState,
    session_id: Option<Uuid>,
    connection_id: String,
    query: String,
    destination: ExportDestination,
    format: String,
    csv_delimiter: Option<String>,
    database: Option<String>,
) -> Result<Option<GeneratedFile>, String> {
    let query = sanitize_query(&query);
    if query.is_empty() {
        return Err("Export query cannot be empty".to_string());
    }
    let export_format = ExportFormat::parse(&format)?;
    let delimiter = crate::export::parse_csv_delimiter(csv_delimiter.as_deref());
    let extension = export_format.extension();
    let mime_type = export_format.mime_type();
    let (driver, mut params) =
        super::connections::resolve_saved_connection_params(runtime, session_id, &connection_id)?;
    if let Some(database) = database {
        params.database = DatabaseSelection::Single(database);
    }

    let (file_path, download_owner, temporary) = match destination {
        ExportDestination::ServerPath(path) => (path, None, None),
        ExportDestination::SessionDownload(owner) => {
            let directory = runtime.paths.data_dir().join("query-export-jobs");
            create_private_directory(&directory)?;
            let path = directory.join(format!(".pending-{}.{}", Uuid::new_v4(), extension));
            let temporary = TemporaryFile::new(path.clone());
            (path, Some(owner), Some(temporary))
        }
    };

    let runtime_for_task = runtime.clone();
    let connection_for_task = connection_id.clone();
    let task_path = file_path.clone();
    let enforce_browser_limit = download_owner.is_some();
    let task = tokio::spawn(async move {
        let writer = BufWriter::new(create_private_file(&task_path)?);
        let writer = if enforce_browser_limit {
            ExportWriter::Limited(LimitedWriter::new(writer, MAX_FILE_TRANSFER_BYTES))
        } else {
            ExportWriter::Plain(writer)
        };
        let progress_runtime = runtime_for_task.clone();
        let progress_connection = connection_for_task.clone();
        crate::export::run_export(
            &driver,
            &params,
            &query,
            writer,
            export_format,
            delimiter,
            move |rows_processed| {
                let payload = serde_json::json!({
                    "connection_id": progress_connection,
                    "rows_processed": rows_processed,
                });
                let _ = match session_id {
                    Some(owner) => {
                        progress_runtime
                            .events
                            .emit_to(owner, "export_progress", payload)
                    }
                    None => progress_runtime.events.emit("export_progress", payload),
                };
            },
        )
        .await
    });
    let mut registration = ExportRegistration::new(
        state.handles.clone(),
        export_key(session_id, &connection_id),
        Arc::new(task.abort_handle()),
    );
    let result = task.await;
    registration.complete();
    match result {
        Ok(result) => result?,
        Err(error) if error.is_cancelled() => return Err("Export cancelled".to_string()),
        Err(error) => return Err(format!("Export task failed: {error}")),
    }

    let Some(owner) = download_owner else {
        return Ok(None);
    };
    let file = tokio::fs::File::open(&file_path)
        .await
        .map_err(|error| error.to_string())?;
    let metadata = FileTransferStore::new(runtime.paths.data_dir())
        .store_download(
            owner,
            QUERY_EXPORT_PURPOSE,
            &format!("result.{extension}"),
            Some(mime_type),
            ReaderStream::new(file),
        )
        .await?;
    drop(temporary);
    Ok(Some(GeneratedFile::Download {
        file_name: metadata.file_name,
        mime_type: metadata.mime_type,
        token: metadata.token,
        size: metadata.size,
    }))
}

pub fn cancel_export(
    state: &ExportCancellationState,
    session_id: Option<Uuid>,
    connection_id: &str,
) -> Result<(), String> {
    let handles = state
        .handles
        .lock()
        .map_err(|_| "Export cancellation state is unavailable".to_string())?
        .remove(&export_key(session_id, connection_id))
        .unwrap_or_default();
    for handle in handles {
        handle.abort();
    }
    Ok(())
}

pub fn cancel_session_exports(state: &ExportCancellationState, session_id: Uuid) {
    let prefix = format!("{session_id}:");
    let handles = {
        let mut registered = state
            .handles
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let keys = registered
            .keys()
            .filter(|key| key.starts_with(&prefix))
            .cloned()
            .collect::<Vec<_>>();
        keys.into_iter()
            .flat_map(|key| registered.remove(&key).unwrap_or_default())
            .collect::<Vec<_>>()
    };
    for handle in handles {
        handle.abort();
    }
}

pub async fn generate_ai_activity_json() -> Result<String, String> {
    let events = tokio::task::spawn_blocking(|| ai_activity::read_events(&EventFilter::default()))
        .await
        .map_err(|error| error.to_string())??;
    let timezone = display_timezone();
    let mut output = String::new();
    for mut event in events {
        event.timestamp = ai_activity::to_local_rfc3339(&event.timestamp, timezone.as_deref());
        output.push_str(&serde_json::to_string(&event).map_err(|error| error.to_string())?);
        output.push('\n');
    }
    Ok(output)
}

pub async fn generate_ai_activity_csv() -> Result<String, String> {
    let events = tokio::task::spawn_blocking(|| ai_activity::read_events(&EventFilter::default()))
        .await
        .map_err(|error| error.to_string())??;
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer
        .write_record([
            "id",
            "session_id",
            "timestamp",
            "tool",
            "connection_id",
            "connection_name",
            "query",
            "query_kind",
            "duration_ms",
            "status",
            "rows",
            "error",
            "client_hint",
            "approval_id",
        ])
        .map_err(|error| error.to_string())?;
    let timezone = display_timezone();
    for event in events {
        writer
            .write_record([
                event.id,
                event.session_id,
                ai_activity::to_local_rfc3339(&event.timestamp, timezone.as_deref()),
                event.tool,
                event.connection_id.unwrap_or_default(),
                event.connection_name.unwrap_or_default(),
                event.query.unwrap_or_default(),
                event.query_kind.unwrap_or_default(),
                event.duration_ms.to_string(),
                event.status,
                event.rows.map(|rows| rows.to_string()).unwrap_or_default(),
                event.error.unwrap_or_default(),
                event.client_hint.unwrap_or_default(),
                event.approval_id.unwrap_or_default(),
            ])
            .map_err(|error| error.to_string())?;
    }
    let bytes = writer.into_inner().map_err(|error| error.to_string())?;
    String::from_utf8(bytes).map_err(|error| error.to_string())
}

pub async fn generate_ai_session_notebook(session_id: String) -> Result<NotebookExport, String> {
    let timezone = display_timezone();
    tokio::task::spawn_blocking(move || {
        ai_notebook_export::export_session(&session_id, timezone.as_deref())
    })
    .await
    .map_err(|error| error.to_string())?
}

pub async fn export_logs(
    runtime: &RuntimeContext,
    log_buffer: SharedLogBuffer,
    destination: ExportDestination,
) -> Result<Option<GeneratedFile>, String> {
    let (file_path, download_owner, temporary) = match destination {
        ExportDestination::ServerPath(path) => (path, None, None),
        ExportDestination::SessionDownload(owner) => {
            let directory = runtime.paths.data_dir().join("log-export-jobs");
            create_private_directory(&directory)?;
            let path = directory.join(format!(".pending-{}.log", Uuid::new_v4()));
            let temporary = TemporaryFile::new(path.clone());
            (path, Some(owner), Some(temporary))
        }
    };
    write_logs_to_path(&log_buffer, &file_path)?;

    let Some(owner) = download_owner else {
        return Ok(None);
    };
    let file = tokio::fs::File::open(&file_path)
        .await
        .map_err(|error| error.to_string())?;
    let metadata = FileTransferStore::new(runtime.paths.data_dir())
        .store_download(
            owner,
            LOG_EXPORT_PURPOSE,
            "tabularis-logs.log",
            Some(TEXT_MIME_TYPE),
            ReaderStream::new(file),
        )
        .await?;
    drop(temporary);
    Ok(Some(GeneratedFile::Download {
        file_name: metadata.file_name,
        mime_type: metadata.mime_type,
        token: metadata.token,
        size: metadata.size,
    }))
}

pub fn write_logs_to_path(log_buffer: &SharedLogBuffer, path: &Path) -> Result<(), String> {
    let entries = log_buffer
        .lock()
        .map_err(|_| "Log buffer is unavailable".to_string())?
        .get_entries(None, None);
    if entries.is_empty() {
        return Err("No logs to export".to_string());
    }
    let mut writer = BufWriter::new(create_private_file(path)?);
    writer
        .write_all(b"Tabularis Application Logs\n==========================\n\n")
        .map_err(|error| format!("Failed to write log file: {error}"))?;
    for entry in entries {
        write!(
            writer,
            "[{}] [{}] {}",
            entry.timestamp,
            entry.level.to_uppercase(),
            entry.message
        )
        .map_err(|error| format!("Failed to write log file: {error}"))?;
        if let Some(target) = entry.target {
            write!(writer, " (target: {target})")
                .map_err(|error| format!("Failed to write log file: {error}"))?;
        }
        writeln!(writer).map_err(|error| format!("Failed to write log file: {error}"))?;
    }
    writer
        .flush()
        .map_err(|error| format!("Failed to write log file: {error}"))
}

fn display_timezone() -> Option<String> {
    crate::config::load_config_from_disk().display_timezone
}

fn sanitize_query(query: &str) -> String {
    query.trim().trim_end_matches(';').to_string()
}

fn export_key(session_id: Option<Uuid>, connection_id: &str) -> String {
    session_id.map_or_else(
        || connection_id.to_string(),
        |session_id| format!("{session_id}:{connection_id}"),
    )
}

fn create_private_directory(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn create_private_file(path: &Path) -> Result<File, String> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options
        .open(path)
        .map_err(|error| format!("Failed to create export file: {error}"))
}

enum ExportWriter<W> {
    Plain(W),
    Limited(LimitedWriter<W>),
}

impl<W: Write> Write for ExportWriter<W> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        match self {
            Self::Plain(writer) => writer.write(bytes),
            Self::Limited(writer) => writer.write(bytes),
        }
    }

    fn flush(&mut self) -> std::io::Result<()> {
        match self {
            Self::Plain(writer) => writer.flush(),
            Self::Limited(writer) => writer.flush(),
        }
    }
}

struct LimitedWriter<W> {
    inner: W,
    written: u64,
    limit: u64,
}

impl<W> LimitedWriter<W> {
    fn new(inner: W, limit: u64) -> Self {
        Self {
            inner,
            written: 0,
            limit,
        }
    }
}

impl<W: Write> Write for LimitedWriter<W> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        let next = self
            .written
            .checked_add(bytes.len() as u64)
            .ok_or_else(|| std::io::Error::other("Export size overflow"))?;
        if next > self.limit {
            return Err(std::io::Error::other(format!(
                "Export exceeds the {} byte browser download limit",
                self.limit
            )));
        }
        let written = self.inner.write(bytes)?;
        self.written += written as u64;
        Ok(written)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}

struct ExportRegistration {
    handles: Arc<std::sync::Mutex<crate::commands::AbortHandleMap>>,
    key: String,
    handle: Arc<tokio::task::AbortHandle>,
    completed: bool,
}

impl ExportRegistration {
    fn new(
        handles: Arc<std::sync::Mutex<crate::commands::AbortHandleMap>>,
        key: String,
        handle: Arc<tokio::task::AbortHandle>,
    ) -> Self {
        register_abort_handle(&handles, key.clone(), handle.clone());
        Self {
            handles,
            key,
            handle,
            completed: false,
        }
    }

    fn complete(&mut self) {
        unregister_abort_handle(&self.handles, &self.key, &self.handle);
        self.completed = true;
    }
}

impl Drop for ExportRegistration {
    fn drop(&mut self) {
        unregister_abort_handle(&self.handles, &self.key, &self.handle);
        if !self.completed {
            self.handle.abort();
        }
    }
}

struct TemporaryFile(PathBuf);

impl TemporaryFile {
    fn new(path: PathBuf) -> Self {
        Self(path)
    }
}

impl Drop for TemporaryFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn json<T: serde::Serialize>(value: T) -> Result<serde_json::Value, String> {
    serde_json::to_value(value).map_err(|error| error.to_string())
}

#[cfg(test)]
#[path = "generic_exports_tests.rs"]
mod tests;
