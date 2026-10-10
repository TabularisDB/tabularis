use crate::application::notebooks::{execute, NotebookCommand};
use crate::paths::get_app_config_dir;

pub use crate::application::notebooks::NotebookMetadata;

#[tauri::command]
pub async fn create_notebook(
    connection_id: String,
    notebook_id: String,
    content: String,
) -> Result<(), String> {
    execute(
        &get_app_config_dir(),
        NotebookCommand::Create {
            connection_id,
            notebook_id,
            content,
        },
    )?;
    Ok(())
}

#[tauri::command]
pub async fn save_notebook(
    connection_id: String,
    notebook_id: String,
    content: String,
) -> Result<(), String> {
    execute(
        &get_app_config_dir(),
        NotebookCommand::Save {
            connection_id,
            notebook_id,
            content,
        },
    )?;
    Ok(())
}

#[tauri::command]
pub async fn load_notebook(
    connection_id: String,
    notebook_id: String,
) -> Result<Option<String>, String> {
    let value = execute(
        &get_app_config_dir(),
        NotebookCommand::Load {
            connection_id,
            notebook_id,
        },
    )?;
    serde_json::from_value(value).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn delete_notebook(connection_id: String, notebook_id: String) -> Result<(), String> {
    execute(
        &get_app_config_dir(),
        NotebookCommand::Delete {
            connection_id,
            notebook_id,
        },
    )?;
    Ok(())
}

#[tauri::command]
pub async fn rename_notebook(
    connection_id: String,
    notebook_id: String,
    title: String,
) -> Result<(), String> {
    execute(
        &get_app_config_dir(),
        NotebookCommand::Rename {
            connection_id,
            notebook_id,
            title,
        },
    )?;
    Ok(())
}

#[tauri::command]
pub async fn list_notebooks(connection_id: String) -> Result<Vec<NotebookMetadata>, String> {
    let value = execute(
        &get_app_config_dir(),
        NotebookCommand::List { connection_id },
    )?;
    serde_json::from_value(value).map_err(|error| error.to_string())
}
