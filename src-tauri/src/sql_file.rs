//! Read and write SQL files opened in editor tabs.
//!
//! The paths come from the native file dialogs (or from tabs restored across
//! app restarts), so the IO goes through Rust instead of the `fs` plugin: the
//! plugin's capability scope only covers app data and the runtime scope the
//! dialog grants is lost when the app restarts.

use std::path::{Path, PathBuf};

use tokio::task::spawn_blocking;

/// Maximum size of a SQL file that can be loaded into an editor tab.
pub const MAX_SQL_FILE_BYTES: u64 = 50 * 1024 * 1024;

/// Validates a user-supplied SQL file path: it must be absolute and non-empty.
pub fn validate_sql_file_path(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("SQL file path is empty".to_string());
    }
    let path = Path::new(trimmed);
    if !path.is_absolute() {
        return Err(format!("SQL file path must be absolute: {}", trimmed));
    }
    Ok(path.to_path_buf())
}

/// Reads a SQL file, rejecting files above `max_bytes`.
pub fn read_sql_file_from_disk(path: &Path, max_bytes: u64) -> Result<String, String> {
    let metadata = std::fs::metadata(path)
        .map_err(|e| format!("Failed to read SQL file {}: {}", path.display(), e))?;
    if !metadata.is_file() {
        return Err(format!("{} is not a file", path.display()));
    }
    if metadata.len() > max_bytes {
        return Err(format!(
            "SQL file {} is too large ({} bytes, limit {} bytes)",
            path.display(),
            metadata.len(),
            max_bytes
        ));
    }
    std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read SQL file {}: {}", path.display(), e))
}

/// Writes `content` to `path`, creating the file if needed.
pub fn write_sql_file_to_disk(path: &Path, content: &str) -> Result<(), String> {
    std::fs::write(path, content)
        .map_err(|e| format!("Failed to write SQL file {}: {}", path.display(), e))
}

#[tauri::command]
pub async fn read_sql_file(path: String) -> Result<String, String> {
    let path = validate_sql_file_path(&path)?;
    spawn_blocking(move || read_sql_file_from_disk(&path, MAX_SQL_FILE_BYTES))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn write_sql_file(path: String, content: String) -> Result<(), String> {
    let path = validate_sql_file_path(&path)?;
    spawn_blocking(move || write_sql_file_to_disk(&path, &content))
        .await
        .map_err(|e| e.to_string())?
}
