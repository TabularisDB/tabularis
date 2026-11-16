use super::*;
use tempfile::TempDir;

const CONNECTION_ID: &str = "conn_1";

fn sample(title: &str) -> String {
    format!(
        r#"{{"version":2,"title":"{title}","createdAt":"2026-01-01T00:00:00Z","cells":[{{"type":"sql","content":"SELECT 1"}}]}}"#
    )
}

#[test]
fn write_then_load_round_trips() {
    let temporary = TempDir::new().unwrap();
    let root = temporary.path();

    write_in(root, CONNECTION_ID, "nb_a", &sample("Hello")).unwrap();
    let loaded = load_in(root, CONNECTION_ID, "nb_a").unwrap();
    assert_eq!(loaded.as_deref(), Some(sample("Hello").as_str()));
}

#[test]
fn write_creates_per_connection_directory() {
    let temporary = TempDir::new().unwrap();
    let root = temporary.path();

    write_in(root, CONNECTION_ID, "nb_a", &sample("Hello")).unwrap();
    assert!(root
        .join(CONNECTION_ID)
        .join("nb_a.tabularis-notebook")
        .exists());
}

#[test]
fn load_missing_returns_none() {
    let temporary = TempDir::new().unwrap();
    assert!(load_in(temporary.path(), CONNECTION_ID, "nope")
        .unwrap()
        .is_none());
}

#[test]
fn list_returns_metadata() {
    let temporary = TempDir::new().unwrap();
    let root = temporary.path();

    write_in(root, CONNECTION_ID, "nb_a", &sample("First")).unwrap();
    write_in(root, CONNECTION_ID, "nb_b", &sample("Second")).unwrap();

    let mut list = list_in(root, CONNECTION_ID).unwrap();
    list.sort_by(|left, right| left.id.cmp(&right.id));

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
    let temporary = TempDir::new().unwrap();
    assert!(list_in(temporary.path(), "ghost").unwrap().is_empty());
}

#[test]
fn list_ignores_unrelated_and_malformed_files() {
    let temporary = TempDir::new().unwrap();
    let root = temporary.path();
    let directory = root.join(CONNECTION_ID);
    fs::create_dir_all(&directory).unwrap();

    write_in(root, CONNECTION_ID, "nb_a", &sample("Valid")).unwrap();
    fs::write(directory.join("notes.txt"), "ignore me").unwrap();
    fs::write(directory.join("broken.tabularis-notebook"), "{not json").unwrap();

    let list = list_in(root, CONNECTION_ID).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, "nb_a");
}

#[test]
fn rename_updates_title_and_preserves_cells() {
    let temporary = TempDir::new().unwrap();
    let root = temporary.path();

    write_in(root, CONNECTION_ID, "nb_a", &sample("Old")).unwrap();
    rename_in(root, CONNECTION_ID, "nb_a", "New Name").unwrap();

    let loaded = load_in(root, CONNECTION_ID, "nb_a").unwrap().unwrap();
    let value: Value = serde_json::from_str(&loaded).unwrap();
    assert_eq!(value["title"], "New Name");
    assert_eq!(value["cells"][0]["content"], "SELECT 1");
    assert_eq!(value["version"], 2);
}

#[test]
fn rename_missing_notebook_errors() {
    let temporary = TempDir::new().unwrap();
    assert!(rename_in(temporary.path(), CONNECTION_ID, "nope", "x").is_err());
}

#[test]
fn delete_removes_file() {
    let temporary = TempDir::new().unwrap();
    let root = temporary.path();

    write_in(root, CONNECTION_ID, "nb_a", &sample("Bye")).unwrap();
    delete_in(root, CONNECTION_ID, "nb_a").unwrap();

    assert!(load_in(root, CONNECTION_ID, "nb_a").unwrap().is_none());
}

#[test]
fn delete_missing_is_ok() {
    let temporary = TempDir::new().unwrap();
    assert!(delete_in(temporary.path(), CONNECTION_ID, "nope").is_ok());
}

#[test]
fn legacy_flat_notebook_is_migrated_on_load() {
    let temporary = TempDir::new().unwrap();
    let root = temporary.path();
    fs::create_dir_all(root).unwrap();

    let legacy = root.join("nb_legacy.tabularis-notebook");
    fs::write(&legacy, sample("Legacy")).unwrap();

    let loaded = load_in(root, CONNECTION_ID, "nb_legacy").unwrap();
    assert_eq!(loaded.as_deref(), Some(sample("Legacy").as_str()));
    assert!(root
        .join(CONNECTION_ID)
        .join("nb_legacy.tabularis-notebook")
        .exists());
    assert!(!legacy.exists());

    let list = list_in(root, CONNECTION_ID).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, "nb_legacy");
}

#[test]
fn ids_with_path_traversal_are_rejected() {
    let temporary = TempDir::new().unwrap();
    let root = temporary.path();

    assert!(load_in(root, CONNECTION_ID, "../escape").is_err());
    assert!(load_in(root, "../escape", "nb_a").is_err());
    assert!(write_in(root, CONNECTION_ID, "a/b", "{}").is_err());
    assert!(rename_in(root, "..", "nb_a", "x").is_err());
}

#[test]
fn command_service_scopes_storage_to_config_directory() {
    let temporary = TempDir::new().unwrap();
    let content = sample("Shared service");
    execute(
        temporary.path(),
        NotebookCommand::Create {
            connection_id: CONNECTION_ID.to_string(),
            notebook_id: "nb_shared".to_string(),
            content: content.clone(),
        },
    )
    .unwrap();

    let loaded = execute(
        temporary.path(),
        NotebookCommand::Load {
            connection_id: CONNECTION_ID.to_string(),
            notebook_id: "nb_shared".to_string(),
        },
    )
    .unwrap();
    assert_eq!(loaded, Value::String(content));
    assert!(temporary
        .path()
        .join(NOTEBOOKS_DIR)
        .join(CONNECTION_ID)
        .join("nb_shared.tabularis-notebook")
        .exists());
}
