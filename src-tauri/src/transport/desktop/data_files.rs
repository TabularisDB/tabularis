//! Data files handed to the app by the operating system: "Open with" from a
//! file manager, a path on the command line, or a second launch forwarded by
//! the single-instance plugin.

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Tells the frontend that files are waiting in [`PendingDataFiles`].
pub const OPEN_DATA_FILES_EVENT: &str = "tabularis://open-data-files";

/// Files waiting for the frontend to open them. A cold start delivers them
/// before the webview listens, so they are kept until it asks.
#[derive(Default)]
pub struct PendingDataFiles(Mutex<Vec<String>>);

/// Queues `files` for the frontend and brings the main window forward.
pub fn queue<R: Runtime>(app: &AppHandle<R>, files: Vec<PathBuf>) {
    if files.is_empty() {
        return;
    }
    log::info!("Opening {} data file(s) passed by the system", files.len());
    if let Some(pending) = app.try_state::<PendingDataFiles>() {
        if let Ok(mut pending) = pending.0.lock() {
            pending.extend(files.iter().map(|file| file.to_string_lossy().into_owned()));
        }
    }
    if let Err(error) = app.emit(OPEN_DATA_FILES_EVENT, ()) {
        log::error!("Failed to emit {OPEN_DATA_FILES_EVENT}: {error}");
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Hands the waiting files to the frontend, once.
#[tauri::command]
pub fn consume_pending_data_files(state: tauri::State<'_, PendingDataFiles>) -> Vec<String> {
    state
        .0
        .lock()
        .map(|mut pending| std::mem::take(&mut *pending))
        .unwrap_or_default()
}
