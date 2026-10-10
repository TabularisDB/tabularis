use crate::application::productivity::{self, ProductivityCommand};
use serde_json::from_value;
use tauri::{AppHandle, Manager, Runtime, State};

pub use crate::application::productivity::backfill_history_entries as backfill_missing_database;
#[cfg(test)]
pub(crate) use crate::application::productivity::{atomic_write, backup_corrupt_file};
pub use crate::application::productivity::{QueryHistoryEntry, QueryHistoryResponse};

/// Kept as managed Tauri state for command signature compatibility. Storage
/// serialization is shared by desktop and web in the application service.
#[derive(Default)]
pub struct QueryHistoryState;

#[tauri::command]
pub async fn get_query_history<R: Runtime>(
    app: AppHandle<R>,
    _state: State<'_, QueryHistoryState>,
    connection_id: String,
) -> Result<QueryHistoryResponse, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    from_value(
        productivity::execute(
            &config_dir,
            ProductivityCommand::GetQueryHistory { connection_id },
        )
        .await?,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn add_query_history_entry<R: Runtime>(
    app: AppHandle<R>,
    _state: State<'_, QueryHistoryState>,
    connection_id: String,
    sql: String,
    executed_at: String,
    execution_time_ms: Option<f64>,
    status: String,
    rows_affected: Option<i64>,
    error: Option<String>,
    database: Option<String>,
) -> Result<QueryHistoryEntry, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    from_value(
        productivity::execute(
            &config_dir,
            ProductivityCommand::AddQueryHistoryEntry {
                connection_id,
                sql,
                executed_at,
                execution_time_ms,
                status,
                rows_affected,
                error,
                database,
            },
        )
        .await?,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn delete_query_history_entry<R: Runtime>(
    app: AppHandle<R>,
    _state: State<'_, QueryHistoryState>,
    connection_id: String,
    id: String,
) -> Result<(), String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    productivity::execute(
        &config_dir,
        ProductivityCommand::DeleteQueryHistoryEntry { connection_id, id },
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn clear_query_history<R: Runtime>(
    app: AppHandle<R>,
    _state: State<'_, QueryHistoryState>,
    connection_id: String,
) -> Result<(), String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    productivity::execute(
        &config_dir,
        ProductivityCommand::ClearQueryHistory { connection_id },
    )
    .await?;
    Ok(())
}

pub async fn backfill_missing_database_for_connection<R: Runtime>(
    app: &AppHandle<R>,
    connection_id: &str,
    database: &str,
) -> Result<usize, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    productivity::backfill_query_history_for_connection(&config_dir, connection_id, database)
}

pub async fn remove_history_for_connection<R: Runtime>(
    app: &AppHandle<R>,
    connection_id: &str,
) -> Result<(), String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    productivity::remove_query_history_for_connection(&config_dir, connection_id)
}
