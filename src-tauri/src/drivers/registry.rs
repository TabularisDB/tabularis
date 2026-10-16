use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use once_cell::sync::Lazy;
use tokio::sync::RwLock;

use super::driver_trait::{DatabaseDriver, PluginManifest};

type Registry = Arc<RwLock<HashMap<String, Arc<dyn DatabaseDriver>>>>;
type ManifestRegistry = Arc<RwLock<HashMap<String, PluginManifest>>>;

static REGISTRY: Lazy<Registry> = Lazy::new(|| Arc::new(RwLock::new(HashMap::new())));

/// Stores manifests for UI-only plugins (no executable/driver process).
static MANIFEST_REGISTRY: Lazy<ManifestRegistry> =
    Lazy::new(|| Arc::new(RwLock::new(HashMap::new())));

/// Ids of registered drivers whose `database` field is a local file or folder
/// path (`file_based` / `folder_based`). Kept behind a synchronous lock so
/// non-async code such as `resolve_connection_params` can query it.
static LOCAL_PATH_DRIVERS: Lazy<std::sync::RwLock<HashSet<String>>> =
    Lazy::new(|| std::sync::RwLock::new(HashSet::new()));

/// Returns `true` when the registered driver `id` stores a local file or
/// folder path in `database`.
pub fn is_local_path_driver(id: &str) -> bool {
    LOCAL_PATH_DRIVERS
        .read()
        .map(|set| set.contains(id))
        .unwrap_or(false)
}

pub(crate) fn set_local_path_driver(id: &str, is_local: bool) {
    if let Ok(mut set) = LOCAL_PATH_DRIVERS.write() {
        if is_local {
            set.insert(id.to_string());
        } else {
            set.remove(id);
        }
    }
}

/// Register a driver. Called once at application startup for each built-in
/// driver, and can be called again at any point to add third-party drivers.
pub async fn register_driver(driver: impl DatabaseDriver + 'static) {
    let id = driver.manifest().id.clone();
    log::info!("Registering driver: {} ({})", driver.manifest().name, id);
    let capabilities = &driver.manifest().capabilities;
    set_local_path_driver(&id, capabilities.file_based || capabilities.folder_based);
    let mut reg = REGISTRY.write().await;
    reg.insert(id, Arc::new(driver));
}

/// Look up a driver by its `id` (matches `ConnectionParams.driver`).
/// Returns `None` if no driver with that id is registered.
pub async fn get_driver(id: &str) -> Option<Arc<dyn DatabaseDriver>> {
    let reg = REGISTRY.read().await;
    reg.get(id).cloned()
}

/// Resolve an isolated metadata snapshot only for drivers that opt in.
pub async fn get_connection_driver(
    params: &crate::models::ConnectionParams,
) -> Result<Arc<dyn DatabaseDriver>, String> {
    let driver = get_driver(&params.driver)
        .await
        .ok_or_else(|| format!("Unsupported driver: {}", params.driver))?;
    Ok(driver.for_connection(params).await?.unwrap_or(driver))
}

/// Returns `true` if `id` already has a registered driver or UI-only
/// manifest. Lets a plugin-directory rescan (e.g. the standalone MCP
/// subprocess reloading on a registry miss, issue #783) skip plugins it has
/// already loaded instead of spawning a duplicate driver process for them.
pub async fn is_registered(id: &str) -> bool {
    if REGISTRY.read().await.contains_key(id) {
        return true;
    }
    MANIFEST_REGISTRY.read().await.contains_key(id)
}

/// Unregister a driver by its id. Shuts down its background process (if any)
/// and returns `true` if a driver was removed.
pub async fn unregister_driver(id: &str) -> bool {
    let driver = {
        let mut reg = REGISTRY.write().await;
        reg.remove(id)
    };
    set_local_path_driver(id, false);
    if let Some(d) = driver {
        d.shutdown().await;
        log::info!("Unregistered driver: {}", id);
        true
    } else {
        false
    }
}

/// Register the manifest of a UI-only plugin (no driver process).
pub async fn register_manifest(manifest: PluginManifest) {
    let id = manifest.id.clone();
    log::info!("Registering UI-only plugin manifest: {}", id);
    let mut reg = MANIFEST_REGISTRY.write().await;
    reg.insert(id, manifest);
}

/// Unregister a UI-only plugin manifest by id.
pub async fn unregister_manifest(id: &str) -> bool {
    let mut reg = MANIFEST_REGISTRY.write().await;
    let removed = reg.remove(id).is_some();
    if removed {
        log::info!("Unregistered UI-only plugin manifest: {}", id);
    }
    removed
}

/// Pure core of [`reconcile_active_drivers`]: given `(id, is_builtin)` pairs
/// for everything currently registered, returns the ids that are non-builtin
/// and absent from `active_ids` — i.e. registered but no longer allowed to
/// be. Extracted so the decision logic is testable without touching the
/// process-global registries.
fn drivers_to_unregister(registered: &[(String, bool)], active_ids: &[String]) -> Vec<String> {
    registered
        .iter()
        .filter(|(_, is_builtin)| !is_builtin)
        .filter(|(id, _)| !active_ids.iter().any(|active| active == id))
        .map(|(id, _)| id.clone())
        .collect()
}

/// Unregisters every registered non-built-in driver (and UI-only manifest)
/// whose id is absent from `active_ids`. Lets a long-running process that
/// only ever *adds* drivers on a registry miss (the standalone MCP
/// subprocess's self-heal, issue #783) also notice that a plugin was
/// disabled or uninstalled elsewhere — that never produces a miss, since the
/// stale driver keeps resolving successfully.
///
/// `active_ids: None` means "no explicit preference saved" (see
/// [`crate::plugins::manager::load_plugins`]'s doc comment) — every
/// installed plugin is implicitly active in that state, so nothing is
/// unregistered. Builtins are never touched regardless of `active_ids`,
/// since `active_external_drivers` only ever governs external plugins.
///
/// Returns the ids that were actually unregistered, for logging/tests.
pub async fn reconcile_active_drivers(active_ids: Option<&[String]>) -> Vec<String> {
    let Some(active_ids) = active_ids else {
        return Vec::new();
    };

    let registered: Vec<(String, bool)> = {
        let reg = REGISTRY.read().await;
        let manifest_reg = MANIFEST_REGISTRY.read().await;
        reg.values()
            .map(|d| (d.manifest().id.clone(), d.manifest().is_builtin))
            .chain(manifest_reg.values().map(|m| (m.id.clone(), m.is_builtin)))
            .collect()
    };

    let mut removed = Vec::new();
    for id in drivers_to_unregister(&registered, active_ids) {
        let driver_removed = unregister_driver(&id).await;
        let manifest_removed = unregister_manifest(&id).await;
        if driver_removed || manifest_removed {
            removed.push(id);
        }
    }
    if !removed.is_empty() {
        log::info!(
            "Reconciled driver registry against active_external_drivers, removed: {:?}",
            removed
        );
    }
    removed
}

/// Returns the manifests of all registered drivers (including UI-only plugins), sorted by id.
/// Called by the `get_registered_drivers` Tauri command.
pub async fn list_drivers() -> Vec<PluginManifest> {
    let reg = REGISTRY.read().await;
    let manifest_reg = MANIFEST_REGISTRY.read().await;
    let mut manifests: Vec<PluginManifest> = reg
        .values()
        .map(|d| d.manifest().clone())
        .chain(manifest_reg.values().cloned())
        .collect();
    manifests.sort_by(|a, b| a.id.cmp(&b.id));
    manifests
}

/// Returns (manifest, pid) pairs for all registered drivers, sorted by id.
/// Used by the task manager to associate driver metadata with process IDs.
pub async fn list_drivers_with_pid() -> Vec<(PluginManifest, Option<u32>)> {
    let reg = REGISTRY.read().await;
    let mut entries: Vec<(PluginManifest, Option<u32>)> = reg
        .values()
        .map(|d| (d.manifest().clone(), d.pid()))
        .collect();
    entries.sort_by(|a, b| a.0.id.cmp(&b.0.id));
    entries
}

/// Serializes tests that mutate the process-global `REGISTRY`/
/// `MANIFEST_REGISTRY` statics in ways another concurrently-running test
/// could observe or clobber — in particular `reconcile_active_drivers`,
/// which by design removes anything absent from its allowlist and would
/// otherwise sweep up fixtures registered by an unrelated test running on
/// another `cargo test` thread. Acquired by this module's own tests and by
/// `mcp::tests`' driver-registration test.
#[cfg(test)]
pub(crate) static REGISTRY_TEST_LOCK: Lazy<tokio::sync::Mutex<()>> =
    Lazy::new(|| tokio::sync::Mutex::new(()));

#[cfg(test)]
mod tests;
