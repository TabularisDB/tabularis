use super::super::*;
use serde_json::json;

#[test]
fn independent_snapshot_edits_keep_exact_editor_raw_metadata_and_revision_checks() {
    let root = tempfile::tempdir().unwrap();
    let source = super::super::legacy::builtin_themes()[0]
        .to_string()
        .replacen('{', "{\"opaque\":123456789012345678901234567890,", 1);
    let editor = json!({"base":"vs-dark","inherit":true,"rules":[{"token":"string.sql","foreground":"ff0000","fontStyle":"italic"}],"colors":{}});
    let container = json!({"themeSnapshotVersion":1,"source":source,"editor":editor});
    let original =
        create_personal_snapshot(root.path(), "Original", &container.to_string()).unwrap();
    let mut changed = editor.clone();
    changed["rules"][0]["foreground"] = json!("0000ff");
    let updated = update_personal_snapshot(
        root.path(),
        &original.id,
        "Edited",
        &original.source,
        changed.clone(),
        &original.revision,
    )
    .unwrap();
    assert_eq!(updated.id, original.id);
    assert_ne!(updated.revision, original.revision);
    assert_eq!(updated.editor, Some(changed));
    assert!(updated.source.contains("123456789012345678901234567890"));
    let bytes = export_personal_theme(root.path(), &updated.id).unwrap();
    let error = update_personal_snapshot(
        root.path(),
        &original.id,
        "Stale",
        &original.source,
        editor,
        &original.revision,
    )
    .unwrap_err();
    assert!(error.contains("reload"));
    assert_eq!(
        export_personal_theme(root.path(), &updated.id).unwrap(),
        bytes
    );
}

#[test]
fn snapshot_editor_api_cannot_overwrite_a_v1_definition() {
    let root = tempfile::tempdir().unwrap();
    let definition = create_personal_definition(
        root.path(),
        "Definition",
        "{\"schemaVersion\":1,\"mode\":\"dark\"}",
    )
    .unwrap();
    let source = super::super::legacy::builtin_themes()[0].to_string();
    assert!(update_personal_snapshot(
        root.path(),
        &definition.id,
        "Wrong format",
        &source,
        json!({"base":"vs-dark","inherit":true}),
        &definition.revision
    )
    .is_err());
    assert_eq!(
        export_personal_theme(root.path(), &definition.id).unwrap(),
        definition.source
    );
}
