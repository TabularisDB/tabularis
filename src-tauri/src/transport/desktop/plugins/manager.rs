use crate::plugins::manager::*;
use tauri::AppHandle;

/// Load installed plugins at startup.
///
/// `enabled_ids` controls which plugins are started:
/// - `None`  → load all installed plugins (first-run or no preference saved).
/// - `Some(ids)` → load only the plugins whose directory name (= plugin ID) is in `ids`.
pub async fn load_plugins<R: tauri::Runtime>(app: &AppHandle<R>, enabled_ids: Option<&[String]>) {
    let plugin_configs = crate::transport::desktop::config::load_config_internal(app)
        .plugins
        .unwrap_or_default();
    load_plugins_with_configs(plugin_configs, enabled_ids).await;
}

#[tauri::command]
pub fn get_plugin_startup_errors() -> Vec<PluginLoadError> {
    crate::plugins::manager::get_plugin_startup_errors()
}
