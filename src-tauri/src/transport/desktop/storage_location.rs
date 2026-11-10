use crate::storage_location::*;
use std::fs;

/// Reveal the folder currently in use in the system file manager.
#[tauri::command]
pub fn open_storage_location(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = crate::paths::get_app_config_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("Failed to open storage folder: {e}"))
}

#[tauri::command]
pub fn get_storage_location() -> StorageLocationInfo {
    crate::storage_location::get_storage_location()
}

#[tauri::command]
pub fn inspect_storage_location(path: String) -> Result<StorageLocationInspection, String> {
    crate::storage_location::inspect_storage_location(path)
}

/// Record `path` as the storage folder, optionally copying the current data
/// into it. Takes effect on the next launch.
#[tauri::command]
pub fn set_storage_location(path: String, copy_data: bool) -> Result<StorageLocationInfo, String> {
    crate::storage_location::set_storage_location(path, copy_data)
}

/// Go back to the platform default folder on the next launch. Data in the
/// custom folder is left untouched.
#[tauri::command]
pub fn reset_storage_location() -> Result<StorageLocationInfo, String> {
    crate::storage_location::reset_storage_location()
}

/// Absolute data directory, for the frontend to build `asset://` URLs of
/// connection icons. Replaces `appDataDir()` from the Tauri JS API, which
/// knows nothing about the custom location.
#[tauri::command]
pub fn get_app_data_dir() -> String {
    crate::storage_location::get_app_data_dir()
}
