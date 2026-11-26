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
use crate::plugins::{installer, registry, tabularium};
use crate::runtime::RuntimeContext;

/// Built-in driver id → replacement plugin id pairs that the app keeps
/// installed automatically when a connection on the built-in exists. Adding
/// a pair is the whole change required for the next deprecation.
pub const MIGRATABLE_DRIVERS: &[(&str, &str)] = &[("postgres", "postgresql")];

/// The plugin that replaced `driver_id`, when `driver_id` is either the removed
/// built-in id or the plugin id itself. Lets an unregistered-driver error name
/// the plugin to install for both pre- and post-migration connections.
pub fn replacement_plugin_for(driver_id: &str) -> Option<&'static str> {
    MIGRATABLE_DRIVERS
        .iter()
        .find(|(builtin, plugin)| *builtin == driver_id || *plugin == driver_id)
        .map(|(_, plugin)| *plugin)
}

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

/// True when at least one saved connection uses the built-in driver id
/// (pre-migration) or the replacement plugin id (post-migration). Checking
/// both ids lets the install retry on a later launch when the first download
/// failed after the migration had already moved the connections over. Pure so
/// it can be tested without a runtime.
pub(crate) fn needs_plugin_for(builtin_id: &str, plugin_id: &str, drivers: &[&str]) -> bool {
    drivers.iter().any(|d| *d == builtin_id || *d == plugin_id)
}

/// Environment switch that stops a headless process (the web server, `--mcp`)
/// from downloading a replacement plugin on its own. For air-gapped or
/// locked-down deployments, where fetching and running a binary at startup is a
/// policy decision the operator wants to make. The plugin can still be installed
/// by hand. The desktop app is not affected.
pub const DISABLE_AUTO_INSTALL_ENV: &str = "TABULARIS_DISABLE_PLUGIN_AUTO_INSTALL";

/// Whether a raw [`DISABLE_AUTO_INSTALL_ENV`] value turns auto-install off:
/// anything but an explicit "off" value (`0`, `false`, `no`, empty). Pure, so
/// it is tested without touching the process environment.
pub(crate) fn auto_install_disabled_by(value: Option<&str>) -> bool {
    value.is_some_and(|value| {
        !matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "" | "0" | "false" | "no"
        )
    })
}

/// True when the operator has turned headless auto-install off.
pub(crate) fn auto_install_disabled() -> bool {
    auto_install_disabled_by(std::env::var(DISABLE_AUTO_INSTALL_ENV).ok().as_deref())
}

/// Install (and activate) the replacement plugin for every [`MIGRATABLE_DRIVERS`]
/// pair that a saved connection depends on. Runs from the web server and the
/// MCP process, which share one bootstrap with the desktop app but have no
/// desktop setup step to do it. Every failure is logged and swallowed: the
/// check restarts from scratch on every launch, so a transient failure (no
/// network, registry down) heals on the next one, and an air-gapped host simply
/// keeps logging that the plugin is missing.
pub async fn ensure_replacement_plugins(runtime: &RuntimeContext) {
    let drivers: Vec<String> =
        match crate::persistence::load_connections(&runtime.paths.connections_file()) {
            Ok(connections) => connections
                .iter()
                .map(|c| c.params.driver.clone())
                .collect(),
            Err(error) => {
                log::warn!("{LOG_PREFIX} could not read connections: {error}");
                return;
            }
        };
    let driver_refs: Vec<&str> = drivers.iter().map(String::as_str).collect();
    for (builtin_id, plugin_id) in MIGRATABLE_DRIVERS {
        if needs_plugin_for(builtin_id, plugin_id, &driver_refs) {
            ensure_plugin_installed(runtime, plugin_id).await;
        }
    }
}

/// Install (and activate) `plugin_id` unless it is already installed or the
/// latest release needs a newer Tabularis. Every failure path logs and returns,
/// so a caller never has to handle one.
pub async fn ensure_plugin_installed(runtime: &RuntimeContext, plugin_id: &str) {
    match installer::list_installed_from(&runtime.paths.plugins_dir()) {
        installed if installed.iter().any(|p| p.id == plugin_id) => return,
        _ => {}
    }
    if !plugin_compatible_with_this_app(runtime, plugin_id).await {
        log::warn!("{LOG_PREFIX} {plugin_id} has no compatible release, skipping");
        return;
    }
    if let Err(error) =
        crate::application::plugins::install_plugin(runtime, plugin_id.to_string(), None, None)
            .await
    {
        log::warn!("{LOG_PREFIX} {plugin_id} install failed: {error}");
        return;
    }
    // `install_plugin` hot-registers for this session but does not persist
    // activation, so without this write the plugin vanishes on relaunch.
    if let Err(error) = persist_activation(runtime, plugin_id) {
        log::warn!("{LOG_PREFIX} could not activate {plugin_id}: {error}");
    }
    // Tell an already-open UI the plugin is installed and registered. Emitted
    // even if the activation write failed: the driver is registered for this
    // session either way.
    let payload = serde_json::to_value(PluginActivatedPayload { plugin_id }).unwrap_or_default();
    if let Err(error) = runtime.events.emit(PLUGIN_ACTIVATED_EVENT, payload) {
        log::warn!("{LOG_PREFIX} could not emit {PLUGIN_ACTIVATED_EVENT}: {error}");
    }
}

/// Persist `plugin_id` into `active_external_drivers`, leaving every other
/// config field untouched. Idempotent. Bails without writing when the installed
/// plugin list cannot be read: narrowing the list to `plugin_id` on a guess
/// could silently deactivate every other installed plugin.
pub(crate) fn persist_activation(runtime: &RuntimeContext, plugin_id: &str) -> Result<(), String> {
    let config = crate::application::persistence::load_config(runtime);
    let installed_ids: Vec<String> = installer::list_installed_from(&runtime.paths.plugins_dir())
        .into_iter()
        .map(|p| p.id)
        .collect();
    let updated = merge_active_driver(&config, plugin_id, &installed_ids);
    if updated.active_external_drivers == config.active_external_drivers {
        return Ok(());
    }
    // Pass only `active_external_drivers`: save_config overwrites every `Some`
    // field, so writing back the full snapshot would revert any other setting
    // the user changed in the meantime.
    crate::application::persistence::save_config(
        runtime,
        AppConfig {
            active_external_drivers: updated.active_external_drivers,
            ..AppConfig::default()
        },
    )
    .map(|_| ())
}

/// Whether the latest release of `plugin_id` supports this app's version.
/// `install_plugin` does not check `min_tabularis_version` itself, so without
/// this an unattended install could leave a plugin that needs a newer Tabularis
/// installed but unusable. An unreachable registry counts as compatible, so a
/// network blip does not permanently block an otherwise-fine install.
async fn plugin_compatible_with_this_app(runtime: &RuntimeContext, plugin_id: &str) -> bool {
    let config = crate::application::persistence::load_config(runtime);
    let base = registry_base_url(&config).trim_end_matches('/');
    let Ok(detail) = tabularium::fetch_plugin_detail(base, plugin_id).await else {
        log::warn!("{LOG_PREFIX} could not fetch detail for {plugin_id}, assuming compatible");
        return true;
    };
    let target = if detail.latest_version.is_empty() {
        detail.releases.first()
    } else {
        detail
            .releases
            .iter()
            .find(|r| r.version == detail.latest_version)
            .or_else(|| detail.releases.first())
    };
    let Some(release) = target else {
        log::warn!("{LOG_PREFIX} {plugin_id} has no releases on the registry");
        return false;
    };
    let Some(min) = &release.min_tabularis_version else {
        return true;
    };
    is_version_compatible(min, env!("CARGO_PKG_VERSION"))
}
