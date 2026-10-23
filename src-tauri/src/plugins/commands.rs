use crate::plugins::installer::{self};

pub fn cancel_plugin_install(plugin_id: String) -> bool {
    crate::application::plugins::cancel_plugin_install(plugin_id).unwrap_or(false)
}

pub async fn disable_plugin(plugin_id: String) -> Result<(), String> {
    crate::application::plugins::disable_plugin(plugin_id).await
}

/// Returns the absolute filesystem path of an installed plugin's directory.
/// Desktop-only: browser RPC deliberately does not expose server filesystem paths.
pub fn get_plugin_dir(plugin_id: String) -> Result<String, String> {
    let plugin_dir = installer::resolve_plugin_dir(&plugin_id)?;
    plugin_dir
        .to_str()
        .ok_or_else(|| "Plugin path contains invalid UTF-8".to_string())
        .map(str::to_string)
}

