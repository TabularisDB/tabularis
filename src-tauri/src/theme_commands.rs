use crate::paths::{get_app_config_dir, get_default_app_data_dir};
use crate::theme_packages::{self, ThemeCatalog, ThemeContribution};
use serde_json::Value;
use tauri::{AppHandle, Emitter};

fn committed<T>(app: &AppHandle, result: Result<T, String>) -> Result<T, String> {
    let value = result?;
    if let Err(error) = app.emit("theme-catalog-changed", ()) {
        log::warn!("Personal theme change committed but refresh delivery failed: {error}");
    }
    Ok(value)
}

#[tauri::command]
pub fn get_theme_catalog() -> ThemeCatalog {
    theme_packages::read_theme_catalog(
        &get_app_config_dir(),
        &get_default_app_data_dir(),
        env!("CARGO_PKG_VERSION"),
    )
}

/// Legacy command names and argument names remain available. Raw metadata is
/// retained instead of round-tripping files through the historical Rust model.
#[tauri::command]
pub fn get_all_themes() -> Result<Vec<Value>, String> {
    get_theme_catalog()
        .themes
        .into_iter()
        .filter(|entry| !entry.read_only && entry.format == "legacy" && entry.editor.is_none())
        .map(|entry| {
            let mut value: Value =
                serde_json::from_str(&entry.source).map_err(|e| e.to_string())?;
            value["isPreset"] = Value::Bool(false);
            value["isReadOnly"] = Value::Bool(false);
            Ok(value)
        })
        .collect()
}

#[tauri::command]
pub fn get_theme(theme_id: String) -> Result<Value, String> {
    let entry = get_theme_catalog()
        .themes
        .into_iter()
        .find(|entry| entry.id == theme_id)
        .ok_or("Theme not found or unavailable")?;
    if entry.format != "legacy" || entry.editor.is_some() {
        return Err("Use get_theme_catalog for v1 definitions and independent snapshots".into());
    }
    let mut value: Value = serde_json::from_str(&entry.source).map_err(|e| e.to_string())?;
    value["isPreset"] = Value::Bool(entry.origin["kind"] == "builtin");
    value["isReadOnly"] = Value::Bool(entry.read_only);
    Ok(value)
}

#[tauri::command]
pub fn save_custom_theme(app: AppHandle, theme: Value) -> Result<(), String> {
    committed(
        &app,
        theme_packages::save_legacy_theme(&get_app_config_dir(), theme),
    )
}

#[tauri::command]
pub fn delete_custom_theme(app: AppHandle, theme_id: String) -> Result<(), String> {
    committed(
        &app,
        theme_packages::remove_personal_theme(&get_app_config_dir(), &theme_id),
    )
}

#[tauri::command]
pub fn import_theme(
    app: AppHandle,
    theme_json: String,
    name: Option<String>,
) -> Result<Value, String> {
    let result = if let Some(name) = name {
        theme_packages::import_legacy_theme_named(&get_app_config_dir(), &theme_json, &name)
    } else {
        theme_packages::import_legacy_theme(&get_app_config_dir(), &theme_json)
    };
    committed(&app, result)
}

#[tauri::command]
pub fn export_theme(theme_id: String) -> Result<String, String> {
    theme_packages::export_personal_theme(&get_app_config_dir(), &theme_id)
}

#[tauri::command]
pub fn create_personal_theme(
    app: AppHandle,
    name: String,
    source: String,
) -> Result<ThemeContribution, String> {
    committed(
        &app,
        theme_packages::create_personal_definition(&get_app_config_dir(), &name, &source),
    )
}

#[tauri::command]
pub fn create_personal_snapshot(
    app: AppHandle,
    name: String,
    source: String,
) -> Result<ThemeContribution, String> {
    committed(
        &app,
        theme_packages::create_personal_snapshot(&get_app_config_dir(), &name, &source),
    )
}

#[tauri::command]
pub fn update_personal_theme(
    app: AppHandle,
    theme_id: String,
    name: String,
    source: String,
    expected_revision: String,
) -> Result<ThemeContribution, String> {
    committed(
        &app,
        theme_packages::update_personal_definition(
            &get_app_config_dir(),
            &theme_id,
            &name,
            &source,
            &expected_revision,
        ),
    )
}

#[tauri::command]
pub fn update_personal_snapshot(
    app: AppHandle,
    theme_id: String,
    name: String,
    source: String,
    editor: Value,
    expected_revision: String,
) -> Result<ThemeContribution, String> {
    committed(
        &app,
        theme_packages::update_personal_snapshot(
            &get_app_config_dir(),
            &theme_id,
            &name,
            &source,
            editor,
            &expected_revision,
        ),
    )
}

#[tauri::command]
pub fn duplicate_personal_theme(
    app: AppHandle,
    theme_id: String,
    name: String,
    editor: Option<Value>,
) -> Result<ThemeContribution, String> {
    committed(
        &app,
        theme_packages::duplicate_personal_theme(
            &get_app_config_dir(),
            &get_default_app_data_dir(),
            env!("CARGO_PKG_VERSION"),
            &theme_id,
            &name,
            editor,
        ),
    )
}
