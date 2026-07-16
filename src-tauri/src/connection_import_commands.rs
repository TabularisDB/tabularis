//! Tauri commands for importing connections from other installed SQL clients.
//!
//! Flow: `list_connection_import_sources` populates the picker;
//! `preview_connection_import` runs the chosen importer, caches the full
//! envelope (with secrets) in app state and returns a passwordless preview;
//! `apply_connection_import` converts the cached envelope per the user's
//! resolutions and merges it through `apply_export_payload`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Runtime};

use crate::commands::{apply_export_payload, get_config_path};
use crate::connection_import::{
    all_importers, analyzer, convert, expand_home, importer_by_id, tabularis, ImportEnvelope,
};
use crate::models::ExportPayload;
use crate::persistence;

/// Caches the most recent envelope per source so `apply` doesn't re-read the
/// keychain (and re-prompt) after `preview`.
#[derive(Default)]
pub struct ImportEnvelopeCache(pub Mutex<HashMap<String, ImportEnvelope>>);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSourceInfo {
    pub id: String,
    pub display_name: String,
    pub available: bool,
    pub connection_count: usize,
    pub reads_passwords_from_keychain: bool,
    /// True when the importer reads a user-picked export file (none today).
    pub needs_file: bool,
}

/// List every known source app with availability and connection counts.
#[tauri::command]
pub async fn list_connection_import_sources() -> Result<Vec<ImportSourceInfo>, String> {
    let mut sources = Vec::new();
    for importer in all_importers() {
        let available = importer.is_available().await;
        let connection_count = if available {
            importer.connection_count().await
        } else {
            0
        };
        sources.push(ImportSourceInfo {
            id: importer.id().to_string(),
            display_name: importer.display_name().to_string(),
            available,
            connection_count,
            reads_passwords_from_keychain: importer.reads_passwords_from_keychain(),
            needs_file: importer.import_file_types().is_some(),
        });
    }
    Ok(sources)
}

/// Run the importer and return a preview annotated against existing connections
/// and installed drivers. The full envelope (with secrets) is cached in state.
#[tauri::command]
pub async fn preview_connection_import<R: Runtime>(
    app: AppHandle<R>,
    cache: tauri::State<'_, ImportEnvelopeCache>,
    source_id: String,
    include_passwords: bool,
    file_path: Option<String>,
) -> Result<analyzer::ImportPreview, String> {
    let importer = importer_by_id(&source_id)
        .ok_or_else(|| format!("Unknown import source: {source_id}"))?;

    let file = file_path.map(PathBuf::from);
    let envelope = importer
        .import(include_passwords, file.as_deref())
        .await
        .map_err(|e| e.to_string())?;

    let existing = load_existing_connections(&app)?;
    let registered_ids = registered_driver_ids().await;
    let file_exists = |p: &str| PathBuf::from(expand_home(p)).exists();
    let preview = analyzer::analyze(&envelope, &existing, &registered_ids, &file_exists);

    cache
        .0
        .lock()
        .map_err(|_| "Import cache poisoned".to_string())?
        .insert(source_id, envelope);

    Ok(preview)
}

/// Apply the cached envelope for `source_id` using the user's resolutions.
#[tauri::command]
pub async fn apply_connection_import<R: Runtime>(
    app: AppHandle<R>,
    cache: tauri::State<'_, ImportEnvelopeCache>,
    source_id: String,
    resolutions: Vec<convert::ImportResolution>,
) -> Result<(), String> {
    let envelope = cache
        .0
        .lock()
        .map_err(|_| "Import cache poisoned".to_string())?
        .remove(&source_id)
        .ok_or_else(|| "No import preview found; run preview first".to_string())?;

    let registered_ids = registered_driver_ids().await;
    let existing_groups = load_existing_groups(&app)?;
    let payload = convert::build_payload(&envelope, &resolutions, &registered_ids, &existing_groups);

    apply_export_payload(app, payload).await
}

/// Preview a parsed Tabularis JSON export (already decrypted by the caller)
/// against existing connections, so the frontend can render the same per-item
/// group picker used for foreign-app imports.
#[tauri::command]
pub async fn preview_tabularis_import<R: Runtime>(
    app: AppHandle<R>,
    payload: ExportPayload,
) -> Result<analyzer::ImportPreview, String> {
    let existing = load_existing_connections(&app)?;
    let registered_ids = registered_driver_ids().await;
    Ok(tabularis::preview(&payload, &existing, &registered_ids))
}

/// Apply a Tabularis JSON export using the user's per-item resolutions,
/// preserving native fields and honouring group overrides.
#[tauri::command]
pub async fn apply_tabularis_import<R: Runtime>(
    app: AppHandle<R>,
    payload: ExportPayload,
    resolutions: Vec<convert::ImportResolution>,
) -> Result<(), String> {
    let existing_groups = load_existing_groups(&app)?;
    let built = tabularis::apply(&payload, &resolutions, &existing_groups);
    apply_export_payload(app, built).await
}

// MARK: - Helpers

async fn registered_driver_ids() -> Vec<String> {
    crate::drivers::registry::list_drivers()
        .await
        .into_iter()
        .map(|m| m.id)
        .collect()
}

fn load_existing_connections<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<Vec<crate::models::SavedConnection>, String> {
    let path = get_config_path(app)?;
    Ok(persistence::load_connections_file(&path)
        .unwrap_or_default()
        .connections)
}

fn load_existing_groups<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<Vec<crate::models::ConnectionGroup>, String> {
    let path = get_config_path(app)?;
    Ok(persistence::load_connections_file(&path)
        .unwrap_or_default()
        .groups)
}
