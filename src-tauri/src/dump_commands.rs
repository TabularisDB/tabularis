use crate::application::connection_files::GeneratedFile;
use crate::application::database_transfers::{self, DumpDestination, ImportSource, JobKind};
pub use crate::application::database_transfers::{DumpCancellationState, DumpOptions};
use crate::runtime::RuntimeContext;
use std::path::PathBuf;
use tauri::State;

#[tauri::command]
pub async fn cancel_dump(
    state: State<'_, DumpCancellationState>,
    connection_id: String,
) -> Result<(), String> {
    database_transfers::cancel_job(state.inner(), None, JobKind::Dump, &connection_id)
}

#[tauri::command]
pub async fn dump_database(
    runtime: State<'_, RuntimeContext>,
    state: State<'_, DumpCancellationState>,
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
    state: State<'_, DumpCancellationState>,
    connection_id: String,
) -> Result<(), String> {
    database_transfers::cancel_job(state.inner(), None, JobKind::Import, &connection_id)
}

#[tauri::command]
pub async fn import_database(
    runtime: State<'_, RuntimeContext>,
    state: State<'_, DumpCancellationState>,
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
