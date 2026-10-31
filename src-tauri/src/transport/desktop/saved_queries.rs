use crate::application::productivity::{self, ProductivityCommand, SavedQueryVersion};
use crate::saved_queries::*;
use crate::saved_query_folders::SavedQueryFolder;
use serde_json::from_value;
use tauri::{AppHandle, Manager, Runtime};

#[tauri::command]
pub async fn get_saved_queries<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
) -> Result<Vec<SavedQuery>, String> {
    let runtime = app.state::<crate::runtime::RuntimeContext>();
    let config_dir = runtime.paths.config_dir();
    from_value(
        productivity::execute(
            config_dir,
            ProductivityCommand::GetSavedQueries { connection_id },
        )
        .await?,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn save_query<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    name: String,
    sql: String,
    database: Option<String>,
) -> Result<SavedQuery, String> {
    let runtime = app.state::<crate::runtime::RuntimeContext>();
    let config_dir = runtime.paths.config_dir();
    from_value(
        productivity::execute(
            config_dir,
            ProductivityCommand::SaveQuery {
                connection_id,
                name,
                sql,
                database,
            },
        )
        .await?,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn update_saved_query<R: Runtime>(
    app: AppHandle<R>,
    connection_id: Option<String>,
    id: String,
    name: String,
    sql: String,
    database: Option<String>,
) -> Result<SavedQuery, String> {
    let runtime = app.state::<crate::runtime::RuntimeContext>();
    let config_dir = runtime.paths.config_dir();
    from_value(
        productivity::execute(
            config_dir,
            ProductivityCommand::UpdateSavedQuery {
                connection_id,
                id,
                name,
                sql,
                database,
            },
        )
        .await?,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn delete_saved_query<R: Runtime>(
    app: AppHandle<R>,
    connection_id: Option<String>,
    id: String,
) -> Result<(), String> {
    let runtime = app.state::<crate::runtime::RuntimeContext>();
    let config_dir = runtime.paths.config_dir();
    productivity::execute(
        config_dir,
        ProductivityCommand::DeleteSavedQuery { connection_id, id },
    )
    .await?;
    Ok(())
}

/// Previous versions of a saved query, newest first.
#[tauri::command]
pub async fn get_saved_query_versions<R: Runtime>(
    app: AppHandle<R>,
    connection_id: Option<String>,
    id: String,
) -> Result<Vec<SavedQueryVersion>, String> {
    execute_typed(
        &app,
        ProductivityCommand::GetSavedQueryVersions { connection_id, id },
    )
    .await
}

/// Saves a previous version as the current content; the replaced content becomes a version.
#[tauri::command]
pub async fn restore_saved_query_version<R: Runtime>(
    app: AppHandle<R>,
    connection_id: Option<String>,
    id: String,
    version_id: String,
) -> Result<SavedQuery, String> {
    execute_typed(
        &app,
        ProductivityCommand::RestoreSavedQueryVersion {
            connection_id,
            id,
            version_id,
        },
    )
    .await
}

pub fn backfill_missing_database_for_connection<R: Runtime>(
    app: &AppHandle<R>,
    connection_id: &str,
    database: &str,
) -> Result<usize, String> {
    let runtime = app.state::<crate::runtime::RuntimeContext>();
    let config_dir = runtime.paths.config_dir();
    productivity::backfill_saved_queries_for_connection(config_dir, connection_id, database)
}

#[tauri::command]
pub async fn get_saved_query_folders<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
) -> Result<Vec<SavedQueryFolder>, String> {
    execute_typed(
        &app,
        ProductivityCommand::GetSavedQueryFolders { connection_id },
    )
    .await
}

#[tauri::command]
pub async fn create_saved_query_folder<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    name: String,
) -> Result<SavedQueryFolder, String> {
    execute_typed(
        &app,
        ProductivityCommand::CreateSavedQueryFolder {
            connection_id,
            name,
        },
    )
    .await
}

#[tauri::command]
pub async fn rename_saved_query_folder<R: Runtime>(
    app: AppHandle<R>,
    connection_id: Option<String>,
    id: String,
    name: String,
) -> Result<SavedQueryFolder, String> {
    execute_typed(
        &app,
        ProductivityCommand::RenameSavedQueryFolder {
            connection_id,
            id,
            name,
        },
    )
    .await
}

/// Only empty folders can be deleted; see `saved_query_folders::delete_folder`.
#[tauri::command]
pub async fn delete_saved_query_folder<R: Runtime>(
    app: AppHandle<R>,
    connection_id: Option<String>,
    id: String,
) -> Result<(), String> {
    execute_typed(
        &app,
        ProductivityCommand::DeleteSavedQueryFolder { connection_id, id },
    )
    .await
}

/// Moves a saved query into a folder, or to Unfiled when `folder_id` is null.
#[tauri::command]
pub async fn move_saved_query<R: Runtime>(
    app: AppHandle<R>,
    connection_id: Option<String>,
    id: String,
    folder_id: Option<String>,
) -> Result<(), String> {
    execute_typed(
        &app,
        ProductivityCommand::MoveSavedQuery {
            connection_id,
            id,
            folder_id,
        },
    )
    .await
}

async fn execute_typed<R: Runtime, T: serde::de::DeserializeOwned>(
    app: &AppHandle<R>,
    command: ProductivityCommand,
) -> Result<T, String> {
    let runtime = app.state::<crate::runtime::RuntimeContext>();
    from_value(productivity::execute(runtime.paths.config_dir(), command).await?)
        .map_err(|error| error.to_string())
}
