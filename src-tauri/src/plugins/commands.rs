use std::fs;

use crate::drivers::driver_trait::PluginManifest;
use crate::plugins::installer::{self, InstalledPluginInfo};
use crate::plugins::registry::{PluginReadme, RegistryPluginWithStatus};
use crate::runtime::RuntimeContext;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn fetch_plugin_registry(
    runtime: State<'_, RuntimeContext>,
) -> Result<Vec<RegistryPluginWithStatus>, String> {
    crate::application::plugins::fetch_plugin_registry(runtime.inner()).await
}

#[tauri::command]
pub async fn install_plugin(
    runtime: State<'_, RuntimeContext>,
    plugin_id: String,
    version: Option<String>,
) -> Result<(), String> {
    crate::application::plugins::install_plugin(runtime.inner(), plugin_id, version).await
}

#[tauri::command]
pub fn cancel_plugin_install(plugin_id: String) -> bool {
    crate::application::plugins::cancel_plugin_install(plugin_id).unwrap_or(false)
}

#[tauri::command]
pub async fn uninstall_plugin(
    runtime: State<'_, RuntimeContext>,
    plugin_id: String,
) -> Result<(), String> {
    crate::application::plugins::uninstall_plugin(runtime.inner(), plugin_id).await
}

#[tauri::command]
pub async fn get_installed_plugins(
    runtime: State<'_, RuntimeContext>,
) -> Result<Vec<InstalledPluginInfo>, String> {
    Ok(crate::application::plugins::get_installed_plugins(
        runtime.inner(),
    ))
}

#[tauri::command]
pub async fn disable_plugin(plugin_id: String) -> Result<(), String> {
    crate::application::plugins::disable_plugin(plugin_id).await
}

#[tauri::command]
pub async fn enable_plugin(
    runtime: State<'_, RuntimeContext>,
    plugin_id: String,
) -> Result<(), String> {
    crate::application::plugins::enable_plugin(runtime.inner(), plugin_id).await
}

#[tauri::command]
pub async fn get_plugin_manifest(
    runtime: State<'_, RuntimeContext>,
    plugin_id: String,
) -> Result<PluginManifest, String> {
    crate::application::plugins::get_plugin_manifest(runtime.inner(), plugin_id)
}

/// Returns the absolute filesystem path of an installed plugin's directory.
/// Desktop-only: browser RPC deliberately does not expose server filesystem paths.
#[tauri::command]
pub fn get_plugin_dir(plugin_id: String) -> Result<String, String> {
    let plugins_dir = installer::get_plugins_dir()?;
    let plugin_dir = plugins_dir.join(&plugin_id);
    if !plugin_dir.exists() {
        return Err(format!("Plugin '{}' is not installed", plugin_id));
    }
    plugin_dir
        .to_str()
        .ok_or_else(|| "Plugin path contains invalid UTF-8".to_string())
        .map(str::to_string)
}

/// Opens the plugins directory in the desktop file manager.
/// Browser sessions never receive an equivalent server-path operation.
#[tauri::command]
pub fn open_plugins_dir(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let plugins_dir = installer::get_plugins_dir()?;
    app.opener()
        .open_path(plugins_dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|error| format!("Failed to open plugins directory: {error}"))
}

#[tauri::command]
pub async fn fetch_tabularium_plugin_preview(
    runtime: State<'_, RuntimeContext>,
    slug: String,
    registry_url: Option<String>,
    version: Option<String>,
) -> Result<RegistryPluginWithStatus, String> {
    crate::application::plugins::fetch_plugin_preview(runtime.inner(), slug, registry_url, version)
        .await
}

#[tauri::command]
pub async fn fetch_plugin_readme(
    runtime: State<'_, RuntimeContext>,
    slug: String,
    locale: Option<String>,
    registry_url: Option<String>,
) -> Result<PluginReadme, String> {
    crate::application::plugins::fetch_plugin_readme(runtime.inner(), slug, locale, registry_url)
        .await
}

/// Reads a file from an installed plugin's directory for the desktop UI loader.
/// Browser plugin assets use the authenticated asset route implemented separately.
#[tauri::command]
pub fn read_plugin_file(plugin_id: String, file_path: String) -> Result<String, String> {
    if file_path.contains("..") || file_path.starts_with('/') || file_path.starts_with('\\') {
        return Err(
            "Invalid file path: must be relative and contain no '..' components".to_string(),
        );
    }
    let plugins_dir = installer::get_plugins_dir()?;
    let full_path = plugins_dir.join(&plugin_id).join(&file_path);
    fs::read_to_string(&full_path).map_err(|error| {
        format!(
            "Failed to read '{}' from plugin '{}': {}",
            file_path, plugin_id, error
        )
    })
}
