use crate::application::productivity::{self, ProductivityCommand};
use serde_json::from_value;
use tauri::{AppHandle, Manager, Runtime};

pub use crate::application::productivity::{SavedQuery, SavedQueryMeta};

#[tauri::command]
pub async fn get_saved_queries<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
) -> Result<Vec<SavedQuery>, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    from_value(
        productivity::execute(
            &config_dir,
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
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    from_value(
        productivity::execute(
            &config_dir,
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
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    from_value(
        productivity::execute(
            &config_dir,
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
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    productivity::execute(
        &config_dir,
        ProductivityCommand::DeleteSavedQuery { connection_id, id },
    )
    .await?;
    Ok(())
}

pub use crate::application::productivity::backfill_saved_query_metadata as backfill_missing_database;

pub fn backfill_missing_database_for_connection<R: Runtime>(
    app: &AppHandle<R>,
    connection_id: &str,
    database: &str,
) -> Result<usize, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    productivity::backfill_saved_queries_for_connection(&config_dir, connection_id, database)
}
