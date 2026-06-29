use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::Serialize;

use crate::paths::get_app_config_dir;

#[cfg(test)]
mod tests;

/// Metadata describing a saved notebook, used to populate the
/// "saved notebooks" list without loading full cell contents.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotebookMetadata {
    pub id: String,
    pub title: String,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

/// Reject ids that could escape the notebooks directory. Notebook and
/// connection ids are generated internally and never contain separators,
/// so anything that does is treated as malformed input.
fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err(format!("Invalid id: {}", id));
    }
    Ok(())
}

/// Root notebooks directory: `<config>/notebooks`.
fn get_notebooks_dir() -> PathBuf {
    let mut config_dir = get_app_config_dir();
    config_dir.push("notebooks");
    config_dir
}

/// Per-connection notebooks directory: `<root>/<connectionId>`.
fn connection_dir(root: &Path, connection_id: &str) -> Result<PathBuf, String> {
    validate_id(connection_id)?;
    Ok(root.join(connection_id))
}

/// Path to a notebook file: `<root>/<connectionId>/<id>.tabularis-notebook`.
fn notebook_path(root: &Path, connection_id: &str, notebook_id: &str) -> Result<PathBuf, String> {
    validate_id(notebook_id)?;
    let dir = connection_dir(root, connection_id)?;
    Ok(dir.join(format!("{}.tabularis-notebook", notebook_id)))
}

/// Legacy flat path (pre per-connection layout): `<root>/<id>.tabularis-notebook`.
fn legacy_notebook_path(root: &Path, notebook_id: &str) -> Result<PathBuf, String> {
    validate_id(notebook_id)?;
    Ok(root.join(format!("{}.tabularis-notebook", notebook_id)))
}

// --- Core implementation (directory-injectable for testing) ---

fn write_in(root: &Path, connection_id: &str, notebook_id: &str, content: &str) -> Result<(), String> {
    let dir = connection_dir(root, connection_id)?;
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create notebooks directory: {}", e))?;
    let path = notebook_path(root, connection_id, notebook_id)?;
    fs::write(&path, content).map_err(|e| format!("Failed to write notebook: {}", e))?;
    Ok(())
}

fn load_in(root: &Path, connection_id: &str, notebook_id: &str) -> Result<Option<String>, String> {
    let path = notebook_path(root, connection_id, notebook_id)?;
    if path.exists() {
        let content =
            fs::read_to_string(&path).map_err(|e| format!("Failed to read notebook: {}", e))?;
        return Ok(Some(content));
    }

    // Lazily migrate a legacy flat notebook into the per-connection layout the
    // first time it is opened. The owning connection is the one whose tab
    // references it, which is exactly the caller here.
    let legacy = legacy_notebook_path(root, notebook_id)?;
    if legacy.exists() {
        let content =
            fs::read_to_string(&legacy).map_err(|e| format!("Failed to read notebook: {}", e))?;
        let dir = connection_dir(root, connection_id)?;
        fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create notebooks directory: {}", e))?;
        // Move rather than copy so the flat file does not linger as a duplicate.
        if fs::rename(&legacy, &path).is_err() {
            // Cross-device or other rename failure — fall back to copy + delete.
            fs::write(&path, &content)
                .map_err(|e| format!("Failed to migrate notebook: {}", e))?;
            let _ = fs::remove_file(&legacy);
        }
        return Ok(Some(content));
    }

    Ok(None)
}

fn delete_in(root: &Path, connection_id: &str, notebook_id: &str) -> Result<(), String> {
    let path = notebook_path(root, connection_id, notebook_id)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Failed to delete notebook: {}", e))?;
    }
    // Also clear any leftover legacy flat file.
    if let Ok(legacy) = legacy_notebook_path(root, notebook_id) {
        if legacy.exists() {
            let _ = fs::remove_file(&legacy);
        }
    }
    Ok(())
}

fn rename_in(root: &Path, connection_id: &str, notebook_id: &str, title: &str) -> Result<(), String> {
    let path = notebook_path(root, connection_id, notebook_id)?;
    if !path.exists() {
        return Err(format!("Notebook not found: {}", notebook_id));
    }
    let content =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read notebook: {}", e))?;
    let mut value: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("Invalid notebook file: {}", e))?;
    match value.as_object_mut() {
        Some(obj) => {
            obj.insert("title".to_string(), serde_json::Value::String(title.to_string()));
        }
        None => return Err("Notebook file is not a JSON object".to_string()),
    }
    let serialized = serde_json::to_string_pretty(&value)
        .map_err(|e| format!("Failed to serialize notebook: {}", e))?;
    fs::write(&path, serialized).map_err(|e| format!("Failed to save notebook: {}", e))?;
    Ok(())
}

fn list_in(root: &Path, connection_id: &str) -> Result<Vec<NotebookMetadata>, String> {
    let dir = connection_dir(root, connection_id)?;
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let entries =
        fs::read_dir(&dir).map_err(|e| format!("Failed to read notebooks directory: {}", e))?;

    let mut notebooks = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let id = match path.file_name().and_then(|n| n.to_str()) {
            Some(name) if name.ends_with(".tabularis-notebook") => {
                name.trim_end_matches(".tabularis-notebook").to_string()
            }
            _ => continue,
        };

        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let value: serde_json::Value = match serde_json::from_str(&content) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let title = value
            .get("title")
            .and_then(|t| t.as_str())
            .unwrap_or("Notebook")
            .to_string();
        let created_at = value
            .get("createdAt")
            .and_then(|t| t.as_str())
            .map(|s| s.to_string());
        let updated_at = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .map(system_time_to_rfc3339);

        notebooks.push(NotebookMetadata {
            id,
            title,
            created_at,
            updated_at,
        });
    }

    Ok(notebooks)
}

fn system_time_to_rfc3339(time: SystemTime) -> String {
    let datetime: chrono::DateTime<chrono::Utc> = time.into();
    datetime.to_rfc3339()
}

// --- Tauri command wrappers ---

#[tauri::command]
pub async fn create_notebook(
    connection_id: String,
    notebook_id: String,
    content: String,
) -> Result<(), String> {
    write_in(&get_notebooks_dir(), &connection_id, &notebook_id, &content)
}

#[tauri::command]
pub async fn save_notebook(
    connection_id: String,
    notebook_id: String,
    content: String,
) -> Result<(), String> {
    write_in(&get_notebooks_dir(), &connection_id, &notebook_id, &content)
}

#[tauri::command]
pub async fn load_notebook(
    connection_id: String,
    notebook_id: String,
) -> Result<Option<String>, String> {
    load_in(&get_notebooks_dir(), &connection_id, &notebook_id)
}

#[tauri::command]
pub async fn delete_notebook(connection_id: String, notebook_id: String) -> Result<(), String> {
    delete_in(&get_notebooks_dir(), &connection_id, &notebook_id)
}

/// Rename a saved notebook by patching the `title` field in place, without
/// touching cell contents. Works on notebooks that are not currently open.
#[tauri::command]
pub async fn rename_notebook(
    connection_id: String,
    notebook_id: String,
    title: String,
) -> Result<(), String> {
    rename_in(&get_notebooks_dir(), &connection_id, &notebook_id, &title)
}

/// List all saved notebooks for a connection. Reads each file's `title` and
/// `createdAt`; uses the filesystem modification time as `updatedAt`.
#[tauri::command]
pub async fn list_notebooks(connection_id: String) -> Result<Vec<NotebookMetadata>, String> {
    list_in(&get_notebooks_dir(), &connection_id)
}
