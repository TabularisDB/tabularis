use crate::application::connection_files::GeneratedFile;
use crate::application::database_transfers::{self, DumpDestination, ImportSource, JobKind};
use crate::application::table_row_transfers::{self, TableTransferPlan, TableTransferResult};
use crate::table_transfer::{TableTransferCapabilities, TableTransferRequest};
use crate::application::table_transfers;
use crate::dump_commands::*;
use crate::runtime::RuntimeContext;
use std::path::PathBuf;
use tauri::State;

#[tauri::command]
pub async fn get_database_sql_capabilities(
    runtime: State<'_, RuntimeContext>,
    connection_id: String,
) -> Result<Option<crate::drivers::driver_trait::DatabaseSqlCapabilities>, String> {
    database_transfers::database_sql_capabilities(runtime.inner(), None, &connection_id).await
}

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
    create_database: Option<bool>,
) -> Result<(), String> {
    database_transfers::import_database(
        runtime.inner(),
        state.inner(),
        None,
        connection_id,
        ImportSource::ServerPath(PathBuf::from(file_path)),
        schema,
        database,
        create_database.unwrap_or(false),
    )
    .await
}

#[tauri::command]
pub async fn get_table_transfer_capabilities() -> Result<TableTransferCapabilities, String> {
    Ok(table_row_transfers::get_capabilities())
}

#[tauri::command]
pub async fn plan_table_transfer(
    runtime: State<'_, RuntimeContext>,
    request: TableTransferRequest,
) -> Result<TableTransferPlan, String> {
    table_row_transfers::plan(runtime.inner(), None, request).await
}

#[tauri::command]
pub async fn run_table_transfer(
    runtime: State<'_, RuntimeContext>,
    state: State<'_, std::sync::Arc<DumpCancellationState>>,
    request: TableTransferRequest,
) -> Result<TableTransferResult, String> {
    table_row_transfers::run(runtime.inner(), state.inner(), None, request).await
}

#[tauri::command]
pub async fn cancel_table_transfer(
    state: State<'_, std::sync::Arc<DumpCancellationState>>,
    transfer_id: String,
) -> Result<(), String> {
    table_row_transfers::cancel(state.inner(), None, &transfer_id)
}

#[tauri::command]
pub async fn export_table_to_sql(
    runtime: State<'_, RuntimeContext>,
    state: State<'_, std::sync::Arc<crate::export::ExportCancellationState>>,
    connection_id: String,
    file_path: String,
    options: table_transfers::TableExportOptions,
) -> Result<table_transfers::TableExportResult, String> {
    table_transfers::export_table(
        runtime.inner(),
        state.inner(),
        None,
        connection_id,
        options,
        table_transfers::TableExportDestination::ServerPath(PathBuf::from(file_path)),
    )
    .await
}

#[tauri::command]
pub async fn read_table_sql_header(
    runtime: State<'_, RuntimeContext>,
    connection_id: String,
    file_path: String,
) -> Result<table_transfers::TableImportPreview, String> {
    table_transfers::preview_table_import(
        runtime.inner(),
        None,
        connection_id,
        table_transfers::TableImportSource::ServerPath(PathBuf::from(file_path)),
    )
    .await
}

#[tauri::command]
pub async fn import_table_from_sql(
    runtime: State<'_, RuntimeContext>,
    state: State<'_, std::sync::Arc<DumpCancellationState>>,
    connection_id: String,
    file_path: String,
    options: table_transfers::TableImportOptions,
) -> Result<table_transfers::TableImportResult, String> {
    table_transfers::import_table(
        runtime.inner(),
        state.inner(),
        None,
        connection_id,
        table_transfers::TableImportSource::ServerPath(PathBuf::from(file_path)),
        options,
    )
    .await
}

#[tauri::command]
pub async fn cancel_table_import(
    state: State<'_, std::sync::Arc<DumpCancellationState>>,
    connection_id: String,
) -> Result<(), String> {
    table_transfers::cancel_table_import(state.inner(), None, &connection_id)
}
