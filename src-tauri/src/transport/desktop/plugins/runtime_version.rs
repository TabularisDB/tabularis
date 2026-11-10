use crate::plugins::runtime_version::*;

#[tauri::command]
pub fn get_plugin_runtime_warnings() -> Vec<PluginRuntimeWarning> {
    crate::plugins::runtime_version::get_plugin_runtime_warnings()
}
