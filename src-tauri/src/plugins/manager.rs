use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Mutex;

use directories::ProjectDirs;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::config::PluginConfig;
use crate::drivers::driver_trait::{DriverCapabilities, PluginManifest, PluginSettingDefinition};
use crate::models::DataTypeInfo;
use crate::plugins::driver::RpcDriver;

/// Errors that occurred during startup plugin loading, to be fetched by the frontend.
static STARTUP_ERRORS: Lazy<Mutex<Vec<PluginLoadError>>> = Lazy::new(|| Mutex::new(Vec::new()));

#[derive(Serialize, Clone)]
pub struct PluginLoadError {
    pub plugin_id: String,
    pub error: String,
}

#[tauri::command]
pub fn get_plugin_startup_errors() -> Vec<PluginLoadError> {
    let mut guard = STARTUP_ERRORS.lock().unwrap_or_else(|e| e.into_inner());
    std::mem::take(&mut *guard)
}

#[derive(Serialize, Deserialize)]
pub struct ConfigManifest {
    /// Legacy field; the canonical schema uses `name` as the identity/slug.
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    /// The registry guarantees `version` in the manifest (`.tabularium`).
    pub version: String,
    pub description: String,
    #[serde(default)]
    pub default_port: Option<u16>,
    #[serde(default)]
    pub capabilities: DriverCapabilities,
    #[serde(default)]
    pub data_types: Vec<DataTypeInfo>,
    /// Absent for UI-only plugins that ship no driver executable.
    #[serde(default)]
    pub executable: Option<String>,
    #[serde(default)]
    pub default_username: Option<String>,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub icon: String,
    /// Registry manifest `engine` — surfaced so the connection catalogue can
    /// group locally-installed plugins.
    #[serde(default)]
    pub engine: Option<String>,
    /// Registry manifest `paradigms`, primary first.
    #[serde(default)]
    pub paradigms: Vec<String>,
    #[serde(default)]
    pub interpreter: Option<String>,
    #[serde(default)]
    pub settings: Vec<PluginSettingDefinition>,
    #[serde(default)]
    pub ui_extensions: Option<Vec<crate::drivers::driver_trait::UIExtensionEntry>>,
}

/// Load installed plugins at startup.
///
/// `enabled_ids` controls which plugins are started:
/// - `None`  → load all installed plugins (first-run or no preference saved).
/// - `Some(ids)` → load only the plugins whose directory name (= plugin ID) is in `ids`.
pub async fn load_plugins<R: tauri::Runtime>(app: &AppHandle<R>, enabled_ids: Option<&[String]>) {
    let plugin_configs = crate::config::load_config_internal(app)
        .plugins
        .unwrap_or_default();
    load_plugins_with_configs(plugin_configs, enabled_ids).await;
}

/// Variant of [`load_plugins`] that takes plugin configs directly. Used by the
/// standalone `--mcp` subprocess which has no Tauri `AppHandle` but needs to
/// register the same drivers so MCP tools can reach plugin-driven connections.
pub async fn load_plugins_with_configs(
    plugin_configs: HashMap<String, PluginConfig>,
    enabled_ids: Option<&[String]>,
) {
    let proj_dirs = match ProjectDirs::from("com", "debba", "tabularis") {
        Some(d) => d,
        None => return,
    };

    let plugins_dir = proj_dirs.data_dir().join("plugins");

    if !plugins_dir.exists() {
        if let Err(e) = fs::create_dir_all(&plugins_dir) {
            log::error!("Failed to create plugins directory: {}", e);
            return;
        }
    }

    let entries = match fs::read_dir(&plugins_dir) {
        Ok(e) => e,
        Err(e) => {
            log::error!("Failed to read plugins directory: {}", e);
            return;
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        if let Some(enabled) = enabled_ids {
            if let Some(dir_name) = path.file_name().and_then(|n| n.to_str()) {
                if !enabled.iter().any(|id| id == dir_name) {
                    log::info!("Skipping disabled plugin: {}", dir_name);
                    continue;
                }
            }
        }

        let plugin_config = path
            .file_name()
            .and_then(|n| n.to_str())
            .and_then(|dir_name| plugin_configs.get(dir_name));

        let interpreter_override = plugin_config.and_then(|c| c.interpreter.clone());
        let settings = plugin_config
            .map(|c| c.settings.clone())
            .unwrap_or_default();

        if let Err(e) = load_plugin_from_dir(&path, interpreter_override, settings).await {
            log::error!("Failed to load plugin {:?}: {}", path, e);
            let plugin_id = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string();
            if let Ok(mut guard) = STARTUP_ERRORS.lock() {
                guard.push(PluginLoadError {
                    plugin_id,
                    error: e,
                });
            }
        }
    }
}

pub async fn load_plugin_from_dir(
    path: &Path,
    interpreter_override: Option<String>,
    settings: HashMap<String, serde_json::Value>,
) -> Result<(), String> {
    let config: ConfigManifest = crate::plugins::installer::read_manifest(path)?;

    // Refuse plugins that claim a built-in driver id. Registration is a plain
    // insert keyed by id, so otherwise a plugin with id "mysql"/"postgres"/
    // "sqlite" would shadow the built-in driver and receive existing
    // connections' resolved credentials.
    let plugin_id = config.id.clone().unwrap_or_else(|| config.name.clone());
    const BUILTIN_DRIVER_IDS: [&str; 3] = ["mysql", "postgres", "sqlite"];
    if BUILTIN_DRIVER_IDS.contains(&plugin_id.as_str()) {
        return Err(format!(
            "Plugin id '{}' collides with a built-in driver and was refused",
            plugin_id
        ));
    }

    let manifest = PluginManifest {
        id: plugin_id,
        name: config.name,
        version: config.version,
        description: config.description,
        default_port: config.default_port,
        capabilities: config.capabilities,
        is_builtin: false,
        engine: config.engine,
        paradigms: config.paradigms,
        default_username: config.default_username.unwrap_or_default(),
        color: config.color,
        icon: config.icon,
        settings: config.settings,
        ui_extensions: config.ui_extensions,
    };

    // UI-only plugins (no executable) register only their manifest.
    let executable = match config.executable {
        Some(ref e) => e.clone(),
        None => {
            log::info!(
                "Plugin '{}' has no executable — loaded as UI-only plugin",
                manifest.id
            );
            crate::drivers::registry::register_manifest(manifest).await;
            return Ok(());
        }
    };

    let mut exec_path = path.join(&executable);
    if !exec_path.exists() {
        // On Windows, try appending .exe if the manifest omits it
        if cfg!(windows) {
            let with_exe = path.join(format!("{}.exe", executable));
            if with_exe.exists() {
                exec_path = with_exe;
            } else {
                return Err(format!("Plugin executable not found: {:?}", exec_path));
            }
        } else {
            return Err(format!("Plugin executable not found: {:?}", exec_path));
        }
    }

    let interpreter = interpreter_override.or(config.interpreter).or_else(|| {
        if exec_path.extension().map(|e| e == "py").unwrap_or(false) {
            #[cfg(windows)]
            {
                Some("python".to_string())
            }
            #[cfg(not(windows))]
            {
                Some("python3".to_string())
            }
        } else {
            None
        }
    });

    let driver = RpcDriver::new(
        manifest,
        exec_path,
        interpreter,
        config.data_types,
        settings,
    )
    .await?;
    crate::drivers::registry::register_driver(driver).await;
    Ok(())
}
