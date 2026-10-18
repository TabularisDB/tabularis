use std::cell::RefCell;

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

fn saved_connection(driver: &str, keys: &[&str]) -> SavedConnection {
    SavedConnection {
        id: "conn-1".to_string(),
        name: "Plugin".to_string(),
        params: ConnectionParams {
            driver: driver.to_string(),
            ..Default::default()
        },
        plugin_secret_keys: keys.iter().map(|key| key.to_string()).collect(),
        group_id: None,
        sort_order: None,
        detect_json_in_text_columns: None,
        appearance: None,
        tag_ids: None,
        environment: None,
    }
}

#[test]
fn request_secrets_resolve_stored_values_and_apply_pending_changes() {
    let cache = CredentialCache::default();
    credential_cache::set_plugin_secret_cached(
        &cache,
        "conn-1",
        "bigquery",
        "credential",
        "stored",
    );
    credential_cache::set_plugin_secret_cached(&cache, "conn-1", "bigquery", "token", "old");
    let saved = saved_connection("bigquery", &["credential", "token"]);
    let mut params = ConnectionParams {
        driver: "bigquery".to_string(),
        extra: HashMap::from([("location".to_string(), "EU".to_string())]),
        ..Default::default()
    };
    let changes = HashMap::from([
        ("token".to_string(), None),
        ("refresh".to_string(), Some("typed".to_string())),
    ]);

    apply_request_secrets(&cache, Some(&saved), &mut params, &changes).unwrap();

    assert_eq!(params.extra.get("location").map(String::as_str), Some("EU"));
    assert_eq!(
        params.extra.get("credential").map(String::as_str),
        Some("stored")
    );
    assert_eq!(
        params.extra.get("refresh").map(String::as_str),
        Some("typed")
    );
    assert!(!params.extra.contains_key("token"));
}

#[test]
fn request_secrets_ignore_stored_values_of_another_driver() {
    let cache = CredentialCache::default();
    credential_cache::set_plugin_secret_cached(
        &cache,
        "conn-1",
        "bigquery",
        "credential",
        "stored",
    );
    let saved = saved_connection("bigquery", &["credential"]);
    let mut params = ConnectionParams {
        driver: "postgresql".to_string(),
        ..Default::default()
    };

    apply_request_secrets(&cache, Some(&saved), &mut params, &HashMap::new()).unwrap();

    assert!(params.extra.is_empty());
}

#[test]
fn request_secrets_without_saved_connection_only_apply_changes() {
    let cache = CredentialCache::default();
    let mut params = ConnectionParams::default();
    let changes = HashMap::from([("credential".to_string(), Some("typed".to_string()))]);

    apply_request_secrets(&cache, None, &mut params, &changes).unwrap();

    assert_eq!(
        params.extra.get("credential").map(String::as_str),
        Some("typed")
    );
}

#[test]
fn request_secrets_reject_invalid_change_keys() {
    let cache = CredentialCache::default();
    let mut params = ConnectionParams::default();
    let changes = HashMap::from([("bad:key".to_string(), Some("x".to_string()))]);

    assert!(apply_request_secrets(&cache, None, &mut params, &changes).is_err());
}

#[test]
fn available_secret_values_skip_invalid_keys() {
    let cache = CredentialCache::default();
    credential_cache::set_plugin_secret_cached(
        &cache,
        "conn-1",
        "bigquery",
        "credential",
        "stored",
    );

    let values = load_secret_values(
        &cache,
        "conn-1",
        "bigquery",
        &["credential".to_string(), "bad:key".to_string()],
    );

    assert_eq!(values.len(), 1);
    assert_eq!(values.get("credential").map(String::as_str), Some("stored"));
}

#[test]
fn hydrate_connection_merges_stored_values_into_extra() {
    let cache = CredentialCache::default();
    credential_cache::set_plugin_secret_cached(
        &cache,
        "conn-1",
        "bigquery",
        "credential",
        "stored",
    );
    let mut connection = saved_connection("bigquery", &["credential"]);

    hydrate_connection(&cache, &mut connection);

    assert_eq!(
        connection
            .params
            .extra
            .get("credential")
            .map(String::as_str),
        Some("stored")
    );
}

fn missing_entry_reader(
    stored: &[(&str, &str)],
) -> impl FnMut(&str) -> Result<Option<String>, String> {
    let stored: HashMap<String, String> = stored
        .iter()
        .map(|(key, value)| (key.to_string(), value.to_string()))
        .collect();
    move |key: &str| match key {
        "locked" => Err("Keychain access denied".to_string()),
        _ => Ok(stored.get(key).cloned()),
    }
}

#[test]
fn resolve_leaves_missing_and_unreadable_keys_unset() {
    let keys = vec![
        "credential".to_string(),
        "token".to_string(),
        "locked".to_string(),
        "bad:key".to_string(),
    ];

    let resolved = resolve_secret_values(
        "conn-1",
        &keys,
        missing_entry_reader(&[("credential", "stored")]),
    );

    assert_eq!(resolved.values.len(), 1);
    assert_eq!(
        resolved.values.get("credential").map(String::as_str),
        Some("stored")
    );
    assert_eq!(resolved.unavailable, vec!["token", "locked", "bad:key"]);
}

#[test]
fn hydrate_keeps_connection_usable_when_a_keychain_entry_is_missing() {
    let cache = CredentialCache::default();
    credential_cache::set_plugin_secret_cached(
        &cache,
        "conn-1",
        "bigquery",
        "credential",
        "stored",
    );
    // A cached miss stands in for a keychain without the entry.
    cache.plugin_secrets.lock().unwrap().insert(
        credential_cache::plugin_secret_cache_key("conn-1", "bigquery", "token"),
        credential_cache::CacheEntry::Absent,
    );
    let mut connection = saved_connection("bigquery", &["credential", "token"]);
    connection
        .params
        .extra
        .insert("location".to_string(), "EU".to_string());

    hydrate_connection(&cache, &mut connection);

    assert_eq!(
        connection
            .params
            .extra
            .get("credential")
            .map(String::as_str),
        Some("stored")
    );
    assert_eq!(
        connection.params.extra.get("location").map(String::as_str),
        Some("EU")
    );
    assert!(!connection.params.extra.contains_key("token"));
    assert_eq!(connection.plugin_secret_keys, vec!["credential", "token"]);
}

#[test]
fn request_secrets_tolerate_a_missing_stored_entry() {
    let cache = CredentialCache::default();
    cache.plugin_secrets.lock().unwrap().insert(
        credential_cache::plugin_secret_cache_key("conn-1", "bigquery", "credential"),
        credential_cache::CacheEntry::Absent,
    );
    let saved = saved_connection("bigquery", &["credential"]);
    let mut params = ConnectionParams {
        driver: "bigquery".to_string(),
        ..Default::default()
    };

    apply_request_secrets(&cache, Some(&saved), &mut params, &HashMap::new()).unwrap();

    assert!(params.extra.is_empty());
}

#[test]
fn duplicate_copies_only_the_secrets_that_can_be_read() {
    let keys = vec![
        "credential".to_string(),
        "token".to_string(),
        "locked".to_string(),
    ];

    let changes = duplicate_secret_changes(
        "conn-1",
        &keys,
        missing_entry_reader(&[("credential", "stored")]),
    );

    assert_eq!(
        changes,
        HashMap::from([("credential".to_string(), Some("stored".to_string()))])
    );
    assert_eq!(
        next_secret_keys(&[], true, &changes).unwrap(),
        vec!["credential"]
    );
}

#[test]
fn import_skips_invalid_keys_and_keeps_the_rest() {
    let mut connection = saved_connection("bigquery", &[]);
    connection.params.extra = HashMap::from([
        ("credential".to_string(), "inline".to_string()),
        ("bad:key".to_string(), "inline".to_string()),
        ("location".to_string(), "EU".to_string()),
    ]);
    let imported = HashMap::from([
        ("credential".to_string(), "secret".to_string()),
        ("bad:key".to_string(), "secret".to_string()),
        ("".to_string(), "secret".to_string()),
        ("huge".to_string(), "x".repeat(MAX_SECRET_VALUE_LENGTH + 1)),
    ]);

    let writes = plan_imported_secrets(
        &mut connection,
        &["credential".to_string(), "bad:key".to_string()],
        imported,
        None,
    );

    assert_eq!(connection.plugin_secret_keys, vec!["credential"]);
    assert_eq!(
        writes,
        vec![SecretWrite::Set {
            connection_id: "conn-1".to_string(),
            driver: "bigquery".to_string(),
            key: "credential".to_string(),
            value: "secret".to_string(),
        }]
    );
    // No secret value, valid or not, is left in the persisted params.
    assert_eq!(
        connection.params.extra,
        HashMap::from([("location".to_string(), "EU".to_string())])
    );
}

#[test]
fn import_keeps_stored_keys_of_the_same_driver_and_drops_another_drivers() {
    let mut same = saved_connection("bigquery", &[]);
    let old_keys = vec!["token".to_string()];
    let writes = plan_imported_secrets(
        &mut same,
        &[],
        HashMap::new(),
        Some(("bigquery", &old_keys)),
    );
    assert!(writes.is_empty());
    assert_eq!(same.plugin_secret_keys, vec!["token"]);

    let mut switched = saved_connection("bigquery", &[]);
    let writes = plan_imported_secrets(
        &mut switched,
        &[],
        HashMap::new(),
        Some(("snowflake", &old_keys)),
    );
    assert!(switched.plugin_secret_keys.is_empty());
    assert_eq!(
        writes,
        vec![SecretWrite::Delete {
            connection_id: "conn-1".to_string(),
            driver: "snowflake".to_string(),
            key: "token".to_string(),
        }]
    );
}

#[derive(Default)]
struct MemoryStore {
    entries: RefCell<HashMap<(String, String, String), String>>,
    failing_key: Option<String>,
}

impl SecretStore for MemoryStore {
    fn set(&self, connection_id: &str, driver: &str, key: &str, value: &str) -> Result<(), String> {
        if self.failing_key.as_deref() == Some(key) {
            return Err("Keychain locked".to_string());
        }
        self.entries.borrow_mut().insert(
            (connection_id.into(), driver.into(), key.into()),
            value.into(),
        );
        Ok(())
    }

    fn delete(&self, connection_id: &str, driver: &str, key: &str) -> Result<(), String> {
        self.entries
            .borrow_mut()
            .remove(&(connection_id.into(), driver.into(), key.into()));
        Ok(())
    }
}

fn set_write(key: &str, value: &str) -> SecretWrite {
    SecretWrite::Set {
        connection_id: "conn-1".to_string(),
        driver: "bigquery".to_string(),
        key: key.to_string(),
        value: value.to_string(),
    }
}

#[test]
fn failed_save_leaves_no_orphaned_secrets() {
    let store = MemoryStore::default();
    store.entries.borrow_mut().insert(
        ("conn-1".into(), "snowflake".into(), "token".into()),
        "old".into(),
    );
    let cache = CredentialCache::default();
    let writes = vec![
        SecretWrite::Delete {
            connection_id: "conn-1".to_string(),
            driver: "snowflake".to_string(),
            key: "token".to_string(),
        },
        set_write("credential", "secret"),
    ];

    let result = commit_secret_writes(&store, &cache, writes, || Err("disk full".to_string()));

    assert_eq!(result, Err("disk full".to_string()));
    assert_eq!(
        *store.entries.borrow(),
        HashMap::from([(
            (
                "conn-1".to_string(),
                "snowflake".to_string(),
                "token".to_string()
            ),
            "old".to_string()
        )])
    );
    assert!(cache.plugin_secrets.lock().unwrap().is_empty());
}

#[test]
fn successful_save_applies_writes_and_tolerates_a_failing_one() {
    let store = MemoryStore {
        failing_key: Some("locked".to_string()),
        ..Default::default()
    };
    let cache = CredentialCache::default();
    let saved = RefCell::new(false);

    commit_secret_writes(
        &store,
        &cache,
        vec![set_write("locked", "x"), set_write("credential", "secret")],
        || {
            *saved.borrow_mut() = true;
            Ok(())
        },
    )
    .unwrap();

    assert!(*saved.borrow());
    assert_eq!(
        store
            .entries
            .borrow()
            .get(&("conn-1".into(), "bigquery".into(), "credential".into()))
            .map(String::as_str),
        Some("secret")
    );
    assert_eq!(store.entries.borrow().len(), 1);
    assert_eq!(
        credential_cache::get_plugin_secret_cached(&cache, "conn-1", "bigquery", "credential"),
        Ok(Some("secret".to_string()))
    );
}

#[test]
fn secret_write_debug_never_prints_the_value() {
    let rendered = format!("{:?}", set_write("credential", "super-secret"));
    assert!(rendered.contains("credential"));
    assert!(!rendered.contains("super-secret"));
}
