//! Install a plugin driver automatically when a saved connection already
//! needs it.
//!
//! This is the "ensure the plugin is installed before offering to migrate"
//! half of the built-in-to-plugin migration flow (see
//! `.github/planning/postgres-plugin-force-install.md`). It is deliberately
//! separate from the frontend migration nudge: this module runs at launch in
//! a background task, installs (and activates) the plugin when a triggering
//! connection exists, and silently bails on every failure — the nudge is what
//! surfaces the result to the user, gated on the plugin actually being
//! present.
//!
//! Everything here takes driver ids as parameters rather than hardcoding
//! postgres, so future built-in deprecations add an entry to
//! [`MIGRATABLE_DRIVERS`] and a call site, not a new function.

use serde::Serialize;

use crate::config::AppConfig;
use crate::plugins::registry;

/// Built-in driver id → replacement plugin id pairs that the app keeps
/// installed automatically when a connection on the built-in exists. Adding
/// a pair is the whole change required for the next deprecation.
pub const MIGRATABLE_DRIVERS: &[(&str, &str)] = &[("postgres", "postgresql")];

/// Log prefix shared by every message this module emits, so the force-install
/// flow is greppable in logs at a glance.
pub(crate) const LOG_PREFIX: &str = "[force-install]";

/// Emitted after a background force-install persists activation for
/// `plugin_id`. This runs in a spawned task well after the frontend has
/// already loaded its own settings/drivers snapshot, so without this event
/// the frontend has no way to learn the write happened — leaving it either
/// stuck showing a stale "plugin not ready" banner until restart, or, worse,
/// exposed to clobbering the write the next time it saves an unrelated
/// setting from that stale snapshot (`SettingsProvider.updateSetting` sends
/// its whole in-memory settings object on every save). `useDrivers` and
/// `SettingsProvider` both listen and refresh the affected slice of state.
pub const PLUGIN_ACTIVATED_EVENT: &str = "tabularis://plugin-activated";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginActivatedPayload<'a> {
    pub(crate) plugin_id: &'a str,
}

/// Pure helper: return a copy of `config` with `plugin_id` added to
/// `active_external_drivers`. Every other field is carried through unchanged.
/// Extracted so the merge/dedup logic is testable without a Tauri
/// `AppHandle`.
///
/// `None` in `active_external_drivers` is not "nothing is active" — every
/// other reader (`load_plugins`, `PluginsTab`) treats it as "no preference
/// saved yet, so every installed plugin is active." Starting the merge from
/// an empty list in that case would turn that implicit "all installed" into
/// an explicit list containing only `plugin_id`, silently deactivating every
/// other plugin the user already had installed and running (e.g. installing
/// the postgres-migration plugin would turn off an unrelated dynamodb plugin
/// on the next launch). So when the config value is `None`, this seeds the
/// explicit list from `installed_ids` — the caller's current
/// `installer::list_installed()` snapshot — before appending, making the
/// existing "all installed" set explicit rather than narrowing it.
pub(crate) fn merge_active_driver(
    config: &AppConfig,
    plugin_id: &str,
    installed_ids: &[String],
) -> AppConfig {
    let mut active = config
        .active_external_drivers
        .clone()
        .unwrap_or_else(|| installed_ids.to_vec());
    if !active.iter().any(|id| id == plugin_id) {
        active.push(plugin_id.to_string());
    }
    AppConfig {
        active_external_drivers: if active.is_empty() {
            None
        } else {
            Some(active)
        },
        ..config.clone()
    }
}

/// Pure semver check: is `app_version` >= `min_version`? Returns `true` when
/// either string fails to parse (a malformed version string must not block an
/// otherwise-fine install — the install itself surfaces real errors). Extracted
/// from [`plugin_compatible_with_this_app`] so the semver comparison is
/// testable without hitting the registry.
pub(crate) fn is_version_compatible(min_version: &str, app_version: &str) -> bool {
    match (
        semver::Version::parse(min_version),
        semver::Version::parse(app_version),
    ) {
        (Ok(min_ver), Ok(app_ver)) => {
            if app_ver < min_ver {
                log::warn!("{LOG_PREFIX} min Tabularis {min_version} exceeds app {app_version}");
                false
            } else {
                true
            }
        }
        _ => {
            log::warn!(
                "{LOG_PREFIX} non-semver version compare (min={min_version:?}, app={app_version}), assuming compatible"
            );
            true // don't block on a malformed version string
        }
    }
}

/// Resolve the configured Tabularium registry base URL. Mirrors the private
/// `registry_base_url` in `commands.rs` (same 3-line logic) rather than
/// reaching across modules for it.
pub(crate) fn registry_base_url(config: &AppConfig) -> &str {
    config
        .tabularium_registry_url
        .as_deref()
        .unwrap_or(registry::DEFAULT_TABULARIUM_URL)
}
