use std::collections::HashMap;
use std::sync::Mutex;

use crate::models::SavedConnection;

pub enum CacheLookup {
    Hit(SavedConnection),
    Miss,
    Cold,
}

/// In-memory cache for saved connections, keyed by connection ID.
///
/// Uses `std::sync::Mutex` (not `tokio::sync::Mutex`) because all critical
/// sections are pure HashMap operations (nanoseconds) and are never held
/// across `.await` points.
pub struct ConnectionCache {
    entries: Mutex<Option<HashMap<String, SavedConnection>>>,
}

impl Default for ConnectionCache {
    fn default() -> Self {
        Self {
            entries: Mutex::new(None),
        }
    }
}

impl ConnectionCache {
    /// Atomically look up a connection by ID.
    /// Returns Cold when the cache has never been populated, Miss when it has
    /// been populated but the ID is absent, Hit when found.
    pub fn lookup(&self, id: &str) -> CacheLookup {
        let guard = self.entries.lock().unwrap();
        match guard.as_ref() {
            None => CacheLookup::Cold,
            Some(map) => match map.get(id) {
                Some(conn) => CacheLookup::Hit(conn.clone()),
                None => CacheLookup::Miss,
            },
        }
    }

    /// Fill the cache from a full connection list (called on Cold miss).
    pub fn populate(&self, connections: &[SavedConnection]) {
        let map = connections
            .iter()
            .map(|c| (c.id.clone(), c.clone()))
            .collect();
        *self.entries.lock().unwrap() = Some(map);
    }

    /// Discard cached data. Must be called after any write to the connections file.
    pub fn invalidate(&self) {
        *self.entries.lock().unwrap() = None;
    }
}
