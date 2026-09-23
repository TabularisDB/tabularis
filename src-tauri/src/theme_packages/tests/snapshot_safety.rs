use super::super::*;
use serde_json::json;

#[test]
fn malformed_or_authority_claiming_snapshot_containers_do_not_write() {
    let source = super::super::legacy::builtin_themes()[0].to_string();
    let valid = json!({"themeSnapshotVersion":1,"source":source,"editor":{"base":"vs-dark","inherit":true}});
    for (field, value) in [
        ("themeSnapshotVersion", json!(2)),
        ("origin", json!("builtin")),
        ("readOnly", json!(false)),
        (
            "editor",
            json!({"base":"vs-dark","inherit":true,"themeName":"Dracula"}),
        ),
    ] {
        let mut invalid = valid.clone();
        invalid[field] = value;
        let root = tempfile::tempdir().unwrap();
        assert!(create_personal_snapshot(root.path(), "Import", &invalid.to_string()).is_err());
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
    }
}

#[test]
fn invalid_snapshot_token_colors_are_rejected_before_preview_or_storage() {
    let source = super::super::legacy::builtin_themes()[0].to_string();
    let document = json!({"themeSnapshotVersion":1,"source":source,"editor":{"base":"vs-dark","inherit":true,"rules":[{"token":"string.sql","foreground":"not-a-color"}]}}).to_string();
    let root = tempfile::tempdir().unwrap();
    assert!(commands::preview_theme_document(document.clone(), "Preview".into()).is_err());
    assert!(create_personal_snapshot(root.path(), "Import", &document).is_err());
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
}

#[test]
fn historical_metadata_named_like_a_future_discriminator_remains_legacy() {
    let mut legacy = super::super::legacy::builtin_themes()[0].clone();
    legacy["themeSnapshotVersion"] = json!("opaque historical metadata");
    let source = legacy.to_string();
    let preview = commands::preview_theme_document(source.clone(), "Legacy".into()).unwrap();
    assert_eq!(preview.source, source);
    assert!(preview.editor.is_none());
    let root = tempfile::tempdir().unwrap();
    let imported = import_legacy_theme(root.path(), &source).unwrap();
    assert!(
        export_personal_theme(root.path(), imported["id"].as_str().unwrap())
            .unwrap()
            .contains("opaque historical metadata")
    );
}
