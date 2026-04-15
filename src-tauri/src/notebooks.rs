use std::fs;
use std::path::PathBuf;

use crate::paths::get_app_config_dir;

/// Get the notebooks directory path
fn get_notebooks_dir() -> PathBuf {
    let mut config_dir = get_app_config_dir();
    config_dir.push("notebooks");
    config_dir
}

/// Get the notebook file path for a specific notebook ID
fn get_notebook_path(notebook_id: &str) -> PathBuf {
    let mut dir = get_notebooks_dir();
    dir.push(format!("{}.tabularis-notebook", notebook_id));
    dir
}

/// Ensure the notebooks directory exists
fn ensure_notebooks_dir() -> Result<(), String> {
    let dir = get_notebooks_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create notebooks directory: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn create_notebook(notebook_id: String, content: String) -> Result<(), String> {
    ensure_notebooks_dir()?;
    let path = get_notebook_path(&notebook_id);
    fs::write(&path, content).map_err(|e| format!("Failed to create notebook: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn save_notebook(notebook_id: String, content: String) -> Result<(), String> {
    ensure_notebooks_dir()?;
    let path = get_notebook_path(&notebook_id);
    fs::write(&path, content).map_err(|e| format!("Failed to save notebook: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn load_notebook(notebook_id: String) -> Result<Option<String>, String> {
    let path = get_notebook_path(&notebook_id);
    if !path.exists() {
        return Ok(None);
    }
    let content =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read notebook: {}", e))?;
    Ok(Some(content))
}

#[tauri::command]
pub async fn delete_notebook(notebook_id: String) -> Result<(), String> {
    let path = get_notebook_path(&notebook_id);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Failed to delete notebook: {}", e))?;
    }
    Ok(())
}
