//! Plugin registry catalogue cache: in-memory for the session, plus a JSON
//! file under the app config dir so a restart within the TTL does not re-hit
//! the network. Installed-plugin directory scans stay memory-only (cheap).
//!
//! Default reads prefer these caches; callers pass `force` (or call
//! [`invalidate_all`]) after install/uninstall / explicit Refresh. Invalidating
//! clears memory only — the on-disk catalogue is kept and re-merged with the
//! current installed list so install flags stay accurate without a network fetch.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};

use crate::plugins::installer::{self, InstalledPluginInfo};
use crate::plugins::registry::{self, RegistryPluginWithStatus};

/// How long a successful registry fetch may be reused (memory + disk).
const REGISTRY_TTL: Duration = Duration::from_secs(12 * 60 * 60);
/// How long a plugins-dir scan may be reused (cheap, but still avoids thrashing
/// when Connections mounts multiple hooks).
const INSTALLED_TTL: Duration = Duration::from_secs(60);

const CACHE_FILE_NAME: &str = "plugin_registry_cache.json";

struct RegistryCache {
    fetched_at: Instant,
    /// Wall-clock time matching the disk file; used when rehydrating memory.
    fetched_at_unix: u64,
    registry_key: String,
    plugins: Vec<RegistryPluginWithStatus>,
}

struct InstalledCache {
    fetched_at: Instant,
    plugins: Vec<InstalledPluginInfo>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct DiskRegistryCache {
    fetched_at: u64,
    registry_key: String,
    plugins: Vec<RegistryPluginWithStatus>,
}

static REGISTRY: Lazy<Mutex<Option<RegistryCache>>> = Lazy::new(|| Mutex::new(None));
static INSTALLED: Lazy<Mutex<Option<InstalledCache>>> = Lazy::new(|| Mutex::new(None));

#[cfg(test)]
static TEST_CACHE_DIR: Lazy<Mutex<Option<PathBuf>>> = Lazy::new(|| Mutex::new(None));

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn disk_cache_path() -> PathBuf {
    #[cfg(test)]
    {
        if let Ok(guard) = TEST_CACHE_DIR.lock() {
            if let Some(dir) = guard.as_ref() {
                return dir.join(CACHE_FILE_NAME);
            }
        }
    }
    crate::paths::get_app_config_dir().join(CACHE_FILE_NAME)
}

fn ttl_fresh(fetched_at_unix: u64) -> bool {
    now_unix().saturating_sub(fetched_at_unix) <= REGISTRY_TTL.as_secs()
}

/// Refresh `installed_version` / `update_available` from the local plugins dir
/// so a persisted catalogue stays accurate after install/uninstall without
/// another network round-trip.
fn reconcile_install_status(
    mut plugins: Vec<RegistryPluginWithStatus>,
) -> Vec<RegistryPluginWithStatus> {
    let installed = match list_installed_cached() {
        Ok(list) => list,
        Err(e) => {
            log::warn!("registry cache: could not list installed plugins: {e}");
            return plugins;
        }
    };
    for plugin in &mut plugins {
        let installed_version = installed
            .iter()
            .find(|i| i.id == plugin.id)
            .map(|i| i.version.clone());
        let action =
            registry::classify_install(installed_version.as_deref(), &plugin.latest_version);
        plugin.installed_version = installed_version;
        plugin.update_available = matches!(action, registry::InstallAction::Update);
    }
    plugins
}

fn read_disk_cache(path: &Path) -> Option<DiskRegistryCache> {
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

fn write_disk_cache(path: &Path, cache: &DiskRegistryCache) {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    match serde_json::to_string(cache) {
        Ok(content) => {
            if let Err(e) = fs::write(path, content) {
                log::warn!("registry cache: failed to write {}: {e}", path.display());
            }
        }
        Err(e) => log::warn!("registry cache: failed to serialize: {e}"),
    }
}

/// Return a cached catalogue when memory or disk is still fresh for `registry_key`.
/// Install status is always reconciled against the current plugins directory.
pub fn get_registry(registry_key: &str) -> Option<Vec<RegistryPluginWithStatus>> {
    if let Ok(guard) = REGISTRY.lock() {
        if let Some(entry) = guard.as_ref() {
            if entry.registry_key == registry_key
                && entry.fetched_at.elapsed() <= REGISTRY_TTL
                && ttl_fresh(entry.fetched_at_unix)
            {
                return Some(reconcile_install_status(entry.plugins.clone()));
            }
        }
    }

    let path = disk_cache_path();
    let disk = read_disk_cache(&path)?;
    if disk.registry_key != registry_key || !ttl_fresh(disk.fetched_at) {
        return None;
    }

    let age_secs = now_unix().saturating_sub(disk.fetched_at);
    let plugins = reconcile_install_status(disk.plugins.clone());
    if let Ok(mut guard) = REGISTRY.lock() {
        *guard = Some(RegistryCache {
            // Approximate Instant so in-session TTL matches remaining wall time.
            fetched_at: Instant::now()
                .checked_sub(Duration::from_secs(age_secs))
                .unwrap_or_else(Instant::now),
            fetched_at_unix: disk.fetched_at,
            registry_key: disk.registry_key,
            plugins: plugins.clone(),
        });
    }
    log::info!(
        "plugin registry: serving disk cache ({} plugins, age {}s)",
        plugins.len(),
        age_secs
    );
    Some(plugins)
}

pub fn set_registry(registry_key: &str, plugins: Vec<RegistryPluginWithStatus>) {
    let fetched_at_unix = now_unix();
    if let Ok(mut guard) = REGISTRY.lock() {
        *guard = Some(RegistryCache {
            fetched_at: Instant::now(),
            fetched_at_unix,
            registry_key: registry_key.to_string(),
            plugins: plugins.clone(),
        });
    }
    write_disk_cache(
        &disk_cache_path(),
        &DiskRegistryCache {
            fetched_at: fetched_at_unix,
            registry_key: registry_key.to_string(),
            plugins,
        },
    );
}

/// Clear the in-memory catalogue. Disk is kept so a later soft read (or
/// process restart) can re-merge install status without networking.
pub fn invalidate_registry() {
    if let Ok(mut guard) = REGISTRY.lock() {
        *guard = None;
    }
}

pub fn list_installed_cached() -> Result<Vec<InstalledPluginInfo>, String> {
    if let Ok(guard) = INSTALLED.lock() {
        if let Some(entry) = guard.as_ref() {
            if entry.fetched_at.elapsed() <= INSTALLED_TTL {
                return Ok(entry.plugins.clone());
            }
        }
    }
    let plugins = installer::list_installed()?;
    if let Ok(mut guard) = INSTALLED.lock() {
        *guard = Some(InstalledCache {
            fetched_at: Instant::now(),
            plugins: plugins.clone(),
        });
    }
    Ok(plugins)
}

pub fn invalidate_installed() {
    if let Ok(mut guard) = INSTALLED.lock() {
        *guard = None;
    }
}

/// Drop memory caches (install / uninstall / enable that changes what's on disk).
pub fn invalidate_all() {
    invalidate_registry();
    invalidate_installed();
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn sample_plugin(id: &str, latest: &str) -> RegistryPluginWithStatus {
        RegistryPluginWithStatus {
            id: id.to_string(),
            name: id.to_string(),
            description: String::new(),
            author: String::new(),
            homepage: String::new(),
            latest_version: latest.to_string(),
            releases: vec![],
            installed_version: None,
            update_available: false,
            platform_supported: true,
            icon: None,
            repo_url: None,
            kind: None,
            tags: vec![],
            category: None,
            downloads: None,
            registry_base_url: None,
            engine: None,
            paradigms: vec![],
            verified: false,
            install_action: None,
            signature: None,
        }
    }

    fn with_temp_cache_dir<R>(f: impl FnOnce() -> R) -> R {
        let dir = tempdir().expect("tempdir");
        {
            let mut guard = TEST_CACHE_DIR.lock().unwrap();
            *guard = Some(dir.path().to_path_buf());
        }
        invalidate_registry();
        invalidate_installed();
        let result = f();
        invalidate_registry();
        invalidate_installed();
        {
            let mut guard = TEST_CACHE_DIR.lock().unwrap();
            *guard = None;
        }
        result
    }

    #[test]
    fn disk_survives_memory_invalidate() {
        with_temp_cache_dir(|| {
            let key = "https://example.test/registry";
            set_registry(key, vec![sample_plugin("postgresql", "1.2.3")]);
            invalidate_registry();
            let loaded = get_registry(key).expect("disk cache should serve after memory clear");
            assert_eq!(loaded.len(), 1);
            assert_eq!(loaded[0].id, "postgresql");
            assert_eq!(loaded[0].latest_version, "1.2.3");
        });
    }

    #[test]
    fn wrong_registry_key_misses() {
        with_temp_cache_dir(|| {
            set_registry("https://a.test", vec![sample_plugin("x", "1.0.0")]);
            invalidate_registry();
            assert!(get_registry("https://b.test").is_none());
        });
    }

    #[test]
    fn disk_helpers_round_trip() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(CACHE_FILE_NAME);
        let cache = DiskRegistryCache {
            fetched_at: now_unix(),
            registry_key: "https://example.test".into(),
            plugins: vec![sample_plugin("postgresql", "1.0.0")],
        };
        write_disk_cache(&path, &cache);
        let loaded = read_disk_cache(&path).expect("load");
        assert_eq!(loaded.registry_key, cache.registry_key);
        assert_eq!(loaded.plugins.len(), 1);
        assert_eq!(loaded.plugins[0].id, "postgresql");
    }

    #[test]
    fn ttl_fresh_rejects_stale() {
        assert!(ttl_fresh(now_unix()));
        assert!(!ttl_fresh(0));
    }
}
