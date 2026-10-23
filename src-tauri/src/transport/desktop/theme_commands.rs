use crate::application::themes::{self, LocalThemeArchive, ThemeCommand};
use crate::runtime::RuntimeContext;
use crate::theme_packages::ThemeCatalog;
use serde_json::Value;
use tauri::{AppHandle, Manager};

async fn execute(app: &AppHandle, command: ThemeCommand) -> Result<Value, String> {
    themes::execute(&app.state::<RuntimeContext>(), command).await
}

#[tauri::command]
pub fn get_theme_catalog(app: AppHandle) -> ThemeCatalog {
    themes::catalog(&app.state::<RuntimeContext>())
}

/// Legacy command names and argument names remain available. Raw metadata is
/// retained instead of round-tripping files through the historical Rust model.
#[tauri::command]
pub fn get_all_themes(app: AppHandle) -> Result<Vec<Value>, String> {
    crate::application::persistence::get_all_themes(&app.state::<RuntimeContext>())
}

#[tauri::command]
pub fn save_custom_theme(app: AppHandle, theme: Value) -> Result<(), String> {
    crate::application::persistence::save_custom_theme(&app.state::<RuntimeContext>(), theme)
}

#[tauri::command]
pub fn delete_custom_theme(app: AppHandle, theme_id: String) -> Result<(), String> {
    crate::application::persistence::delete_custom_theme(&app.state::<RuntimeContext>(), &theme_id)
}

#[tauri::command]
pub async fn import_theme(
    app: AppHandle,
    theme_json: String,
    name: Option<String>,
) -> Result<Value, String> {
    execute(&app, ThemeCommand::ImportTheme { theme_json, name }).await
}

#[tauri::command]
pub async fn export_theme(app: AppHandle, theme_id: String) -> Result<Value, String> {
    execute(&app, ThemeCommand::ExportTheme { theme_id }).await
}

#[tauri::command]
pub async fn create_personal_theme(
    app: AppHandle,
    name: String,
    source: String,
) -> Result<Value, String> {
    execute(&app, ThemeCommand::CreatePersonalTheme { name, source }).await
}

#[tauri::command]
pub async fn create_personal_snapshot(
    app: AppHandle,
    name: String,
    source: String,
) -> Result<Value, String> {
    execute(&app, ThemeCommand::CreatePersonalSnapshot { name, source }).await
}

#[tauri::command]
pub async fn update_personal_theme(
    app: AppHandle,
    theme_id: String,
    name: String,
    source: String,
    expected_revision: String,
) -> Result<Value, String> {
    execute(
        &app,
        ThemeCommand::UpdatePersonalTheme {
            theme_id,
            name,
            source,
            expected_revision,
        },
    )
    .await
}

#[tauri::command]
pub async fn update_personal_snapshot(
    app: AppHandle,
    theme_id: String,
    name: String,
    source: String,
    editor: Value,
    expected_revision: String,
) -> Result<Value, String> {
    execute(
        &app,
        ThemeCommand::UpdatePersonalSnapshot {
            theme_id,
            name,
            source,
            editor,
            expected_revision,
        },
    )
    .await
}

#[tauri::command]
pub async fn duplicate_personal_theme(
    app: AppHandle,
    theme_id: String,
    name: String,
    editor: Option<Value>,
) -> Result<Value, String> {
    execute(
        &app,
        ThemeCommand::DuplicatePersonalTheme {
            theme_id,
            name,
            editor,
        },
    )
    .await
}

#[tauri::command]
pub async fn install_local_theme_package(
    app: AppHandle,
    path: String,
    package_name: String,
    expected_digest: String,
) -> Result<Value, String> {
    execute(
        &app,
        ThemeCommand::InstallLocalPackage {
            archive: LocalThemeArchive::Path(path.into()),
            package_name,
            expected_digest,
        },
    )
    .await
}

#[tauri::command]
pub async fn fetch_theme_registry(
    app: AppHandle,
    package_name: Option<String>,
    expected_registry_key: Option<String>,
) -> Result<Value, String> {
    execute(
        &app,
        ThemeCommand::FetchRegistry {
            package_name,
            expected_registry_key,
        },
    )
    .await
}

/// Read-only details: never resolve a tracked download during discovery.
#[tauri::command]
pub async fn fetch_theme_package_detail(
    app: AppHandle,
    package_name: String,
    expected_registry_key: String,
    requested_registry_url: Option<String>,
) -> Result<Value, String> {
    execute(
        &app,
        ThemeCommand::FetchPackageDetail {
            package_name,
            expected_registry_key,
            requested_registry_url,
        },
    )
    .await
}

#[tauri::command]
pub async fn install_registry_theme(
    app: AppHandle,
    package_name: String,
    expected_registry_key: String,
    version: Option<String>,
) -> Result<Value, String> {
    execute(
        &app,
        ThemeCommand::InstallRegistryTheme {
            package_name,
            expected_registry_key,
            version,
        },
    )
    .await
}

#[tauri::command]
pub async fn set_theme_package_enabled(
    app: AppHandle,
    registry_key: String,
    package_name: String,
    enabled: bool,
) -> Result<Value, String> {
    execute(
        &app,
        ThemeCommand::SetPackageEnabled {
            registry_key,
            package_name,
            enabled,
        },
    )
    .await
}

/// Recovery is an explicit action, never a catalog-read or hydration side effect.
#[tauri::command]
pub async fn recover_theme_packages(app: AppHandle) -> Result<Value, String> {
    execute(&app, ThemeCommand::RecoverPackages).await
}

#[tauri::command]
pub async fn uninstall_theme_package(
    app: AppHandle,
    registry_key: String,
    package_name: String,
) -> Result<Value, String> {
    execute(
        &app,
        ThemeCommand::UninstallPackage {
            registry_key,
            package_name,
        },
    )
    .await
}
