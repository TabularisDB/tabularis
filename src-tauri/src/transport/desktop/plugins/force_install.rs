use crate::config::AppConfig;
use crate::plugins::force_install::*;
use crate::plugins::{installer, tabularium};
use crate::transport::desktop::config;
use tauri::{AppHandle, Emitter};

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
    let runtime = tauri::Manager::state::<crate::runtime::RuntimeContext>(app);
    if let Err(e) =
        crate::application::plugins::install_plugin(&runtime, plugin_id.to_string(), None, None)
            .await
    {
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
    // Pass save_config a config with only `active_external_drivers` set,
    // not the full `updated` snapshot: save_config re-reads disk and
    // overwrites every `Some` field, so writing back the stale snapshot
    // taken above would silently revert any other setting the user changed
    // in the meantime — the inverse of the race the frontend's
    // `plugin-activated` listener already guards against.
    config::save_config(
        app.clone(),
        AppConfig {
            active_external_drivers: updated.active_external_drivers,
            ..AppConfig::default()
        },
    )
}

/// True when at least one saved connection has `params.driver == driver_id`.
/// Reads the connections file directly via `persistence::load_connections`
/// (the same path `get_connections` uses internally) rather than invoking the
/// Tauri command — the command wrapper runs per-call SSH/SSL migrations we
/// don't want firing on every launch just to detect a trigger.
fn connections_use_driver(app: &AppHandle, driver_id: &str) -> Result<bool, String> {
    let path = crate::transport::desktop::commands::get_config_path(app)?;
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
