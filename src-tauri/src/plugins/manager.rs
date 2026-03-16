use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Mutex;

use directories::ProjectDirs;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::drivers::driver_trait::{DriverCapabilities, PluginManifest, PluginSettingDefinition};
use crate::models::DataTypeInfo;
use crate::plugins::driver::RpcDriver;

/// Errors that occurred during startup plugin loading, to be fetched by the frontend.
static STARTUP_ERRORS: Lazy<Mutex<Vec<PluginLoadError>>> =
    Lazy::new(|| Mutex::new(Vec::new()));

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
    pub id: String,
    pub name: String,
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
                guard.push(PluginLoadError { plugin_id, error: e });
            }
        }
    }
}

pub async fn load_plugin_from_dir(path: &Path, interpreter_override: Option<String>, settings: HashMap<String, serde_json::Value>) -> Result<(), String> {
    let manifest_path = path.join("manifest.json");
    if !manifest_path.exists() {
        return Err(format!("manifest.json not found in {:?}", path));
    }

    let manifest_str = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("Failed to read plugin manifest {:?}: {}", manifest_path, e))?;

    let config: ConfigManifest = serde_json::from_str(&manifest_str)
        .map_err(|e| format!("Failed to parse plugin manifest {:?}: {}", manifest_path, e))?;

    let manifest = PluginManifest {
        id: config.id,
        name: config.name,
        version: config.version,
        description: config.description,
        default_port: config.default_port,
        capabilities: config.capabilities,
        is_builtin: false,
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
            log::info!("Plugin '{}' has no executable — loaded as UI-only plugin", manifest.id);
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

    let interpreter = interpreter_override
        .or(config.interpreter)
        .or_else(|| {
            if exec_path.extension().map(|e| e == "py").unwrap_or(false) {
                #[cfg(windows)]
                { Some("python".to_string()) }
                #[cfg(not(windows))]
                { Some("python3".to_string()) }
            } else {
                None
            }
        });

    let driver = RpcDriver::new(manifest, exec_path, interpreter, config.data_types, settings).await?;
    crate::drivers::registry::register_driver(driver).await;
    Ok(())
}
