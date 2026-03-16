use std::collections::HashMap;
use std::sync::Arc;

use once_cell::sync::Lazy;
use tokio::sync::RwLock;

use super::driver_trait::{DatabaseDriver, PluginManifest};

type Registry = Arc<RwLock<HashMap<String, Arc<dyn DatabaseDriver>>>>;
type ManifestRegistry = Arc<RwLock<HashMap<String, PluginManifest>>>;

static REGISTRY: Lazy<Registry> =
    Lazy::new(|| Arc::new(RwLock::new(HashMap::new())));

/// Stores manifests for UI-only plugins (no executable/driver process).
static MANIFEST_REGISTRY: Lazy<ManifestRegistry> =
    Lazy::new(|| Arc::new(RwLock::new(HashMap::new())));

/// Register a driver. Called once at application startup for each built-in
/// driver, and can be called again at any point to add third-party drivers.
pub async fn register_driver(driver: impl DatabaseDriver + 'static) {
    let id = driver.manifest().id.clone();
    log::info!("Registering driver: {} ({})", driver.manifest().name, id);
    let mut reg = REGISTRY.write().await;
    reg.insert(id, Arc::new(driver));
}

/// Look up a driver by its `id` (matches `ConnectionParams.driver`).
/// Returns `None` if no driver with that id is registered.
pub async fn get_driver(id: &str) -> Option<Arc<dyn DatabaseDriver>> {
    let reg = REGISTRY.read().await;
    reg.get(id).cloned()
}

/// Unregister a driver by its id. Shuts down its background process (if any)
/// and returns `true` if a driver was removed.
pub async fn unregister_driver(id: &str) -> bool {
    let driver = {
        let mut reg = REGISTRY.write().await;
        reg.remove(id)
    };
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
