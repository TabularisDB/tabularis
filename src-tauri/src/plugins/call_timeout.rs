//! Resolution of the per-call JSON-RPC timeout applied to plugin drivers.
//!
//! The effective timeout for a plugin is, in order of precedence:
//! 1. the plugin's own override (`plugins.<id>.callTimeoutSeconds`),
//! 2. the global host setting (`pluginCallTimeoutSeconds`),
//! 3. [`DEFAULT_PLUGIN_CALL_TIMEOUT_SECS`].
//!
//! A value of `0` disables the timeout entirely, so long-running statements
//! (maintenance jobs, index builds, …) are never cut off by the host.
//!
//! The resolved values are kept in a small process-wide snapshot refreshed
//! whenever the config is loaded or saved, so a change applies to the next
//! plugin call without restarting the plugin process — in both the GUI and
//! the standalone MCP subprocess (which re-reads the config from disk).

use std::collections::HashMap;
use std::sync::RwLock;
use std::time::Duration;

use once_cell::sync::Lazy;

use crate::config::AppConfig;

/// Default time to wait for a plugin to answer a single JSON-RPC call.
/// Generous enough for slow query execution, bounded so a wedged plugin
/// cannot block the (single-threaded) MCP request loop forever.
pub const DEFAULT_PLUGIN_CALL_TIMEOUT_SECS: u32 = 120;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct CallTimeoutSettings {
    global: Option<u32>,
    per_plugin: HashMap<String, u32>,
}

impl CallTimeoutSettings {
    pub(crate) fn from_config(config: &AppConfig) -> Self {
        let per_plugin = config
            .plugins
            .as_ref()
            .map(|plugins| {
                plugins
                    .iter()
                    .filter_map(|(id, cfg)| cfg.call_timeout_seconds.map(|s| (id.clone(), s)))
                    .collect()
            })
            .unwrap_or_default();
        Self {
            global: config.plugin_call_timeout_seconds,
            per_plugin,
        }
    }

    /// Effective timeout for `plugin_id`; `None` means "wait indefinitely".
    pub(crate) fn resolve(&self, plugin_id: &str) -> Option<Duration> {
        let seconds = self
            .per_plugin
            .get(plugin_id)
            .copied()
            .or(self.global)
            .unwrap_or(DEFAULT_PLUGIN_CALL_TIMEOUT_SECS);
        (seconds > 0).then(|| Duration::from_secs(u64::from(seconds)))
    }
}

static CURRENT: Lazy<RwLock<CallTimeoutSettings>> =
    Lazy::new(|| RwLock::new(CallTimeoutSettings::default()));

/// Refreshes the snapshot from a freshly loaded or saved config.
pub fn apply_config(config: &AppConfig) {
    let next = CallTimeoutSettings::from_config(config);
    if let Ok(mut current) = CURRENT.write() {
        *current = next;
    }
}

/// Effective call timeout for `plugin_id` under the current config.
pub fn for_plugin(plugin_id: &str) -> Option<Duration> {
    CURRENT
        .read()
        .map(|current| current.resolve(plugin_id))
        .unwrap_or_else(|_| {
            Some(Duration::from_secs(u64::from(
                DEFAULT_PLUGIN_CALL_TIMEOUT_SECS,
            )))
        })
}

#[cfg(test)]
#[path = "call_timeout_tests.rs"]
mod tests;
