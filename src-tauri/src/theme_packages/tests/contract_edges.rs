use super::super::*;
use serde_json::{json, Value};

#[test]
fn public_snapshot_editor_vectors_match_native_validation() {
    let vectors: Vec<Value> = serde_json::from_str(include_str!(
        "../../../../tests/fixtures/themes/snapshot-editor-vectors.json"
    ))
    .unwrap();
    for vector in vectors {
        assert_eq!(
            snapshot::validate_editor_snapshot(&vector["editor"]).is_ok(),
            vector["valid"].as_bool().unwrap(),
            "{}",
            vector["name"]
        );
    }
}

#[test]
fn opaque_legacy_version_markers_do_not_dispatch_to_new_formats() {
    let mut source = legacy::builtin_themes().remove(0);
    source["schemaVersion"] = json!({"authorTool":"historical"});
    source["themeSnapshotVersion"] = json!("opaque metadata");
    let text = serde_json::to_string(&source).unwrap();
    let preview = commands::preview_theme_document(text.clone(), "Preview".into()).unwrap();
    assert_eq!(preview.format, "legacy");
    assert_eq!(preview.source, text);
    let modern = json!({"schemaVersion":1,"mode":"dark","colors":{"accent":{"primary":"#123456"}}});
    assert_eq!(
        commands::preview_theme_document(modern.to_string(), "Modern".into())
            .unwrap()
            .format,
        "v1"
    );
}

#[test]
fn explicit_legacy_import_name_preserves_opaque_numeric_source_and_old_default() {
    let root = tempfile::tempdir().unwrap();
    let original = serde_json::to_string(&legacy::builtin_themes().remove(0)).unwrap();
    let source = format!(
        "{{\"opaqueNumber\":123456789012345678901234567890,{}",
        &original[1..]
    );
    let named = import_legacy_theme_named(root.path(), &source, "Chosen copy name").unwrap();
    assert_eq!(named["name"], "Chosen copy name");
    let exported = export_personal_theme(root.path(), named["id"].as_str().unwrap()).unwrap();
    assert!(exported.contains("123456789012345678901234567890"));
    let old = import_legacy_theme(root.path(), &source).unwrap();
    assert_eq!(old["name"], legacy::builtin_themes()[0]["name"]);
}

#[test]
fn added_host_metadata_cannot_commit_an_unreadable_oversize_legacy_import() {
    let root = tempfile::tempdir().unwrap();
    let profile = root.path().join("profile");
    let mut document = legacy::builtin_themes().remove(0);
    document["id"] = json!("x");
    document["opaque"] = json!("");
    let initial = serde_json::to_string(&document).unwrap();
    document["opaque"] = json!("x".repeat(legacy::LEGACY_BYTES - initial.len()));
    let source = serde_json::to_string(&document).unwrap();
    assert_eq!(source.len(), legacy::LEGACY_BYTES);
    legacy::parse_legacy(&source).unwrap();
    assert!(import_legacy_theme(&profile, &source).is_err());
    assert!(!profile.exists());
}
