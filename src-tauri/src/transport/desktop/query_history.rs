use crate::application::productivity::{self, ProductivityCommand};
use crate::query_history::*;
use serde_json::from_value;
use tauri::{AppHandle, Manager, Runtime};

#[tauri::command]
pub async fn get_query_history<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
) -> Result<QueryHistoryResponse, String> {
    let runtime = app.state::<crate::runtime::RuntimeContext>();
    let config_dir = runtime.paths.config_dir();
    from_value(
        productivity::execute(
            config_dir,
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
    connection_id: String,
    sql: String,
    executed_at: String,
    execution_time_ms: Option<f64>,
    status: String,
    rows_affected: Option<i64>,
    error: Option<String>,
    database: Option<String>,
) -> Result<QueryHistoryEntry, String> {
    let runtime = app.state::<crate::runtime::RuntimeContext>();
    let config_dir = runtime.paths.config_dir();
    from_value(
        productivity::execute(
            config_dir,
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
    connection_id: String,
    id: String,
) -> Result<(), String> {
    let runtime = app.state::<crate::runtime::RuntimeContext>();
    let config_dir = runtime.paths.config_dir();
    productivity::execute(
        config_dir,
        ProductivityCommand::DeleteQueryHistoryEntry { connection_id, id },
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn clear_query_history<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
) -> Result<(), String> {
    let runtime = app.state::<crate::runtime::RuntimeContext>();
    let config_dir = runtime.paths.config_dir();
    productivity::execute(
        config_dir,
        ProductivityCommand::ClearQueryHistory { connection_id },
    )
    .await?;
    Ok(())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn get_query_history_insights<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    database: Option<String>,
    window_hours: Option<u32>,
    dialect: Option<String>,
    now: Option<String>,
    max_groups: Option<usize>,
    max_executions_per_group: Option<usize>,
) -> Result<QueryHistoryInsightsResponse, String> {
    let runtime = app.state::<crate::runtime::RuntimeContext>();
    let config_dir = runtime.paths.config_dir();
    from_value(
        productivity::execute(
            config_dir,
            ProductivityCommand::GetQueryHistoryInsights {
                request: QueryHistoryInsightsRequest {
                    connection_id,
                    database,
                    window_hours,
                    dialect,
                    now,
                    max_groups,
                    max_executions_per_group,
                },
            },
        )
        .await?,
    )
    .map_err(|error| error.to_string())
}

pub async fn backfill_missing_database_for_connection<R: Runtime>(
    app: &AppHandle<R>,
    connection_id: &str,
    database: &str,
) -> Result<usize, String> {
    let runtime = app.state::<crate::runtime::RuntimeContext>();
    let config_dir = runtime.paths.config_dir();
    productivity::backfill_query_history_for_connection(config_dir, connection_id, database)
}

pub async fn remove_history_for_connection<R: Runtime>(
    app: &AppHandle<R>,
    connection_id: &str,
) -> Result<(), String> {
    let runtime = app.state::<crate::runtime::RuntimeContext>();
    let config_dir = runtime.paths.config_dir();
    productivity::remove_query_history_for_connection(config_dir, connection_id)
}
