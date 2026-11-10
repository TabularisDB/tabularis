//! Plugin-owned connection secrets.
//!
//! A driver plugin can ask the connection modal to store some of its `extra`
//! fields as secrets (`setSecretField` in the `connection-modal.extra_fields`
//! slot). Only the field names are persisted, as
//! [`SavedConnection::plugin_secret_keys`]; the values live in the OS keychain
//! under `<connection id>:plugin:<driver>:<key>` and are resolved into
//! `params.extra` in memory, right before a driver call. They never reach
//! `connections.json` and are never returned to the frontend.

use std::collections::{HashMap, HashSet};

use crate::credential_cache::{self, CredentialCache};
use crate::models::{ConnectionParams, SavedConnection};

pub type PluginSecretChanges = HashMap<String, Option<String>>;

const MAX_SECRET_KEY_LENGTH: usize = 64;
const MAX_SECRET_VALUE_LENGTH: usize = 1024 * 1024;

pub fn validate_secret_changes(changes: &PluginSecretChanges) -> Result<(), String> {
    for (key, value) in changes {
        validate_secret_key(key)?;
        if value
            .as_ref()
            .is_some_and(|value| value.len() > MAX_SECRET_VALUE_LENGTH)
        {
            return Err(format!(
                "Plugin secret '{}' exceeds the maximum size of {} bytes",
                key, MAX_SECRET_VALUE_LENGTH
            ));
        }
    }
    Ok(())
}

pub fn validate_secret_key(key: &str) -> Result<(), String> {
    if key.is_empty()
        || key.len() > MAX_SECRET_KEY_LENGTH
        || !key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.'))
    {
        return Err(format!(
            "Invalid plugin secret key '{}': use 1-{} ASCII letters, digits, '.', '_' or '-'",
            key, MAX_SECRET_KEY_LENGTH
        ));
    }
    Ok(())
}

pub fn next_secret_keys(
    existing: &[String],
    same_driver: bool,
    changes: &PluginSecretChanges,
) -> Result<Vec<String>, String> {
    validate_secret_changes(changes)?;
    let mut keys: HashSet<String> = if same_driver {
        existing.iter().cloned().collect()
    } else {
        HashSet::new()
    };
    for (key, value) in changes {
        if value.is_some() {
            keys.insert(key.clone());
        } else {
            keys.remove(key);
        }
    }
    let mut keys: Vec<String> = keys.into_iter().collect();
    keys.sort();
    Ok(keys)
}

/// Resolve the stored plugin secrets of `connection` into `params.extra`.
///
/// Lenient by design: a key whose keychain entry is missing (connections file
/// synced to another machine, keychain reset, entry deleted by hand) or cannot
/// be read (locked keychain, access denied) is logged and left unset, and the
/// call goes on. The plugin then reports the missing credential itself, which
/// is a far better failure than every query, dump and MCP call of the
/// connection erroring out on the host side.
pub fn hydrate_connection(cache: &CredentialCache, connection: &mut SavedConnection) {
    let values = load_secret_values(
        cache,
        &connection.id,
        &connection.params.driver,
        &connection.plugin_secret_keys,
    );
    connection.params.extra.extend(values);
}

/// Read the stored values of `keys` through the credential cache. Keys that
/// are invalid, missing or unreadable are skipped with a warning (see
/// [`resolve_secret_values`]). This is the single read path shared by driver
/// calls, Test Connection, export, backups and duplicate.
pub fn load_secret_values(
    cache: &CredentialCache,
    connection_id: &str,
    driver: &str,
    keys: &[String],
) -> HashMap<String, String> {
    resolve_secret_values(connection_id, keys, |key| {
        credential_cache::get_plugin_secret_cached(cache, connection_id, driver, key)
    })
    .values
}

/// Plugin secret values read for one connection, plus the keys that could not
/// be resolved.
#[derive(Debug, Default)]
pub struct ResolvedSecrets {
    pub values: HashMap<String, String>,
    pub unavailable: Vec<String>,
}

/// Read `keys` with `read`, never failing. Invalid key names, missing entries
/// (`Ok(None)`) and read errors are logged by key name (never by value) and
/// reported in [`ResolvedSecrets::unavailable`].
pub fn resolve_secret_values(
    connection_id: &str,
    keys: &[String],
    mut read: impl FnMut(&str) -> Result<Option<String>, String>,
) -> ResolvedSecrets {
    let mut resolved = ResolvedSecrets::default();
    for key in keys {
        if validate_secret_key(key).is_err() {
            log::warn!(
                "Skipping invalid plugin secret key of connection {}",
                connection_id
            );
            resolved.unavailable.push(key.clone());
            continue;
        }
        match read(key) {
            Ok(Some(value)) => {
                resolved.values.insert(key.clone(), value);
            }
            Ok(None) => {
                log::warn!(
                    "Plugin secret '{}' of connection {} is missing from the keychain; leaving it unset",
                    key,
                    connection_id
                );
                resolved.unavailable.push(key.clone());
            }
            Err(error) => {
                log::warn!(
                    "Failed to read plugin secret '{}' of connection {}; leaving it unset: {}",
                    key,
                    connection_id,
                    error
                );
                resolved.unavailable.push(key.clone());
            }
        }
    }
    resolved
}

/// Secret changes that give a duplicate of a connection its own copy of every
/// value that can still be read. Unavailable keys are not carried over, so the
/// copy never lists a secret it does not have.
pub fn duplicate_secret_changes(
    connection_id: &str,
    keys: &[String],
    read: impl FnMut(&str) -> Result<Option<String>, String>,
) -> PluginSecretChanges {
    resolve_secret_values(connection_id, keys, read)
        .values
        .into_iter()
        .map(|(key, value)| (key, Some(value)))
        .collect()
}

/// Resolve the plugin secrets for an ad-hoc driver call made with params sent
/// by the connection modal (Test Connection, Load Databases). Stored values of
/// `saved` are loaded only while the driver is unchanged, and only for the
/// keys the pending `changes` do not already set or clear.
pub fn apply_request_secrets(
    cache: &CredentialCache,
    saved: Option<&SavedConnection>,
    params: &mut ConnectionParams,
    changes: &PluginSecretChanges,
) -> Result<(), String> {
    let stored = match saved.filter(|saved| saved.params.driver == params.driver) {
        Some(saved) => {
            let unresolved: Vec<String> = saved
                .plugin_secret_keys
                .iter()
                .filter(|key| !changes.contains_key(*key))
                .cloned()
                .collect();
            load_secret_values(cache, &saved.id, &saved.params.driver, &unresolved)
        }
        None => HashMap::new(),
    };
    apply_runtime_changes(params, stored, changes)
}

pub fn apply_runtime_changes(
    params: &mut ConnectionParams,
    stored_values: HashMap<String, String>,
    changes: &PluginSecretChanges,
) -> Result<(), String> {
    validate_secret_changes(changes)?;
    params.extra.extend(stored_values);
    for (key, value) in changes {
        match value {
            Some(value) => _ = params.extra.insert(key.clone(), value.clone()),
            None => _ = params.extra.remove(key),
        }
    }
    Ok(())
}

pub fn persist_secret_changes(
    cache: &CredentialCache,
    connection_id: &str,
    old_driver: Option<&str>,
    old_keys: &[String],
    new_driver: &str,
    changes: &PluginSecretChanges,
    persist: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    validate_secret_changes(changes)?;
    let same_driver = match old_driver {
        None => true,
        Some(driver) => driver == new_driver,
    };
    let mut affected: Vec<(String, String)> = if same_driver {
        changes
            .keys()
            .map(|key| (new_driver.to_string(), key.clone()))
            .collect()
    } else {
        old_keys
            .iter()
            .map(|key| (old_driver.unwrap_or_default().to_string(), key.clone()))
            .chain(
                changes
                    .keys()
                    .map(|key| (new_driver.to_string(), key.clone())),
            )
            .collect()
    };
    affected.sort();
    affected.dedup();

    let mut snapshots = Vec::with_capacity(affected.len());
    for (driver, key) in &affected {
        let previous = crate::keychain_utils::get_plugin_secret(connection_id, driver, key)?;
        snapshots.push((driver.clone(), key.clone(), previous));
    }

    let apply_result = (|| {
        if !same_driver {
            let old_driver = old_driver.unwrap_or_default();
            for key in old_keys {
                crate::keychain_utils::delete_plugin_secret(connection_id, old_driver, key)?;
                credential_cache::invalidate_plugin_secret(cache, connection_id, old_driver, key);
            }
        }
        for (key, value) in changes {
            match value {
                Some(value) => {
                    crate::keychain_utils::set_plugin_secret(
                        connection_id,
                        new_driver,
                        key,
                        value,
                    )?;
                    credential_cache::set_plugin_secret_cached(
                        cache,
                        connection_id,
                        new_driver,
                        key,
                        value,
                    );
                }
                None => {
                    crate::keychain_utils::delete_plugin_secret(connection_id, new_driver, key)?;
                    credential_cache::invalidate_plugin_secret(
                        cache,
                        connection_id,
                        new_driver,
                        key,
                    );
                }
            }
        }
        persist()
    })();

    if apply_result.is_ok() {
        return Ok(());
    }

    let original_error = apply_result.unwrap_err();
    let mut rollback_errors = Vec::new();
    for (driver, key, previous) in snapshots {
        let result = match previous {
            Some(value) => {
                crate::keychain_utils::set_plugin_secret(connection_id, &driver, &key, &value).map(
                    |()| {
                        credential_cache::set_plugin_secret_cached(
                            cache,
                            connection_id,
                            &driver,
                            &key,
                            &value,
                        );
                    },
                )
            }
            None => crate::keychain_utils::delete_plugin_secret(connection_id, &driver, &key).map(
                |()| {
                    credential_cache::invalidate_plugin_secret(cache, connection_id, &driver, &key);
                },
            ),
        };
        if let Err(error) = result {
            rollback_errors.push(error);
        }
    }

    if rollback_errors.is_empty() {
        Err(original_error)
    } else {
        Err(format!(
            "{} (failed to roll back plugin secrets: {})",
            original_error,
            rollback_errors.join("; ")
        ))
    }
}

/// A plugin secret write deferred until the connections file is saved.
#[derive(Clone, PartialEq, Eq)]
pub enum SecretWrite {
    Set {
        connection_id: String,
        driver: String,
        key: String,
        value: String,
    },
    Delete {
        connection_id: String,
        driver: String,
        key: String,
    },
}

// Hand-written so a secret value never ends up in a log or a test failure.
impl std::fmt::Debug for SecretWrite {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Set {
                connection_id,
                driver,
                key,
                ..
            } => f
                .debug_struct("Set")
                .field("connection_id", connection_id)
                .field("driver", driver)
                .field("key", key)
                .finish_non_exhaustive(),
            Self::Delete {
                connection_id,
                driver,
                key,
            } => f
                .debug_struct("Delete")
                .field("connection_id", connection_id)
                .field("driver", driver)
                .field("key", key)
                .finish(),
        }
    }
}

/// Keychain operations on plugin secrets. The production implementation is
/// [`KeychainSecretStore`]; tests use an in-memory store.
pub trait SecretStore {
    fn set(&self, connection_id: &str, driver: &str, key: &str, value: &str) -> Result<(), String>;
    fn delete(&self, connection_id: &str, driver: &str, key: &str) -> Result<(), String>;
}

pub struct KeychainSecretStore;

impl SecretStore for KeychainSecretStore {
    fn set(&self, connection_id: &str, driver: &str, key: &str, value: &str) -> Result<(), String> {
        crate::keychain_utils::set_plugin_secret(connection_id, driver, key, value)
    }

    fn delete(&self, connection_id: &str, driver: &str, key: &str) -> Result<(), String> {
        crate::keychain_utils::delete_plugin_secret(connection_id, driver, key)
    }
}

/// Work out the plugin secret keys and deferred keychain writes of one
/// imported connection. The payload is untrusted: invalid key names and
/// oversized values are skipped with a warning instead of aborting the import.
///
/// Every declared or imported secret key is removed from `params.extra`, so a
/// value never lands in `connections.json`. Imported values are "set" changes:
/// keys the payload does not carry keep their stored value while the driver is
/// unchanged; when it changed, the previous driver's secrets are deleted.
pub fn plan_imported_secrets(
    connection: &mut SavedConnection,
    declared_keys: &[String],
    imported_values: HashMap<String, String>,
    previous: Option<(&str, &[String])>,
) -> Vec<SecretWrite> {
    for key in declared_keys {
        connection.params.extra.remove(key);
    }
    let mut changes = PluginSecretChanges::new();
    for (key, value) in imported_values {
        connection.params.extra.remove(&key);
        let change = HashMap::from([(key.clone(), Some(value))]);
        if validate_secret_changes(&change).is_err() {
            log::warn!(
                "Skipping an invalid plugin secret of imported connection {}",
                connection.id
            );
            continue;
        }
        changes.extend(change);
    }

    let driver = connection.params.driver.clone();
    let kept_keys: Vec<String> = match previous {
        Some((old_driver, old_keys)) if old_driver == driver => old_keys
            .iter()
            .filter(|key| validate_secret_key(key).is_ok())
            .cloned()
            .collect(),
        _ => Vec::new(),
    };
    connection.plugin_secret_keys =
        next_secret_keys(&kept_keys, true, &changes).unwrap_or(kept_keys);

    let mut writes: Vec<SecretWrite> = Vec::new();
    if let Some((old_driver, old_keys)) = previous {
        if old_driver != driver {
            let valid_old_keys = old_keys
                .iter()
                .filter(|key| validate_secret_key(key).is_ok());
            writes.extend(valid_old_keys.map(|key| SecretWrite::Delete {
                connection_id: connection.id.clone(),
                driver: old_driver.to_string(),
                key: key.clone(),
            }));
        }
    }
    let mut changes: Vec<(String, Option<String>)> = changes.into_iter().collect();
    changes.sort_by(|a, b| a.0.cmp(&b.0));
    writes.extend(changes.into_iter().filter_map(|(key, value)| {
        value.map(|value| SecretWrite::Set {
            connection_id: connection.id.clone(),
            driver: driver.clone(),
            key,
            value,
        })
    }));
    writes
}

/// Run `save` (the connections file write) and, only once it succeeded, apply
/// the deferred plugin secret `writes`. A failed save therefore never leaves
/// orphaned secrets in the keychain. A keychain write that fails after the
/// save is logged and skipped: the connection lists the key, and runtime
/// hydration leaves it unset so the plugin reports the missing credential.
pub fn commit_secret_writes(
    store: &impl SecretStore,
    cache: &CredentialCache,
    writes: Vec<SecretWrite>,
    save: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    save()?;
    for write in writes {
        match write {
            SecretWrite::Set {
                connection_id,
                driver,
                key,
                value,
            } => match store.set(&connection_id, &driver, &key, &value) {
                Ok(()) => credential_cache::set_plugin_secret_cached(
                    cache,
                    &connection_id,
                    &driver,
                    &key,
                    &value,
                ),
                Err(error) => {
                    credential_cache::invalidate_plugin_secret(
                        cache,
                        &connection_id,
                        &driver,
                        &key,
                    );
                    log::warn!(
                        "Failed to store imported plugin secret '{}' of connection {}: {}",
                        key,
                        connection_id,
                        error
                    );
                }
            },
            SecretWrite::Delete {
                connection_id,
                driver,
                key,
            } => {
                if let Err(error) = store.delete(&connection_id, &driver, &key) {
                    log::warn!(
                        "Failed to delete plugin secret '{}' of connection {}: {}",
                        key,
                        connection_id,
                        error
                    );
                }
                credential_cache::invalidate_plugin_secret(cache, &connection_id, &driver, &key);
            }
        }
    }
    Ok(())
}

pub fn delete_connection_secrets(
    cache: &CredentialCache,
    connection_id: &str,
    driver: &str,
    keys: &[String],
) {
    for key in keys {
        let _ = crate::keychain_utils::delete_plugin_secret(connection_id, driver, key);
        credential_cache::invalidate_plugin_secret(cache, connection_id, driver, key);
    }
}

#[cfg(test)]
#[path = "plugin_secrets_tests.rs"]
mod tests;
