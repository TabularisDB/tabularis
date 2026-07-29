use crate::logger::{LogEntry, SharedLogBuffer};
use serde::Deserialize;
use std::path::PathBuf;
use tauri::State;

#[derive(Debug, Deserialize)]
pub struct GetLogsRequest {
    limit: Option<usize>,
    level_filter: Option<String>,
}

#[tauri::command]
pub fn get_logs(log_buffer: State<SharedLogBuffer>, request: GetLogsRequest) -> Vec<LogEntry> {
    log::debug!(
        "Getting logs with limit: {:?}, filter: {:?}",
        request.limit,
        request.level_filter
    );
    let buffer = log_buffer.lock().unwrap();
    let entries = buffer.get_entries(request.limit, request.level_filter);
    log::debug!("Returning {} log entries", entries.len());
    entries
}

#[tauri::command]
pub fn clear_logs(log_buffer: State<SharedLogBuffer>) -> Result<(), String> {
    let mut buffer = log_buffer.lock().unwrap();
    buffer.clear();
    Ok(())
}

#[tauri::command]
pub fn get_log_settings(log_buffer: State<SharedLogBuffer>) -> LogSettings {
    let buffer = log_buffer.lock().unwrap();
    LogSettings {
        enabled: buffer.is_enabled(),
        max_size: buffer.get_max_size(),
        current_count: buffer.get_entries(None, None).len(),
    }
}

#[tauri::command]
pub fn set_log_enabled(log_buffer: State<SharedLogBuffer>, enabled: bool) -> Result<(), String> {
    let mut buffer = log_buffer.lock().unwrap();
    buffer.set_enabled(enabled);
    Ok(())
}

#[tauri::command]
pub fn set_log_max_size(log_buffer: State<SharedLogBuffer>, max_size: usize) -> Result<(), String> {
    if max_size == 0 || max_size > 10000 {
        return Err("Max size must be between 1 and 10000".to_string());
    }
    let mut buffer = log_buffer.lock().unwrap();
    buffer.set_max_size(max_size);
    Ok(())
}

#[derive(Debug, serde::Serialize)]
pub struct LogSettings {
    pub enabled: bool,
    pub max_size: usize,
    pub current_count: usize,
}

#[tauri::command]
pub fn export_logs(log_buffer: State<SharedLogBuffer>, file_path: String) -> Result<(), String> {
    let buffer = log_buffer.lock().unwrap();
    let entries = buffer.get_entries(None, None);

    if entries.is_empty() {
        return Err("No logs to export".to_string());
    }

    let mut content = String::new();
    content.push_str("Tabularis Application Logs\n");
    content.push_str("==========================\n\n");

    for entry in entries {
        content.push_str(&format!(
            "[{}] [{}] {}",
            entry.timestamp,
            entry.level.to_uppercase(),
            entry.message
        ));
        if let Some(target) = &entry.target {
            content.push_str(&format!(" (target: {})", target));
        }
        content.push('\n');
    }

    // Release the lock before writing
    drop(buffer);

    // Write to file synchronously
    let path = PathBuf::from(file_path);
    std::fs::write(&path, content).map_err(|e| format!("Failed to write log file: {}", e))?;

    log::info!("Logs exported to: {:?}", path);
    Ok(())
}

/// Lets the frontend record user-relevant events (e.g. a database pruned from
/// a connection's selection) in the activity log shown in Settings → Logs.
#[tauri::command]
pub fn log_frontend_event(level: String, message: String) {
    match level.as_str() {
        "error" => log::error!(target: "frontend", "{}", message),
        "warn" => log::warn!(target: "frontend", "{}", message),
        "debug" => log::debug!(target: "frontend", "{}", message),
        "trace" => log::trace!(target: "frontend", "{}", message),
        _ => log::info!(target: "frontend", "{}", message),
    }
}

#[tauri::command]
pub fn test_log() -> Result<(), String> {
    log::info!("Test log message from frontend");
    log::debug!("Debug test message: {}", 42);
    log::warn!("Warning test message");
    Ok(())
}
