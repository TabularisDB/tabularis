use super::model::{SaveHistoryFile, SaveRecord};
use super::store::{append, delete, history_path, is_enabled, load, remove_for_connection, update};
use crate::drivers::recorded_save::CellImage;
use chrono::Utc;
use serde_json::json;
use std::collections::BTreeMap;

fn record(id: &str) -> SaveRecord {
    SaveRecord {
        id: id.to_string(),
        saved_at: Utc::now().to_rfc3339(),
        database: None,
        schema: Some("public".to_string()),
        table: "orders".to_string(),
        target: Some("target-a".to_string()),
        key: BTreeMap::from([("id".to_string(), json!(1))]),
        columns: vec![super::model::RecordedColumn {
            name: "status".to_string(),
            data_type: "text".to_string(),
            pre: CellImage::Text {
                value: "secret-before".to_string(),
            },
            post: CellImage::Null,
        }],
        restorable: true,
        non_restorable_reason: None,
        restored_at: None,
    }
}

#[test]
fn a_connection_without_a_file_is_disabled_and_empty() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(load(dir.path(), "c1").unwrap(), SaveHistoryFile::default());
    assert!(!is_enabled(dir.path(), "c1").unwrap());
}

#[test]
fn recording_is_opt_in_per_connection() {
    let dir = tempfile::tempdir().unwrap();
    update(dir.path(), "c1", |file| {
        file.enabled = true;
        Ok(())
    })
    .unwrap();
    assert!(is_enabled(dir.path(), "c1").unwrap());
    assert!(!is_enabled(dir.path(), "c2").unwrap());
}

#[test]
fn appends_and_deletes_records() {
    let dir = tempfile::tempdir().unwrap();
    append(dir.path(), "c1", record("a")).unwrap();
    append(dir.path(), "c1", record("b")).unwrap();
    assert_eq!(load(dir.path(), "c1").unwrap().records.len(), 2);
    assert_eq!(delete(dir.path(), "c1", Some("a")).unwrap(), 1);
    assert_eq!(load(dir.path(), "c1").unwrap().records[0].id, "b");
    assert_eq!(delete(dir.path(), "c1", None).unwrap(), 1);
    assert!(load(dir.path(), "c1").unwrap().records.is_empty());
}

#[test]
fn removes_the_history_with_its_connection() {
    let dir = tempfile::tempdir().unwrap();
    append(dir.path(), "c1", record("a")).unwrap();
    let path = history_path(dir.path(), "c1").unwrap();
    assert!(path.exists());
    remove_for_connection(dir.path(), "c1").unwrap();
    assert!(!path.exists());
    remove_for_connection(dir.path(), "c1").unwrap();
}

#[test]
fn rejects_connection_ids_that_escape_the_directory() {
    let dir = tempfile::tempdir().unwrap();
    for id in ["../evil", "a/b", "..", ""] {
        assert!(history_path(dir.path(), id).is_err(), "{id:?}");
    }
}

#[cfg(unix)]
#[test]
fn stores_values_in_an_owner_only_file() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    append(dir.path(), "c1", record("a")).unwrap();
    let mode = std::fs::metadata(history_path(dir.path(), "c1").unwrap())
        .unwrap()
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o600);
}

#[test]
fn leaves_an_unreadable_file_untouched() {
    let dir = tempfile::tempdir().unwrap();
    let path = history_path(dir.path(), "c1").unwrap();
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, "{not json").unwrap();
    assert!(load(dir.path(), "c1").is_err());
    assert!(append(dir.path(), "c1", record("a")).is_err());
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "{not json");
}

#[test]
fn prunes_while_writing() {
    let dir = tempfile::tempdir().unwrap();
    let mut old = record("old");
    old.saved_at = (Utc::now() - chrono::Duration::days(365)).to_rfc3339();
    append(dir.path(), "c1", old).unwrap();
    append(dir.path(), "c1", record("new")).unwrap();
    let ids: Vec<_> = load(dir.path(), "c1")
        .unwrap()
        .records
        .into_iter()
        .map(|r| r.id)
        .collect();
    assert_eq!(ids, vec!["new"]);
}
