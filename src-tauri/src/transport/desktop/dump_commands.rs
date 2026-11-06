use crate::application::connection_files::GeneratedFile;
use crate::application::database_transfers::{self, DumpDestination, ImportSource, JobKind};
use crate::application::table_transfers::{self, TableTransferPlan, TableTransferResult};
use crate::table_transfer::{TableTransferCapabilities, TableTransferRequest};
use crate::dump_commands::*;
use crate::runtime::RuntimeContext;
use std::path::PathBuf;
use tauri::State;

#[tauri::command]
pub async fn cancel_dump(
    state: State<'_, std::sync::Arc<DumpCancellationState>>,
    connection_id: String,
) -> Result<(), String> {
    database_transfers::cancel_job(state.inner(), None, JobKind::Dump, &connection_id)
}

#[tauri::command]
pub async fn dump_database(
    runtime: State<'_, RuntimeContext>,
    state: State<'_, std::sync::Arc<DumpCancellationState>>,
    connection_id: String,
    file_path: String,
    options: DumpOptions,
    schema: Option<String>,
    database: Option<String>,
) -> Result<Option<GeneratedFile>, String> {
    database_transfers::dump_database(
        runtime.inner(),
        state.inner(),
        None,
        connection_id,
        DumpDestination::ServerPath(PathBuf::from(file_path)),
        options,
        schema,
        database,
    )
    .await
}

#[tauri::command]
pub async fn cancel_import(
    state: State<'_, std::sync::Arc<DumpCancellationState>>,
    connection_id: String,
) -> Result<(), String> {
    database_transfers::cancel_job(state.inner(), None, JobKind::Import, &connection_id)
}

#[tauri::command]
pub async fn import_database(
    runtime: State<'_, RuntimeContext>,
    state: State<'_, std::sync::Arc<DumpCancellationState>>,
    connection_id: String,
    file_path: String,
    schema: Option<String>,
    database: Option<String>,
) -> Result<(), String> {
    database_transfers::import_database(
        runtime.inner(),
        state.inner(),
        None,
        connection_id,
        ImportSource::ServerPath(PathBuf::from(file_path)),
        schema,
        database,
    )
    .await
}

#[tauri::command]
pub async fn get_table_transfer_capabilities() -> Result<TableTransferCapabilities, String> {
    Ok(table_transfers::get_capabilities())
}

#[tauri::command]
pub async fn plan_table_transfer(
    runtime: State<'_, RuntimeContext>,
    request: TableTransferRequest,
) -> Result<TableTransferPlan, String> {
    table_transfers::plan(runtime.inner(), None, request).await
}

#[tauri::command]
pub async fn run_table_transfer(
    runtime: State<'_, RuntimeContext>,
    state: State<'_, std::sync::Arc<DumpCancellationState>>,
    request: TableTransferRequest,
) -> Result<TableTransferResult, String> {
    table_transfers::run(runtime.inner(), state.inner(), None, request).await
}

#[tauri::command]
pub async fn cancel_table_transfer(
    state: State<'_, std::sync::Arc<DumpCancellationState>>,
    transfer_id: String,
) -> Result<(), String> {
    table_transfers::cancel(state.inner(), None, &transfer_id)
}
