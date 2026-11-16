use crate::connection_appearance::*;
use std::path::Path;
use tauri::AppHandle;

#[tauri::command]
pub async fn save_connection_icon(
    _app: AppHandle,
    connection_id: String,
    source_path: String,
) -> Result<String, String> {
    let data_dir = crate::paths::get_app_data_dir();
    let dest = data_dir.join("connection-icons");
    save_icon_impl(&dest, &connection_id, Path::new(&source_path)).map_err(|e| e.to_string())
}
