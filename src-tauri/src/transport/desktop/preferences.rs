use crate::preferences::*;
use tauri::{AppHandle, Manager};

#[tauri::command]
pub async fn save_editor_preferences(
    app: AppHandle,
    connection_id: String,
    preferences: EditorPreferences,
) -> Result<(), String> {
    crate::application::persistence::save_editor_preferences_for_desktop(
        &app.state::<crate::runtime::RuntimeContext>(),
        &connection_id,
        &preferences,
    )
}

#[tauri::command]
pub async fn load_editor_preferences(
    app: AppHandle,
    connection_id: String,
) -> Result<Option<EditorPreferences>, String> {
    crate::application::persistence::load_editor_preferences_for_desktop(
        &app.state::<crate::runtime::RuntimeContext>(),
        &connection_id,
    )
}

#[tauri::command]
pub async fn delete_editor_preferences(
    app: AppHandle,
    connection_id: String,
) -> Result<(), String> {
    crate::application::persistence::delete_editor_preferences_for_desktop(
        &app.state::<crate::runtime::RuntimeContext>(),
        &connection_id,
    )
}
