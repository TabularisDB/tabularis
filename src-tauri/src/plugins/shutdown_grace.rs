//! Resolution of the plugin shutdown grace period.
//!
//! After shutdown is requested, in-flight JSON-RPC calls may finish before
//! the child process is killed. The effective grace for a plugin is, in
//! order of precedence:
//! 1. the plugin's own override (`plugins.<id>.shutdownGraceSeconds`),
//! 2. the global host setting (`pluginShutdownGraceSeconds`),
//! 3. [`DEFAULT_PLUGIN_SHUTDOWN_GRACE_SECS`].
//!
//! Configured values below [`MIN_PLUGIN_SHUTDOWN_GRACE_SECS`] are clamped so
//! shutdown always has a finite bound. Idle plugins still exit as soon as the
//! command channel drains.
//!
//! The resolved values are kept in a small process-wide snapshot refreshed
//! whenever the config is loaded or saved, so a change applies to the next
//! shutdown without restarting the plugin process — in both the GUI and the
//! standalone MCP subprocess (which re-reads the config from disk).

use std::collections::HashMap;
use std::sync::RwLock;
use std::time::Duration;

use once_cell::sync::Lazy;

use crate::config::AppConfig;

/// Minimum effective shutdown grace (seconds). Values of `0` in config are
/// clamped to this so shutdown cannot wait without a bound.
pub const MIN_PLUGIN_SHUTDOWN_GRACE_SECS: u32 = 1;

/// Default time already-accepted plugin calls may run after shutdown starts.
pub const DEFAULT_PLUGIN_SHUTDOWN_GRACE_SECS: u32 = 2;

/// [`DEFAULT_PLUGIN_SHUTDOWN_GRACE_SECS`] as a [`Duration`].
pub const DEFAULT_PLUGIN_SHUTDOWN_GRACE: Duration =
    Duration::from_secs(DEFAULT_PLUGIN_SHUTDOWN_GRACE_SECS as u64);

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct ShutdownGraceSettings {
    global: Option<u32>,
    per_plugin: HashMap<String, u32>,
}

impl ShutdownGraceSettings {
    pub(crate) fn from_config(config: &AppConfig) -> Self {
        let per_plugin = config
            .plugins
            .as_ref()
            .map(|plugins| {
                plugins
                    .iter()
                    .filter_map(|(id, cfg)| cfg.shutdown_grace_seconds.map(|s| (id.clone(), s)))
                    .collect()
            })
            .unwrap_or_default();
        Self {
            global: config.plugin_shutdown_grace_seconds,
            per_plugin,
        }
    }

    /// Effective grace for `plugin_id`, with a minimum of
    /// [`MIN_PLUGIN_SHUTDOWN_GRACE_SECS`].
    pub(crate) fn resolve(&self, plugin_id: &str) -> Option<Duration> {
        let seconds = self
            .per_plugin
            .get(plugin_id)
            .copied()
            .or(self.global)
            .unwrap_or(DEFAULT_PLUGIN_SHUTDOWN_GRACE_SECS);
        let seconds = seconds.max(MIN_PLUGIN_SHUTDOWN_GRACE_SECS);
        Some(Duration::from_secs(u64::from(seconds)))
    }

    /// Grace used when the shutdown signal is lost (sender dropped): the
    /// global setting (clamped), or the default when unset.
    pub(crate) fn dropped_signal_grace(&self) -> Duration {
        self.global
            .map(|seconds| {
                Duration::from_secs(u64::from(seconds.max(MIN_PLUGIN_SHUTDOWN_GRACE_SECS)))
            })
            .unwrap_or(DEFAULT_PLUGIN_SHUTDOWN_GRACE)
    }
}

static CURRENT: Lazy<RwLock<ShutdownGraceSettings>> =
    Lazy::new(|| RwLock::new(ShutdownGraceSettings::default()));

/// Refreshes the snapshot from a freshly loaded or saved config.
pub fn apply_config(config: &AppConfig) {
    let next = ShutdownGraceSettings::from_config(config);
    if let Ok(mut current) = CURRENT.write() {
        *current = next;
    }
}

/// Effective shutdown grace for `plugin_id` under the current config.
pub fn for_plugin(plugin_id: &str) -> Option<Duration> {
    CURRENT
        .read()
        .map(|current| current.resolve(plugin_id))
        .unwrap_or(Some(DEFAULT_PLUGIN_SHUTDOWN_GRACE))
}

/// Bounded grace for a plugin whose shutdown signal was dropped without a
/// value. See [`ShutdownGraceSettings::dropped_signal_grace`].
pub fn dropped_signal_grace() -> Duration {
    CURRENT
        .read()
        .map(|current| current.dropped_signal_grace())
        .unwrap_or(DEFAULT_PLUGIN_SHUTDOWN_GRACE)
}

#[cfg(test)]
#[path = "shutdown_grace_tests.rs"]
mod tests;
