use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EditorPreferences {
    pub tabs: Vec<serde_json::Value>,
    pub active_tab_id: Option<String>,
}

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

#[tauri::command]
pub async fn list_all_preferences(
    app: AppHandle,
) -> Result<HashMap<String, EditorPreferences>, String> {
    let preferences_dir = app
        .state::<crate::runtime::RuntimeContext>()
        .paths
        .config_dir()
        .join("preferences");
    if !preferences_dir.exists() {
        return Ok(HashMap::new());
    }

    let mut preferences = HashMap::new();
    for entry in std::fs::read_dir(preferences_dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let Some(connection_id) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if let Some(value) = crate::application::persistence::load_editor_preferences_for_desktop(
            &app.state::<crate::runtime::RuntimeContext>(),
            &connection_id,
        )? {
            preferences.insert(connection_id, value);
        }
    }
    Ok(preferences)
}
