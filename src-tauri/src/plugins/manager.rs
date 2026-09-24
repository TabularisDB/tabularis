use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::config::PluginConfig;
use crate::drivers::driver_trait::{
    DriverCapabilities, ExplainParserManifestEntry, PluginManifest, PluginSettingDefinition,
};
use crate::models::DataTypeInfo;
use crate::plugins::driver::RpcDriver;

/// Errors that occurred during startup plugin loading, to be fetched by the frontend.
static STARTUP_ERRORS: Lazy<Mutex<Vec<PluginLoadError>>> = Lazy::new(|| Mutex::new(Vec::new()));

/// Cap on `STARTUP_ERRORS`'s length. The GUI process drains it via
/// `get_plugin_startup_errors`, but the standalone MCP subprocess reruns
/// plugin loading on every registry-miss rescan (issue #783) and never
/// drains it — a plugin that can't load there (missing executable,
/// `min_runtime_version` too high) would otherwise get a new entry pushed on
/// every miss for the life of the subprocess.
pub(crate) const MAX_STARTUP_ERRORS: usize = 50;

/// Pushes `error` onto `errors`, evicting the oldest entry first once
/// `MAX_STARTUP_ERRORS` is reached, so a long-running process that never
/// drains the vec can't grow it without bound.
pub(crate) fn push_startup_error(errors: &mut Vec<PluginLoadError>, error: PluginLoadError) {
    if errors.len() >= MAX_STARTUP_ERRORS {
        errors.remove(0);
    }
    errors.push(error);
}

#[derive(Serialize, Clone)]
pub struct PluginLoadError {
    pub plugin_id: String,
    pub error: String,
}

#[tauri::command]
pub fn get_plugin_startup_errors() -> Vec<PluginLoadError> {
    crate::application::plugins::get_plugin_startup_errors()
}

pub fn take_plugin_startup_errors() -> Vec<PluginLoadError> {
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
    /// First Tabularis release this plugin can run on, if it declares one.
    #[serde(default)]
    pub min_runtime_version: Option<String>,
    #[serde(default)]
    pub default_port: Option<u16>,
    #[serde(default)]
    pub capabilities: DriverCapabilities,
    #[serde(default)]
    pub data_types: Vec<DataTypeInfo>,
    /// Opt in to the get_connection_metadata RPC. Omitted by existing plugins.
    #[serde(default)]
    pub connection_metadata: bool,
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
    #[serde(default)]
    pub explain_parsers: Option<Vec<ExplainParserManifestEntry>>,
    /// Static type mappings for `map_inferred_type`. Keys are generic inferred
    /// types (e.g. `"DATETIME"`), values are driver-specific types (e.g. `"TIMESTAMP"`).
    #[serde(default)]
    pub type_mappings: HashMap<String, String>,
}

/// Driver ids owned by the built-in drivers. A plugin manifest claiming one
/// of these is always routed through `load_plugin_from_dir`'s explicit
/// refusal (never silently skipped by the registered-plugin fast path below)
/// so the collision is still surfaced as a logged `PluginLoadError`, not
/// swallowed because the built-in of the same id is already registered.
const BUILTIN_DRIVER_IDS: [&str; 3] = ["mysql", "postgres", "sqlite"];

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

/// Re-scans installed plugins against the latest on-disk config and registers
/// any that are missing from the driver registry. Idempotent — plugins
/// already registered are skipped by `load_plugins_with_configs`, so this can
/// be called repeatedly without spawning duplicate driver processes.
///
/// Lets the standalone MCP subprocess self-heal a stale registry (issue
/// #783): unlike the GUI, which hot-registers a plugin the moment it's
/// installed/enabled via the Tauri command handling that action, the
/// subprocess has no way to observe plugin changes made in the other
/// process. Callers retry a registry lookup after this returns.
pub async fn reload_plugins_from_disk_config() {
    let app_config = crate::config::load_config_from_disk();
    let plugin_configs = app_config.plugins.unwrap_or_default();
    let enabled_ids = app_config.active_external_drivers;
    load_plugins_with_configs(plugin_configs, enabled_ids.as_deref()).await;
}

/// Variant of [`load_plugins`] that takes plugin configs directly. Used by the
/// standalone `--mcp` subprocess which has no Tauri `AppHandle` but needs to
/// register the same drivers so MCP tools can reach plugin-driven connections.
pub async fn load_plugins_with_configs(
    plugin_configs: HashMap<String, PluginConfig>,
    enabled_ids: Option<&[String]>,
) {
    // Migrate before resolving the shared directory so both the GUI and the
    // standalone MCP process discover plugins installed by older builds.
    crate::plugins::installer::migrate_legacy_plugins_dir();

    let plugins_dir = match crate::plugins::installer::get_plugins_dir() {
        Ok(dir) => dir,
        Err(e) => {
            log::error!("{}", e);
            return;
        }
    };

    load_plugins_from_dir(&plugins_dir, plugin_configs, enabled_ids).await;
}

/// Load external drivers from a runtime-provided directory.
///
/// Startup adapters resolve paths; plugin discovery and registration remain
/// platform-neutral and can therefore run without a Tauri `AppHandle`.
pub async fn load_plugins_from_dir(
    plugins_dir: &Path,
    plugin_configs: HashMap<String, PluginConfig>,
    enabled_ids: Option<&[String]>,
) {
    let entries = match super::layout::driver_directories(plugins_dir) {
        Ok(e) => e,
        Err(e) => {
            log::error!("Failed to read plugins directory: {}", e);
            return;
        }
    };

    for path in entries {

        if let Some(enabled) = enabled_ids {
            if let Some(dir_name) = path.file_name().and_then(|n| n.to_str()) {
                if !enabled.iter().any(|id| id == dir_name) {
                    log::info!("Skipping disabled plugin: {}", dir_name);
                    continue;
                }
            }
        }

        // Skip plugins already registered (driver or UI-only manifest) so a
        // rescan — e.g. `reload_plugins_from_disk_config`'s lazy reload on a
        // registry miss — doesn't spawn a duplicate driver process for a
        // plugin it already loaded. Built-in ids are excluded: they are
        // always "already registered", so skipping them here would silently
        // swallow a plugin that claims one instead of routing it through
        // `load_plugin_from_dir`'s explicit collision refusal below.
        if let Ok(config) = crate::plugins::installer::read_manifest::<ConfigManifest>(&path) {
            let plugin_id = config.id.unwrap_or(config.name);
            let already_registered = crate::drivers::registry::is_registered(&plugin_id).await;
            if should_skip_rescan(&plugin_id, already_registered) {
                continue;
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
                push_startup_error(
                    &mut guard,
                    PluginLoadError {
                        plugin_id,
                        error: e,
                    },
                );
            }
        }
    }
}

/// Whether `load_plugins_with_configs`'s rescan should skip loading a plugin
/// directory outright, given whether `plugin_id` is already registered.
/// Never skips a built-in id (issue #783 follow-up): those are always
/// "already registered" by the time any plugin is scanned, so skipping them
/// here would silently swallow a plugin that claims one instead of letting
/// `load_plugin_from_dir` refuse it explicitly and log a `PluginLoadError`.
pub(crate) fn should_skip_rescan(plugin_id: &str, already_registered: bool) -> bool {
    already_registered && !BUILTIN_DRIVER_IDS.contains(&plugin_id)
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
    if BUILTIN_DRIVER_IDS.contains(&plugin_id.as_str()) {
        return Err(format!(
            "Plugin id '{}' collides with a built-in driver and was refused",
            plugin_id
        ));
    }

    // Refuse plugins that need host features this build does not have, so the
    // user sees one clear message instead of a runtime failure later.
    // Development builds load them anyway and queue a warning toast.
    crate::plugins::runtime_version::enforce_min_runtime_version(
        &plugin_id,
        config.min_runtime_version.as_deref(),
    )?;

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
        explain_parsers: config.explain_parsers,
        type_mappings: config.type_mappings,
        // External plugins are not deprecated in favour of another plugin;
        // `deprecated` is a built-in-only concept stamped at registration.
        deprecated: None,
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
    .await?
    .with_connection_metadata(config.connection_metadata);
    crate::drivers::registry::register_driver(driver).await;
    Ok(())
}
