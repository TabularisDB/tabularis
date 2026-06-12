use super::*;
use std::fs;
use tempfile::TempDir;

const CONN: &str = "conn_1";

fn sample(title: &str) -> String {
    format!(
        r#"{{"version":2,"title":"{}","createdAt":"2026-01-01T00:00:00Z","cells":[{{"type":"sql","content":"SELECT 1"}}]}}"#,
        title
    )
}

#[test]
fn write_then_load_round_trips() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();

    write_in(root, CONN, "nb_a", &sample("Hello")).unwrap();
    let loaded = load_in(root, CONN, "nb_a").unwrap();
    assert_eq!(loaded.as_deref(), Some(sample("Hello").as_str()));
}

#[test]
fn write_creates_per_connection_directory() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();

    write_in(root, CONN, "nb_a", &sample("Hello")).unwrap();
    assert!(root.join(CONN).join("nb_a.tabularis-notebook").exists());
}

#[test]
fn load_missing_returns_none() {
    let tmp = TempDir::new().unwrap();
    assert!(load_in(tmp.path(), CONN, "nope").unwrap().is_none());
}

#[test]
fn list_returns_metadata() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();

    write_in(root, CONN, "nb_a", &sample("First")).unwrap();
    write_in(root, CONN, "nb_b", &sample("Second")).unwrap();

    let mut list = list_in(root, CONN).unwrap();
    list.sort_by(|a, b| a.id.cmp(&b.id));

    assert_eq!(list.len(), 2);
    assert_eq!(list[0].id, "nb_a");
    assert_eq!(list[0].title, "First");
    assert_eq!(list[0].created_at.as_deref(), Some("2026-01-01T00:00:00Z"));
    assert!(list[0].updated_at.is_some());
    assert_eq!(list[1].id, "nb_b");
    assert_eq!(list[1].title, "Second");
}

#[test]
fn list_missing_connection_is_empty() {
    let tmp = TempDir::new().unwrap();
    assert!(list_in(tmp.path(), "ghost").unwrap().is_empty());
}

#[test]
fn list_ignores_unrelated_and_malformed_files() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    let dir = root.join(CONN);
    fs::create_dir_all(&dir).unwrap();

    write_in(root, CONN, "nb_a", &sample("Valid")).unwrap();
    fs::write(dir.join("notes.txt"), "ignore me").unwrap();
    fs::write(dir.join("broken.tabularis-notebook"), "{not json").unwrap();

    let list = list_in(root, CONN).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, "nb_a");
}

#[test]
fn rename_updates_title_and_preserves_cells() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();

    write_in(root, CONN, "nb_a", &sample("Old")).unwrap();
    rename_in(root, CONN, "nb_a", "New Name").unwrap();

    let loaded = load_in(root, CONN, "nb_a").unwrap().unwrap();
    let value: serde_json::Value = serde_json::from_str(&loaded).unwrap();
    assert_eq!(value["title"], "New Name");
    // Cells (and other fields) survive the rename.
    assert_eq!(value["cells"][0]["content"], "SELECT 1");
    assert_eq!(value["version"], 2);
}

#[test]
fn rename_missing_notebook_errors() {
    let tmp = TempDir::new().unwrap();
    assert!(rename_in(tmp.path(), CONN, "nope", "x").is_err());
}

#[test]
fn delete_removes_file() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();

    write_in(root, CONN, "nb_a", &sample("Bye")).unwrap();
    delete_in(root, CONN, "nb_a").unwrap();

    assert!(load_in(root, CONN, "nb_a").unwrap().is_none());
}

#[test]
fn delete_missing_is_ok() {
    let tmp = TempDir::new().unwrap();
    assert!(delete_in(tmp.path(), CONN, "nope").is_ok());
}

#[test]
fn legacy_flat_notebook_is_migrated_on_load() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    fs::create_dir_all(root).unwrap();

    // Simulate a pre-existing flat notebook from the old layout.
    let legacy = root.join("nb_legacy.tabularis-notebook");
    fs::write(&legacy, sample("Legacy")).unwrap();

    let loaded = load_in(root, CONN, "nb_legacy").unwrap();
    assert_eq!(loaded.as_deref(), Some(sample("Legacy").as_str()));

    // It moved into the per-connection folder and the flat file is gone.
    assert!(root.join(CONN).join("nb_legacy.tabularis-notebook").exists());
    assert!(!legacy.exists());

    // And it now shows up in the connection's list.
    let list = list_in(root, CONN).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, "nb_legacy");
}

#[test]
fn ids_with_path_traversal_are_rejected() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();

    assert!(load_in(root, CONN, "../escape").is_err());
    assert!(load_in(root, "../escape", "nb_a").is_err());
    assert!(write_in(root, CONN, "a/b", "{}").is_err());
    assert!(rename_in(root, "..", "nb_a", "x").is_err());
}
