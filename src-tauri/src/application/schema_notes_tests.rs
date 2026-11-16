use super::*;
use crate::schema_notes::SchemaNoteTarget;
use std::fs;

fn target(table: &str, column: Option<&str>) -> SchemaNoteTarget {
    SchemaNoteTarget {
        database: None,
        schema: Some("public".to_string()),
        table: table.to_string(),
        column: column.map(str::to_string),
    }
}

#[test]
fn missing_file_reads_as_empty_and_ai_off() {
    let directory = tempfile::tempdir().unwrap();
    let stored = load(directory.path(), "conn").unwrap();
    assert!(stored.notes.notes.is_empty());
    assert!(!stored.include_in_ai_context);
}

#[test]
fn saves_and_reloads_notes() {
    let directory = tempfile::tempdir().unwrap();
    set_note(directory.path(), "conn", None, None, "Shop".to_string()).unwrap();
    set_note(
        directory.path(),
        "conn",
        Some(target("orders", Some("status"))),
        None,
        "4 means payment captured".to_string(),
    )
    .unwrap();
    let stored = load(directory.path(), "conn").unwrap();
    assert_eq!(stored.notes.project_note, "Shop");
    assert_eq!(stored.notes.notes.len(), 1);
    assert!(load(directory.path(), "other")
        .unwrap()
        .notes
        .notes
        .is_empty());
    let leftovers: Vec<_> = fs::read_dir(directory.path().join("schema_notes"))
        .unwrap()
        .map(|entry| entry.unwrap().file_name().into_string().unwrap())
        .collect();
    assert_eq!(leftovers, ["conn.json"], "no temporary files left behind");
}

#[test]
fn malformed_file_is_reported_and_never_overwritten() {
    let directory = tempfile::tempdir().unwrap();
    let path = notes_path(directory.path(), "conn").unwrap();
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, "{ broken").unwrap();

    let error = load(directory.path(), "conn").unwrap_err();
    assert!(error.contains("left unchanged"), "{error}");
    assert!(set_note(
        directory.path(),
        "conn",
        Some(target("t", None)),
        None,
        "x".into()
    )
    .is_err());
    assert!(set_ai_context(directory.path(), "conn", true).is_err());
    let valid = crate::schema_notes::serialize_export(&Default::default()).unwrap();
    assert!(import(directory.path(), "conn", &valid).is_err());
    assert_eq!(fs::read_to_string(&path).unwrap(), "{ broken");
    assert!(prompt_section(directory.path(), "conn", &["t".into()], None, None).is_none());
}

#[test]
fn rejected_change_leaves_the_file_as_it_was() {
    let directory = tempfile::tempdir().unwrap();
    set_note(
        directory.path(),
        "conn",
        Some(target("t", None)),
        None,
        "keep".into(),
    )
    .unwrap();
    let path = notes_path(directory.path(), "conn").unwrap();
    let before = fs::read_to_string(&path).unwrap();
    assert!(set_note(
        directory.path(),
        "conn",
        Some(target("t", Some("c"))),
        Some("Billing".into()),
        "x".into()
    )
    .is_err());
    assert!(import(directory.path(), "conn", "{\"format\":\"x\",\"version\":1}").is_err());
    assert_eq!(fs::read_to_string(&path).unwrap(), before);
}

#[test]
fn rejects_connection_ids_that_are_not_plain_file_names() {
    let directory = tempfile::tempdir().unwrap();
    for id in ["", ".", "..", "../x", "a/b", "a\\b"] {
        assert!(load(directory.path(), id).is_err(), "{id}");
        assert!(
            set_note(directory.path(), id, None, None, "x".into()).is_err(),
            "{id}"
        );
    }
}

#[test]
fn import_merges_and_keeps_the_local_ai_choice() {
    let directory = tempfile::tempdir().unwrap();
    set_note(
        directory.path(),
        "conn",
        Some(target("dropped", None)),
        None,
        "kept".into(),
    )
    .unwrap();
    let mut shared = crate::schema_notes::SchemaNotes::default();
    crate::schema_notes::upsert_note(&mut shared, target("orders", None), None, "new".into())
        .unwrap();
    let mut text = crate::schema_notes::serialize_export(&shared).unwrap();
    // A hand-edited file asking to turn the AI on must not do it.
    text = text.replacen(
        "\"version\": 1,",
        "\"version\": 1,\n  \"includeInAiContext\": true,",
        1,
    );

    let stored = import(directory.path(), "conn", &text).unwrap();
    assert!(!stored.include_in_ai_context);
    let tables: Vec<&str> = stored
        .notes
        .notes
        .iter()
        .map(|note| note.target.table.as_str())
        .collect();
    assert_eq!(tables, ["dropped", "orders"]);
    let exported = export(directory.path(), "conn").unwrap();
    assert!(exported.contains("\"dropped\"") && exported.contains("\"orders\""));
    assert!(!exported.contains("includeInAiContext"));
}

#[test]
fn prompt_section_only_when_enabled() {
    let directory = tempfile::tempdir().unwrap();
    set_note(
        directory.path(),
        "conn",
        Some(target("orders", None)),
        None,
        "Orders".into(),
    )
    .unwrap();
    let tables = ["orders".to_string()];
    assert!(prompt_section(directory.path(), "conn", &tables, None, Some("public")).is_none());

    set_ai_context(directory.path(), "conn", true).unwrap();
    let section = prompt_section(directory.path(), "conn", &tables, None, Some("public")).unwrap();
    assert!(section.contains("\"Orders\""));

    set_ai_context(directory.path(), "conn", false).unwrap();
    assert!(prompt_section(directory.path(), "conn", &tables, None, Some("public")).is_none());
}

#[test]
fn overlapping_saves_keep_every_change() {
    let directory = tempfile::tempdir().unwrap();
    let config_dir = directory.path().to_path_buf();
    let handles: Vec<_> = (0..16)
        .map(|index| {
            let config_dir = config_dir.clone();
            std::thread::spawn(move || {
                set_note(
                    &config_dir,
                    "conn",
                    Some(target(&format!("t{index:02}"), None)),
                    None,
                    format!("note {index}"),
                )
                .unwrap();
            })
        })
        .collect();
    for handle in handles {
        handle.join().unwrap();
    }
    assert_eq!(load(&config_dir, "conn").unwrap().notes.notes.len(), 16);
}
