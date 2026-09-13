//! Process-lifetime caches for plugin registry catalogue and installed-plugin
//! directory scans. Default reads hit these caches; callers pass `force` (or
//! call [`invalidate_all`]) after install/uninstall / explicit Refresh.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use once_cell::sync::Lazy;

use crate::plugins::installer::{self, InstalledPluginInfo};
use crate::plugins::registry::RegistryPluginWithStatus;

/// How long a successful registry fetch may be reused without hitting the network.
const REGISTRY_TTL: Duration = Duration::from_secs(15 * 60);
/// How long a plugins-dir scan may be reused (cheap, but still avoids thrashing
/// when Connections mounts multiple hooks).
const INSTALLED_TTL: Duration = Duration::from_secs(60);

struct RegistryCache {
    fetched_at: Instant,
    plugins: Vec<RegistryPluginWithStatus>,
}

struct InstalledCache {
    fetched_at: Instant,
    plugins: Vec<InstalledPluginInfo>,
}

static REGISTRY: Lazy<Mutex<Option<RegistryCache>>> = Lazy::new(|| Mutex::new(None));
static INSTALLED: Lazy<Mutex<Option<InstalledCache>>> = Lazy::new(|| Mutex::new(None));

pub fn get_registry() -> Option<Vec<RegistryPluginWithStatus>> {
    let guard = REGISTRY.lock().ok()?;
    let entry = guard.as_ref()?;
    if entry.fetched_at.elapsed() > REGISTRY_TTL {
        return None;
    }
    Some(entry.plugins.clone())
}

pub fn set_registry(plugins: Vec<RegistryPluginWithStatus>) {
    if let Ok(mut guard) = REGISTRY.lock() {
        *guard = Some(RegistryCache {
            fetched_at: Instant::now(),
            plugins,
        });
    }
}

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

/// Drop both caches (install / uninstall / enable that changes what's on disk).
pub fn invalidate_all() {
    invalidate_registry();
    invalidate_installed();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_cache_round_trip() {
        invalidate_registry();
        assert!(get_registry().is_none());
        set_registry(vec![]);
        assert!(get_registry().is_some());
        invalidate_registry();
        assert!(get_registry().is_none());
    }
}
