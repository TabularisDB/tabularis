//! Host runtime version gate for installed plugins.
//!
//! A plugin manifest may declare `min_runtime_version`, the first Tabularis
//! release that ships every host feature the plugin relies on. The registry
//! validates the field, but nothing stopped an older host from loading such a
//! plugin and failing later at runtime. This module refuses the plugin up
//! front with a message that names both versions.

use std::sync::Mutex;

use once_cell::sync::Lazy;
use semver::Version;
use serde::Serialize;

/// Version of the running Tabularis host.
pub const HOST_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Development builds load incompatible plugins anyway so new host features
/// can be tested against plugins that already declare the future floor.
pub const IS_DEV_BUILD: bool = cfg!(debug_assertions);

/// Outcome of comparing a plugin floor with the running host.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimeVersionVerdict {
    /// The host satisfies the floor, or the plugin declares none.
    Compatible,
    /// The host is too old but this is a development build: load the plugin
    /// and surface the message as a warning.
    DevOverride(String),
    /// The host is too old: refuse the plugin with this message.
    Incompatible(String),
}

/// A non-fatal plugin warning queued for the frontend to show as a toast.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PluginRuntimeWarning {
    pub plugin_id: String,
    pub message: String,
}

static RUNTIME_WARNINGS: Lazy<Mutex<Vec<PluginRuntimeWarning>>> =
    Lazy::new(|| Mutex::new(Vec::new()));

/// Queue a warning for the frontend.
pub fn push_runtime_warning(plugin_id: &str, message: &str) {
    let mut guard = RUNTIME_WARNINGS.lock().unwrap_or_else(|e| e.into_inner());
    guard.push(PluginRuntimeWarning {
        plugin_id: plugin_id.to_string(),
        message: message.to_string(),
    });
}

/// Drain the queued warnings; each one is returned exactly once.
pub fn take_runtime_warnings() -> Vec<PluginRuntimeWarning> {
    let mut guard = RUNTIME_WARNINGS.lock().unwrap_or_else(|e| e.into_inner());
    std::mem::take(&mut *guard)
}

#[tauri::command]
pub fn get_plugin_runtime_warnings() -> Vec<PluginRuntimeWarning> {
    take_runtime_warnings()
}

/// Decide what to do with a plugin floor on this host.
///
/// `dev_build` turns an incompatible result into [`RuntimeVersionVerdict::DevOverride`]
/// so a developer can exercise a plugin against a host that has not been
/// released yet, while still being told about the mismatch.
pub fn evaluate_min_runtime_version(
    plugin_id: &str,
    min_runtime_version: Option<&str>,
    host_version: &str,
    dev_build: bool,
) -> RuntimeVersionVerdict {
    match check_min_runtime_version(plugin_id, min_runtime_version, host_version) {
        Ok(()) => RuntimeVersionVerdict::Compatible,
        Err(message) if dev_build => RuntimeVersionVerdict::DevOverride(format!(
            "{} Loaded anyway because this is a development build.",
            message
        )),
        Err(message) => RuntimeVersionVerdict::Incompatible(message),
    }
}

/// Apply the verdict for the running host: `Ok` to continue loading, `Err`
/// with the user-facing message to refuse. A development override is logged
/// and queued for the frontend toast.
pub fn enforce_min_runtime_version(
    plugin_id: &str,
    min_runtime_version: Option<&str>,
) -> Result<(), String> {
    match evaluate_min_runtime_version(plugin_id, min_runtime_version, HOST_VERSION, IS_DEV_BUILD) {
        RuntimeVersionVerdict::Compatible => Ok(()),
        RuntimeVersionVerdict::DevOverride(message) => {
            log::warn!("{}", message);
            push_runtime_warning(plugin_id, &message);
            Ok(())
        }
        RuntimeVersionVerdict::Incompatible(message) => Err(message),
    }
}

/// Verify that `host_version` satisfies a plugin's `min_runtime_version`.
///
/// `None` or an empty string means the plugin declares no floor. A floor or a
/// host version that is not valid semver is logged and treated as compatible:
/// the registry already validates the field, and a local typo must not brick
/// plugin loading. Comparison follows semver precedence, so a prerelease host
/// such as `0.23.0-nightly.1` does not satisfy a `0.23.0` floor.
pub fn check_min_runtime_version(
    plugin_id: &str,
    min_runtime_version: Option<&str>,
    host_version: &str,
) -> Result<(), String> {
    let Some(floor) = min_runtime_version
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(());
    };

    let required = match Version::parse(floor.trim_start_matches('v')) {
        Ok(version) => version,
        Err(err) => {
            log::warn!(
                "Plugin '{}' declares a non-semver min_runtime_version {:?} ({}); skipping the runtime version check",
                plugin_id,
                floor,
                err
            );
            return Ok(());
        }
    };
    let host = match Version::parse(host_version.trim().trim_start_matches('v')) {
        Ok(version) => version,
        Err(err) => {
            log::warn!(
                "Host version {:?} is not semver ({}); skipping the runtime version check for plugin '{}'",
                host_version,
                err,
                plugin_id
            );
            return Ok(());
        }
    };

    if host < required {
        return Err(format!(
            "Plugin '{}' requires Tabularis {} or newer, but this is Tabularis {}. Update Tabularis to use this plugin.",
            plugin_id, required, host
        ));
    }
    Ok(())
}
