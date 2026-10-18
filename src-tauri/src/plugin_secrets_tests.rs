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

    let values = load_available_secret_values(
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

    hydrate_connection(&cache, &mut connection).unwrap();

    assert_eq!(
        connection
            .params
            .extra
            .get("credential")
            .map(String::as_str),
        Some("stored")
    );
}
