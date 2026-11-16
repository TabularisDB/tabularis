use crate::ui_state::{
    close, database_path, delete_entry, encode_value, get_entries, set_entry, validate_key,
    MAX_KEYS_PER_READ, MAX_KEY_LENGTH, MAX_VALUE_BYTES,
};
use serde_json::json;

#[test]
fn accepts_existing_frontend_keys() {
    for key in [
        "tabularis_sidebar_width",
        "tabularis_row_editor_sidebar_width",
        "tabularis_last_seen_version",
        "tabularis_support_prompt_dismissed",
        "tabularis:discord-callout-v2-dismissed",
        "tabularis.format.v1",
    ] {
        assert!(validate_key(key).is_ok(), "{key}");
    }
}

#[test]
fn rejects_malformed_keys() {
    for key in [
        String::new(),
        "Upper".to_string(),
        "with space".to_string(),
        "../escape".to_string(),
        "k".repeat(MAX_KEY_LENGTH + 1),
    ] {
        assert!(validate_key(&key).is_err(), "{key}");
    }
}

#[test]
fn caps_value_size() {
    assert!(encode_value(&json!("x".repeat(MAX_VALUE_BYTES - 2))).is_ok());
    assert!(encode_value(&json!("x".repeat(MAX_VALUE_BYTES))).is_err());
}

#[tokio::test]
async fn stores_reads_and_deletes_entries() {
    let temp = tempfile::tempdir().unwrap();
    let database = database_path(temp.path());

    assert!(get_entries(&database, None).await.unwrap().is_empty());
    set_entry(&database, "tabularis_sidebar_width", &json!(320))
        .await
        .unwrap();
    set_entry(
        &database,
        "tabularis_support_prompt_dismissed",
        &json!(true),
    )
    .await
    .unwrap();
    set_entry(&database, "tabularis_sidebar_width", &json!(280))
        .await
        .unwrap();

    let all = get_entries(&database, None).await.unwrap();
    assert_eq!(all.get("tabularis_sidebar_width"), Some(&json!(280)));
    assert_eq!(
        all.get("tabularis_support_prompt_dismissed"),
        Some(&json!(true))
    );

    let selected = get_entries(
        &database,
        Some(&["tabularis_sidebar_width".to_string(), "missing".to_string()]),
    )
    .await
    .unwrap();
    assert_eq!(selected.len(), 1);

    assert!(delete_entry(&database, "tabularis_sidebar_width")
        .await
        .unwrap());
    assert!(!delete_entry(&database, "tabularis_sidebar_width")
        .await
        .unwrap());
    assert_eq!(get_entries(&database, None).await.unwrap().len(), 1);
    close(&database).await;
}

#[tokio::test]
async fn persists_across_reopened_pools() {
    let temp = tempfile::tempdir().unwrap();
    let database = database_path(temp.path());
    set_entry(&database, "tabularis_last_seen_version", &json!("0.25.0"))
        .await
        .unwrap();
    close(&database).await;

    let entries = get_entries(&database, None).await.unwrap();
    assert_eq!(
        entries.get("tabularis_last_seen_version"),
        Some(&json!("0.25.0"))
    );
    close(&database).await;
}

#[tokio::test]
async fn rejects_invalid_requests_before_touching_the_database() {
    let temp = tempfile::tempdir().unwrap();
    let database = database_path(temp.path());
    assert!(set_entry(&database, "Bad Key", &json!(1)).await.is_err());
    let too_many: Vec<String> = (0..=MAX_KEYS_PER_READ).map(|i| format!("k{i}")).collect();
    assert!(get_entries(&database, Some(&too_many)).await.is_err());
    assert!(!database.exists());
}
