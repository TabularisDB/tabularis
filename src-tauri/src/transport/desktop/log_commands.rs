use crate::application::operations;
use crate::log_commands::*;
use crate::logger::{LogEntry, SharedLogBuffer};
use std::path::PathBuf;
use tauri::State;

#[tauri::command]
pub fn get_logs(log_buffer: State<SharedLogBuffer>, request: GetLogsRequest) -> Vec<LogEntry> {
    operations::get_logs(log_buffer.inner(), request)
}

#[tauri::command]
pub fn clear_logs(log_buffer: State<SharedLogBuffer>) -> Result<(), String> {
    operations::clear_logs(log_buffer.inner())
}

#[tauri::command]
pub fn get_log_settings(log_buffer: State<SharedLogBuffer>) -> LogSettings {
    operations::get_log_settings(log_buffer.inner())
}

#[tauri::command]
pub fn set_log_enabled(log_buffer: State<SharedLogBuffer>, enabled: bool) -> Result<(), String> {
    operations::set_log_enabled(log_buffer.inner(), enabled)
}

#[tauri::command]
pub fn set_log_max_size(log_buffer: State<SharedLogBuffer>, max_size: usize) -> Result<(), String> {
    operations::set_log_max_size(log_buffer.inner(), max_size)
}

#[tauri::command]
pub async fn export_logs(
    runtime: State<'_, crate::runtime::RuntimeContext>,
    log_buffer: State<'_, SharedLogBuffer>,
    file_path: String,
) -> Result<Option<crate::application::connection_files::GeneratedFile>, String> {
    let path = PathBuf::from(file_path);
    let result = crate::application::generic_exports::export_logs(
        runtime.inner(),
        log_buffer.inner().clone(),
        crate::application::generic_exports::ExportDestination::ServerPath(path.clone()),
    )
    .await?;
    log::info!("Logs exported to: {:?}", path);
    Ok(result)
}

/// Lets the frontend record user-relevant events (e.g. a database pruned from
/// a connection's selection) in the activity log shown in Settings → Logs.
#[tauri::command]
pub fn log_frontend_event(level: String, message: String) {
    crate::log_commands::log_frontend_event(level, message)
}

#[tauri::command]
pub fn test_log() -> Result<(), String> {
    crate::log_commands::test_log()
}
