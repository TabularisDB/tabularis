use std::collections::HashMap;
use std::sync::Mutex;

/// Cached credential value.
/// `Present` = keychain returned a value.
/// `Absent`  = keychain confirmed no entry exists (NoEntry). Caching misses
///              avoids redundant IPC round-trips on every DB command.
#[derive(Clone, Debug)]
pub enum CacheEntry {
    Present(String),
    Absent,
}

/// In-memory credential cache backed by four HashMaps.
///
/// Uses `std::sync::Mutex` (not `tokio::sync::Mutex`) because all critical
/// sections are pure HashMap operations (nanoseconds) and are never held
/// across `.await` points. Wrapping the struct in `Arc` lets callers clone
/// it into `tokio::task::spawn_blocking` closures.
pub struct CredentialCache {
    pub db_passwords:    Mutex<HashMap<String, CacheEntry>>,
    pub ssh_passwords:   Mutex<HashMap<String, CacheEntry>>,
    pub ssh_passphrases: Mutex<HashMap<String, CacheEntry>>,
    pub ai_keys:         Mutex<HashMap<String, CacheEntry>>,
}

impl Default for CredentialCache {
    fn default() -> Self {
        Self {
            db_passwords:    Mutex::new(HashMap::new()),
            ssh_passwords:   Mutex::new(HashMap::new()),
            ssh_passphrases: Mutex::new(HashMap::new()),
            ai_keys:         Mutex::new(HashMap::new()),
        }
    }
}

// ─── Read-through helpers ─────────────────────────────────────────────────────
// These functions are synchronous and intended to be called from inside
// `tokio::task::spawn_blocking` when used in async contexts.

/// Get DB password: check cache first, fall through to keychain on miss.
pub fn get_db_password_cached(cache: &CredentialCache, connection_id: &str) -> Result<String, String> {
    {
        let guard = cache.db_passwords.lock().unwrap();
        match guard.get(connection_id) {
            Some(CacheEntry::Present(v)) => return Ok(v.clone()),
            Some(CacheEntry::Absent)     => return Err("No entry".to_string()),
            None => {}
        }
    }
    let result = crate::keychain_utils::get_db_password(connection_id, "");
    {
        let mut guard = cache.db_passwords.lock().unwrap();
        guard.insert(connection_id.to_string(), match &result {
            Ok(v)  => CacheEntry::Present(v.clone()),
            Err(_) => CacheEntry::Absent,
        });
    }
    result
}

/// Get SSH password: check cache first, fall through to keychain on miss.
pub fn get_ssh_password_cached(cache: &CredentialCache, connection_id: &str) -> Result<String, String> {
    {
        let guard = cache.ssh_passwords.lock().unwrap();
        match guard.get(connection_id) {
            Some(CacheEntry::Present(v)) => return Ok(v.clone()),
            Some(CacheEntry::Absent)     => return Err("No entry".to_string()),
            None => {}
        }
    }
    let result = crate::keychain_utils::get_ssh_password(connection_id, "");
    {
        let mut guard = cache.ssh_passwords.lock().unwrap();
        guard.insert(connection_id.to_string(), match &result {
            Ok(v)  => CacheEntry::Present(v.clone()),
            Err(_) => CacheEntry::Absent,
        });
    }
    result
}

/// Get SSH key passphrase: check cache first, fall through to keychain on miss.
pub fn get_ssh_key_passphrase_cached(cache: &CredentialCache, connection_id: &str) -> Result<String, String> {
    {
        let guard = cache.ssh_passphrases.lock().unwrap();
        match guard.get(connection_id) {
            Some(CacheEntry::Present(v)) => return Ok(v.clone()),
            Some(CacheEntry::Absent)     => return Err("No entry".to_string()),
            None => {}
        }
    }
    let result = crate::keychain_utils::get_ssh_key_passphrase(connection_id, "");
    {
        let mut guard = cache.ssh_passphrases.lock().unwrap();
        guard.insert(connection_id.to_string(), match &result {
            Ok(v)  => CacheEntry::Present(v.clone()),
            Err(_) => CacheEntry::Absent,
        });
    }
    result
}

/// Get AI API key: check cache first, fall through to keychain on miss.
pub fn get_ai_key_cached(cache: &CredentialCache, provider: &str) -> Result<String, String> {
    {
        let guard = cache.ai_keys.lock().unwrap();
        match guard.get(provider) {
            Some(CacheEntry::Present(v)) => return Ok(v.clone()),
            Some(CacheEntry::Absent)     => return Err("No entry".to_string()),
            None => {}
        }
    }
    let result = crate::keychain_utils::get_ai_key(provider);
    {
        let mut guard = cache.ai_keys.lock().unwrap();
        guard.insert(provider.to_string(), match &result {
            Ok(v)  => CacheEntry::Present(v.clone()),
            Err(_) => CacheEntry::Absent,
        });
    }
    result
}

// ─── Write-through helpers ────────────────────────────────────────────────────
// Call these AFTER the corresponding keychain_utils::set_* succeeds.

pub fn set_db_password_cached(cache: &CredentialCache, connection_id: &str, password: &str) {
    cache.db_passwords.lock().unwrap()
        .insert(connection_id.to_string(), CacheEntry::Present(password.to_string()));
}

pub fn set_ssh_password_cached(cache: &CredentialCache, connection_id: &str, password: &str) {
    cache.ssh_passwords.lock().unwrap()
        .insert(connection_id.to_string(), CacheEntry::Present(password.to_string()));
}

pub fn set_ssh_key_passphrase_cached(cache: &CredentialCache, connection_id: &str, passphrase: &str) {
    cache.ssh_passphrases.lock().unwrap()
        .insert(connection_id.to_string(), CacheEntry::Present(passphrase.to_string()));
}

pub fn set_ai_key_cached(cache: &CredentialCache, provider: &str, key: &str) {
    cache.ai_keys.lock().unwrap()
        .insert(provider.to_string(), CacheEntry::Present(key.to_string()));
}

// ─── Invalidation helpers ─────────────────────────────────────────────────────
// Call these AFTER the corresponding keychain_utils::delete_* succeeds.
// Removing the entry forces the next read to re-query the keychain (which will
// return NoEntry, caching Absent).

pub fn invalidate_db_password(cache: &CredentialCache, connection_id: &str) {
    cache.db_passwords.lock().unwrap().remove(connection_id);
}

pub fn invalidate_ssh_password(cache: &CredentialCache, connection_id: &str) {
    cache.ssh_passwords.lock().unwrap().remove(connection_id);
}

pub fn invalidate_ssh_key_passphrase(cache: &CredentialCache, connection_id: &str) {
    cache.ssh_passphrases.lock().unwrap().remove(connection_id);
}

pub fn invalidate_ai_key(cache: &CredentialCache, provider: &str) {
    cache.ai_keys.lock().unwrap().remove(provider);
}

/// Invalidate all cached credentials for a connection ID (e.g. on delete).
pub fn invalidate_all_for_connection(cache: &CredentialCache, connection_id: &str) {
    cache.db_passwords.lock().unwrap().remove(connection_id);
    cache.ssh_passwords.lock().unwrap().remove(connection_id);
    cache.ssh_passphrases.lock().unwrap().remove(connection_id);
}
