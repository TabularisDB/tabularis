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

pub fn hydrate_connection(
    cache: &CredentialCache,
    connection: &mut SavedConnection,
) -> Result<(), String> {
    let values = load_secret_values(
        cache,
        &connection.id,
        &connection.params.driver,
        &connection.plugin_secret_keys,
    )?;
    connection.params.extra.extend(values);
    Ok(())
}

pub fn load_secret_values(
    cache: &CredentialCache,
    connection_id: &str,
    driver: &str,
    keys: &[String],
) -> Result<HashMap<String, String>, String> {
    let mut values = HashMap::new();
    for key in keys {
        validate_secret_key(key)?;
        let value = credential_cache::get_plugin_secret_cached(cache, connection_id, driver, key)?
            .ok_or_else(|| format!("Stored plugin secret '{}' is unavailable", key))?;
        values.insert(key.clone(), value);
    }
    Ok(values)
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
mod tests {
    use super::*;

    #[test]
    fn preserves_existing_keys_and_applies_tri_state_changes() {
        let changes = HashMap::from([
            ("replace".to_string(), Some("new".to_string())),
            ("remove".to_string(), None),
            ("add".to_string(), Some("value".to_string())),
        ]);
        let keys = next_secret_keys(
            &["keep".into(), "replace".into(), "remove".into()],
            true,
            &changes,
        )
        .unwrap();
        assert_eq!(keys, vec!["add", "keep", "replace"]);
    }

    #[test]
    fn changing_driver_drops_old_keys() {
        let changes = HashMap::from([("new-token".to_string(), Some("x".to_string()))]);
        let keys = next_secret_keys(&["old-token".into()], false, &changes).unwrap();
        assert_eq!(keys, vec!["new-token"]);
    }

    #[test]
    fn runtime_changes_merge_stored_values_and_apply_replacements_and_clears() {
        let mut params = ConnectionParams {
            extra: HashMap::from([
                ("region".to_string(), "EU".to_string()),
                ("remove".to_string(), "stale".to_string()),
            ]),
            ..Default::default()
        };
        let stored = HashMap::from([
            ("keep".to_string(), "stored".to_string()),
            ("replace".to_string(), "old".to_string()),
        ]);
        let changes = HashMap::from([
            ("replace".to_string(), Some("new".to_string())),
            ("remove".to_string(), None),
        ]);

        apply_runtime_changes(&mut params, stored, &changes).unwrap();

        assert_eq!(params.extra.get("region").map(String::as_str), Some("EU"));
        assert_eq!(params.extra.get("keep").map(String::as_str), Some("stored"));
        assert_eq!(params.extra.get("replace").map(String::as_str), Some("new"));
        assert!(!params.extra.contains_key("remove"));
    }

    #[test]
    fn rejects_keys_that_could_escape_the_keychain_namespace() {
        assert!(validate_secret_key("credential").is_ok());
        assert!(validate_secret_key("oauth.refresh_token").is_ok());
        assert!(validate_secret_key("bad:key").is_err());
        assert!(validate_secret_key("").is_err());
    }
}
