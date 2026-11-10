use crate::export::*;
use crate::runtime::RuntimeContext;
use std::path::PathBuf;
use tauri::State;

#[tauri::command]
pub async fn cancel_export(
    state: State<'_, std::sync::Arc<ExportCancellationState>>,
    connection_id: String,
) -> Result<(), String> {
    crate::application::generic_exports::cancel_export(state.inner(), None, &connection_id)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn export_query_to_file(
    runtime: State<'_, RuntimeContext>,
    state: State<'_, std::sync::Arc<ExportCancellationState>>,
    connection_id: String,
    query: String,
    file_path: String,
    format: String,
    csv_delimiter: Option<String>,
    database: Option<String>,
    session_id: Option<String>,
) -> Result<Option<crate::application::connection_files::GeneratedFile>, String> {
    crate::application::generic_exports::export_query(
        runtime.inner(),
        state.inner(),
        None,
        connection_id,
        query,
        crate::application::generic_exports::ExportDestination::ServerPath(PathBuf::from(
            file_path,
        )),
        format,
        csv_delimiter,
        database,
        session_id,
    )
    .await
}
