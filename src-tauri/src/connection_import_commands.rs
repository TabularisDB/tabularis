//! Desktop transport wrappers for shared connection import and export services.

use tauri::{AppHandle, Manager, Runtime};

use crate::application::connection_files::{
    self, ConnectionExportMode, ConnectionImportFile, GeneratedFile, ImportSourceInfo,
    TabularisImportPreviewResult,
};
use crate::connection_import::{analyzer, convert};
use crate::models::ExportPayload;

pub use crate::application::connection_files::ImportEnvelopeCache;

#[tauri::command]
pub async fn export_connections_file<R: Runtime>(
    app: AppHandle<R>,
    mode: ConnectionExportMode,
    password: Option<String>,
    connection_ids: Option<Vec<String>>,
) -> Result<GeneratedFile, String> {
    connection_files::generate_export_file(
        app.state::<crate::runtime::RuntimeContext>().inner(),
        None,
        mode,
        password,
        connection_ids,
    )
    .await
}

#[tauri::command]
pub async fn list_connection_import_sources() -> Result<Vec<ImportSourceInfo>, String> {
    connection_files::list_import_sources().await
}

#[tauri::command]
pub async fn preview_connection_import<R: Runtime>(
    app: AppHandle<R>,
    cache: tauri::State<'_, ImportEnvelopeCache>,
    source_id: String,
    include_passwords: bool,
    file_path: Option<String>,
) -> Result<analyzer::ImportPreview, String> {
    connection_files::preview_foreign_import(
        app.state::<crate::runtime::RuntimeContext>().inner(),
        cache.inner(),
        None,
        source_id,
        include_passwords,
        file_path.map(|path| ConnectionImportFile::ServerPath { path }),
    )
    .await
}

#[tauri::command]
pub async fn apply_connection_import<R: Runtime>(
    app: AppHandle<R>,
    cache: tauri::State<'_, ImportEnvelopeCache>,
    connection_cache: tauri::State<'_, std::sync::Arc<crate::connection_cache::ConnectionCache>>,
    credential_cache: tauri::State<'_, std::sync::Arc<crate::credential_cache::CredentialCache>>,
    source_id: String,
    resolutions: Vec<convert::ImportResolution>,
) -> Result<(), String> {
    connection_files::apply_foreign_import(
        app.state::<crate::runtime::RuntimeContext>().inner(),
        connection_cache.inner().as_ref(),
        credential_cache.inner().as_ref(),
        cache.inner(),
        None,
        source_id,
        resolutions,
    )
    .await
}

#[tauri::command]
pub async fn preview_tabularis_import<R: Runtime>(
    app: AppHandle<R>,
    payload: ExportPayload,
) -> Result<analyzer::ImportPreview, String> {
    connection_files::preview_tabularis_payload(
        app.state::<crate::runtime::RuntimeContext>().inner(),
        &payload,
    )
    .await
}

#[tauri::command]
pub async fn apply_tabularis_import<R: Runtime>(
    app: AppHandle<R>,
    connection_cache: tauri::State<'_, std::sync::Arc<crate::connection_cache::ConnectionCache>>,
    credential_cache: tauri::State<'_, std::sync::Arc<crate::credential_cache::CredentialCache>>,
    payload: ExportPayload,
    resolutions: Vec<convert::ImportResolution>,
) -> Result<(), String> {
    let runtime = app.state::<crate::runtime::RuntimeContext>();
    let groups = crate::persistence::load_connections_file(&runtime.paths.connections_file())
        .unwrap_or_default()
        .groups;
    let payload = crate::connection_import::tabularis::apply(&payload, &resolutions, &groups);
    connection_files::apply_export_payload(
        &runtime,
        connection_cache.inner().as_ref(),
        credential_cache.inner().as_ref(),
        payload,
    )
    .await
}

#[tauri::command]
pub async fn preview_tabularis_import_file<R: Runtime>(
    app: AppHandle<R>,
    cache: tauri::State<'_, ImportEnvelopeCache>,
    file: ConnectionImportFile,
    password: Option<String>,
) -> Result<TabularisImportPreviewResult, String> {
    connection_files::preview_tabularis_import_file(
        app.state::<crate::runtime::RuntimeContext>().inner(),
        cache.inner(),
        None,
        file,
        password,
    )
    .await
}

#[tauri::command]
pub async fn apply_prepared_tabularis_import<R: Runtime>(
    app: AppHandle<R>,
    cache: tauri::State<'_, ImportEnvelopeCache>,
    connection_cache: tauri::State<'_, std::sync::Arc<crate::connection_cache::ConnectionCache>>,
    credential_cache: tauri::State<'_, std::sync::Arc<crate::credential_cache::CredentialCache>>,
    resolutions: Vec<convert::ImportResolution>,
) -> Result<(), String> {
    connection_files::apply_prepared_tabularis_import(
        app.state::<crate::runtime::RuntimeContext>().inner(),
        connection_cache.inner().as_ref(),
        credential_cache.inner().as_ref(),
        cache.inner(),
        None,
        resolutions,
    )
    .await
}
