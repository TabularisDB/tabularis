use crate::theme_packages::{lifecycle, *};

/// Standalone import preview validates without creating a personal file.
#[tauri::command]
pub fn preview_theme_document(source: String, name: String) -> Result<ThemeContribution, String> {
    crate::theme_packages::commands::preview_theme_document(source, name)
}

#[tauri::command]
pub async fn preview_local_theme_package(
    path: String,
) -> Result<lifecycle::LocalThemePreview, String> {
    crate::theme_packages::commands::preview_local_theme_package(path).await
}

#[tauri::command]
pub fn cancel_theme_install(registry_key: String, package_name: String) -> bool {
    crate::theme_packages::commands::cancel_theme_install(registry_key, package_name)
}
