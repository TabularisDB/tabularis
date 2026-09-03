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
use tauri::{AppHandle, Emitter};

use crate::config::{self, AppConfig};
use crate::plugins::{commands, installer, registry, tabularium};

/// Built-in driver id → replacement plugin id pairs that the app keeps
/// installed automatically when a connection on the built-in exists. Adding
/// a pair is the whole change required for the next deprecation.
pub const MIGRATABLE_DRIVERS: &[(&str, &str)] = &[("postgres", "postgresql")];

/// Log prefix shared by every message this module emits, so the force-install
/// flow is greppable in logs at a glance.
const LOG_PREFIX: &str = "[force-install]";

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
struct PluginActivatedPayload<'a> {
    plugin_id: &'a str,
}

/// Ensure the plugin for `builtin_id` is installed, but only when at least one
/// saved connection is still on the built-in driver. A user with no such
/// connection is left untouched — no plugin they don't need.
///
/// Public entry point spawned from `setup()`.
pub async fn ensure_plugin_installed_if_needed(app: &AppHandle, builtin_id: &str, plugin_id: &str) {
    match connections_use_driver(app, builtin_id) {
        Ok(false) => return, // nothing on this built-in driver, nothing to do
        Ok(true) => {}
        Err(e) => {
            log::warn!("{LOG_PREFIX} could not read connections: {e}");
            return;
        }
    }
    ensure_plugin_installed(app, plugin_id).await;
}

/// Install (and activate) `plugin_id` if it isn't already installed and the
/// latest release is compatible with this app build. Every failure path
/// logs and returns silently — there's no UI-visible error and no retry loop
/// within a single launch. The check re-runs from scratch on every launch,
/// so a transient failure self-heals next time; a persistent one (no network,
/// corporate proxy) is handled by the frontend nudge staying suppressed until
/// the plugin is actually present (see the design doc's connectivity section).
pub async fn ensure_plugin_installed(app: &AppHandle, plugin_id: &str) {
    match installer::list_installed() {
        Ok(installed) if installed.iter().any(|p| p.id == plugin_id) => return,
        Ok(_) => {}
        Err(e) => {
            log::warn!("{LOG_PREFIX} could not list installed plugins: {e}");
            return;
        }
    }
    if !plugin_compatible_with_this_app(app, plugin_id).await {
        log::warn!("{LOG_PREFIX} {plugin_id} has no compatible release, skipping");
        return;
    }
    if let Err(e) = commands::install_plugin(app.clone(), plugin_id.to_string(), None).await {
        log::warn!("{LOG_PREFIX} {plugin_id} install failed: {e}");
        return;
    }
    // `install_plugin` hot-registers for this session but does not persist
    // activation — without this write the plugin vanishes on relaunch
    // (`load_plugins` skips installed-but-unlisted drivers). Same effect as
    // `NewConnectionModal`'s `updateSetting("activeExternalDrivers", ...)`,
    // written from the backend because this runs in a spawned task.
    if let Err(e) = persist_activation(app, plugin_id) {
        log::warn!("{LOG_PREFIX} could not activate {plugin_id}: {e}");
    }
    // Tell the already-running frontend the plugin is installed and
    // (activation errors aside) registered — see `PLUGIN_ACTIVATED_EVENT`'s
    // doc comment for why this can't wait for the next launch. Emitted even
    // if `persist_activation` above failed: `install_plugin` still
    // hot-registered the driver for this session, so `useDrivers`'
    // `get_registered_drivers`/`get_installed_plugins` refetch has something
    // new to report regardless of whether the config write landed.
    if let Err(e) = app.emit(PLUGIN_ACTIVATED_EVENT, PluginActivatedPayload { plugin_id }) {
        log::warn!("{LOG_PREFIX} could not emit {PLUGIN_ACTIVATED_EVENT}: {e}");
    }
}

/// Persist `plugin_id` into `active_external_drivers` via the `save_config`
/// merge, leaving every other config field untouched. Idempotent: a no-op if
/// the id is already active.
///
/// Reads the currently-installed plugin ids first: `merge_active_driver` needs
/// them to seed the list correctly when no preference has been saved yet (see
/// its doc comment). Bails without writing if that read fails — narrowing to
/// just `plugin_id` on a guess would be worse than not activating it this
/// launch, since it could silently deactivate every other installed plugin.
fn persist_activation(app: &AppHandle, plugin_id: &str) -> Result<(), String> {
    let config = config::load_config_internal(app);
    let installed_ids: Vec<String> = installer::list_installed()?
        .into_iter()
        .map(|p| p.id)
        .collect();
    let updated = merge_active_driver(&config, plugin_id, &installed_ids);
    // Only write when something actually changed — avoids a pointless
    // config.json rewrite (and cache invalidation) on every launch.
    if updated.active_external_drivers == config.active_external_drivers {
        return Ok(());
    }
    config::save_config(app.clone(), updated)
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

/// True when at least one saved connection has `params.driver == driver_id`.
/// Reads the connections file directly via `persistence::load_connections`
/// (the same path `get_connections` uses internally) rather than invoking the
/// Tauri command — the command wrapper runs per-call SSH/SSL migrations we
/// don't want firing on every launch just to detect a trigger.
fn connections_use_driver(app: &AppHandle, driver_id: &str) -> Result<bool, String> {
    let path = crate::commands::get_config_path(app)?;
    let connections = crate::persistence::load_connections(&path)?;
    Ok(connections.iter().any(|c| c.params.driver == driver_id))
}

/// Check the latest release's `min_tabularis_version` against the running
/// app's own version. `install_plugin` doesn't gate on this itself, so without
/// this check an unattended install could silently install a release that
/// requires a newer Tabularis than the user is running, leaving them
/// installed-but-non-functional. Reuses the `semver::Version::parse` primitive
/// `classify_install` (`registry.rs:43`) already uses, applied to a different
/// comparison.
async fn plugin_compatible_with_this_app(app: &AppHandle, plugin_id: &str) -> bool {
    let config = config::load_config_internal(app);
    let base = registry_base_url(&config).trim_end_matches('/');
    let Ok(detail) = tabularium::fetch_plugin_detail(base, plugin_id).await else {
        // Couldn't reach the registry — treat as compatible-by-default so a
        // network blip doesn't permanently block an otherwise-fine install;
        // the install itself will surface a real download error if it persists.
        log::warn!("{LOG_PREFIX} could not fetch detail for {plugin_id}, assuming compatible");
        return true;
    };
    // Find the release matching the registry's latest_version; fall back to
    // the first release if the version string can't be matched.
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
        return true; // no minimum declared → compatible with any version
    };
    is_version_compatible(min, env!("CARGO_PKG_VERSION"))
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
fn registry_base_url(config: &AppConfig) -> &str {
    config
        .tabularium_registry_url
        .as_deref()
        .unwrap_or(registry::DEFAULT_TABULARIUM_URL)
}
