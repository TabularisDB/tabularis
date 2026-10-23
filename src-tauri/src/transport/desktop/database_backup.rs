use crate::database_backup::{self, DatabaseBackupStatus};
use crate::application::database_transfers::DumpCancellationState;
use crate::runtime::RuntimeContext;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn get_database_backup_status(runtime: State<'_, RuntimeContext>) -> Result<DatabaseBackupStatus, String> {
    database_backup::get_database_backup_status(runtime.inner()).await
}

#[tauri::command]
pub async fn run_database_backup_now(runtime: State<'_, RuntimeContext>, state: State<'_, Arc<DumpCancellationState>>) -> Result<String, String> {
    database_backup::run_database_backup_now(runtime.inner(), state.inner()).await
}

#[tauri::command]
pub async fn cancel_database_backup(state: State<'_, Arc<DumpCancellationState>>) -> Result<(), String> {
    database_backup::cancel_database_backup(state.inner()).await
}
