use super::productivity::atomic_write;
use chrono::{DateTime, Utc};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

const NOTEBOOKS_DIR: &str = "notebooks";
const NOTEBOOK_EXTENSION: &str = ".tabularis-notebook";

static NOTEBOOK_STORAGE_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

#[cfg(test)]
#[path = "notebooks/tests.rs"]
mod tests;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NotebookMetadata {
    pub id: String,
    pub title: String,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug)]
pub enum NotebookCommand {
    Create {
        connection_id: String,
        notebook_id: String,
        content: String,
    },
    Save {
        connection_id: String,
        notebook_id: String,
        content: String,
    },
    Load {
        connection_id: String,
        notebook_id: String,
    },
    Delete {
        connection_id: String,
        notebook_id: String,
    },
    Rename {
        connection_id: String,
        notebook_id: String,
        title: String,
    },
    List {
        connection_id: String,
    },
}

pub fn execute(config_dir: &Path, command: NotebookCommand) -> Result<Value, String> {
    let _guard = NOTEBOOK_STORAGE_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let root = config_dir.join(NOTEBOOKS_DIR);

    match command {
        NotebookCommand::Create {
            connection_id,
            notebook_id,
            content,
        }
        | NotebookCommand::Save {
            connection_id,
            notebook_id,
            content,
        } => {
            write_in(&root, &connection_id, &notebook_id, &content)?;
            Ok(Value::Null)
        }
        NotebookCommand::Load {
            connection_id,
            notebook_id,
        } => json(load_in(&root, &connection_id, &notebook_id)?),
        NotebookCommand::Delete {
            connection_id,
            notebook_id,
        } => {
            delete_in(&root, &connection_id, &notebook_id)?;
            Ok(Value::Null)
        }
        NotebookCommand::Rename {
            connection_id,
            notebook_id,
            title,
        } => {
            rename_in(&root, &connection_id, &notebook_id, &title)?;
            Ok(Value::Null)
        }
        NotebookCommand::List { connection_id } => json(list_in(&root, &connection_id)?),
    }
}

fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err(format!("Invalid id: {id}"));
    }
    Ok(())
}

fn connection_dir(root: &Path, connection_id: &str) -> Result<PathBuf, String> {
    validate_id(connection_id)?;
    Ok(root.join(connection_id))
}

fn notebook_path(root: &Path, connection_id: &str, notebook_id: &str) -> Result<PathBuf, String> {
    validate_id(notebook_id)?;
    let dir = connection_dir(root, connection_id)?;
    Ok(dir.join(format!("{notebook_id}{NOTEBOOK_EXTENSION}")))
}

fn legacy_notebook_path(root: &Path, notebook_id: &str) -> Result<PathBuf, String> {
    validate_id(notebook_id)?;
    Ok(root.join(format!("{notebook_id}{NOTEBOOK_EXTENSION}")))
}

fn write_in(
    root: &Path,
    connection_id: &str,
    notebook_id: &str,
    content: &str,
) -> Result<(), String> {
    let path = notebook_path(root, connection_id, notebook_id)?;
    atomic_write(&path, content.as_bytes())
        .map_err(|error| format!("Failed to write notebook: {error}"))
}

fn load_in(root: &Path, connection_id: &str, notebook_id: &str) -> Result<Option<String>, String> {
    let path = notebook_path(root, connection_id, notebook_id)?;
    if path.exists() {
        let content = fs::read_to_string(&path)
            .map_err(|error| format!("Failed to read notebook: {error}"))?;
        return Ok(Some(content));
    }

    let legacy = legacy_notebook_path(root, notebook_id)?;
    if legacy.exists() {
        let content = fs::read_to_string(&legacy)
            .map_err(|error| format!("Failed to read notebook: {error}"))?;
        let directory = connection_dir(root, connection_id)?;
        fs::create_dir_all(&directory)
            .map_err(|error| format!("Failed to create notebooks directory: {error}"))?;
        if fs::rename(&legacy, &path).is_err() {
            atomic_write(&path, content.as_bytes())
                .map_err(|error| format!("Failed to migrate notebook: {error}"))?;
            let _ = fs::remove_file(&legacy);
        }
        return Ok(Some(content));
    }

    Ok(None)
}

fn delete_in(root: &Path, connection_id: &str, notebook_id: &str) -> Result<(), String> {
    let path = notebook_path(root, connection_id, notebook_id)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|error| format!("Failed to delete notebook: {error}"))?;
    }
    if let Ok(legacy) = legacy_notebook_path(root, notebook_id) {
        if legacy.exists() {
            let _ = fs::remove_file(&legacy);
        }
    }
    Ok(())
}

fn rename_in(
    root: &Path,
    connection_id: &str,
    notebook_id: &str,
    title: &str,
) -> Result<(), String> {
    let path = notebook_path(root, connection_id, notebook_id)?;
    if !path.exists() {
        return Err(format!("Notebook not found: {notebook_id}"));
    }
    let content =
        fs::read_to_string(&path).map_err(|error| format!("Failed to read notebook: {error}"))?;
    let mut value: Value = serde_json::from_str(&content)
        .map_err(|error| format!("Invalid notebook file: {error}"))?;
    let object = value
        .as_object_mut()
        .ok_or_else(|| "Notebook file is not a JSON object".to_string())?;
    object.insert("title".to_string(), Value::String(title.to_string()));
    let serialized = serde_json::to_vec_pretty(&value)
        .map_err(|error| format!("Failed to serialize notebook: {error}"))?;
    atomic_write(&path, &serialized).map_err(|error| format!("Failed to save notebook: {error}"))
}

fn list_in(root: &Path, connection_id: &str) -> Result<Vec<NotebookMetadata>, String> {
    let directory = connection_dir(root, connection_id)?;
    if !directory.exists() {
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(&directory)
        .map_err(|error| format!("Failed to read notebooks directory: {error}"))?;
    let mut notebooks = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let id = match path.file_name().and_then(|name| name.to_str()) {
            Some(name) if name.ends_with(NOTEBOOK_EXTENSION) => {
                name.trim_end_matches(NOTEBOOK_EXTENSION).to_string()
            }
            _ => continue,
        };
        let content = match fs::read_to_string(&path) {
            Ok(content) => content,
            Err(_) => continue,
        };
        let value: Value = match serde_json::from_str(&content) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let title = value
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("Notebook")
            .to_string();
        let created_at = value
            .get("createdAt")
            .and_then(Value::as_str)
            .map(str::to_string);
        let updated_at = entry
            .metadata()
            .ok()
            .and_then(|metadata| metadata.modified().ok())
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
    let datetime: DateTime<Utc> = time.into();
    datetime.to_rfc3339()
}

fn json<T: Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|error| error.to_string())
}
