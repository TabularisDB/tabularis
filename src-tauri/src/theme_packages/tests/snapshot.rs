use super::super::*;
use serde_json::{json, Value};

#[test]
fn standalone_snapshot_roundtrip_keeps_editor_and_original_bytes() {
    let profile = tempfile::tempdir().unwrap();
    let editor = json!({"base":"vs-dark","inherit":true,"colors":{"editor.background":"#123456"},"rules":[{"token":"keyword.sql","foreground":"abcdef","fontStyle":"italic"}]});
    let entry = duplicate_personal_theme(profile.path(), profile.path(), "0.24.0",
        "dracula",
        "Independent",
        Some(editor.clone()),
    )
    .unwrap();
    let path = profile
        .path()
        .join("theme-personal-v1")
        .join(format!("{}.json", entry.id));
    let before = std::fs::read(&path).unwrap();
    let source = export_personal_theme(profile.path(), &entry.id).unwrap();
    let exported: Value = serde_json::from_str(&source).unwrap();
    assert_eq!(exported["themeSnapshotVersion"], 1);
    assert_eq!(exported["source"], entry.source);
    assert_eq!(exported["editor"], editor);
    assert!(serde_json::from_str::<crate::theme_models::Theme>(&source).is_err());
    assert_eq!(standalone_theme_source(&entry).unwrap(), source);
    assert_eq!(std::fs::read(&path).unwrap(), before);
    let imported = create_personal_snapshot(profile.path(), "Imported snapshot", &source).unwrap();
    let roundtrip: Value =
        serde_json::from_str(&export_personal_theme(profile.path(), &imported.id).unwrap())
            .unwrap();
    assert_eq!(roundtrip["editor"], exported["editor"]);
    assert_ne!(imported.id, entry.id);
    assert_eq!(imported.origin["kind"], "personal");
    assert!(!profile.path().join("config.json").exists());
}

#[test]
fn snapshot_rejects_aliases_invalid_bases_and_invalid_camelcase_styles_before_writes() {
    for editor in [
        json!({"base":"vs-dark","inherit":true,"themeName":"Dracula"}),
        json!({"base":"unsupported","inherit":true}),
        json!({"base":"vs-dark","inherit":true,"rules":[{"token":"x","fontStyle":{}}]}),
    ] {
        let profile = tempfile::tempdir().unwrap();
        assert!(duplicate_personal_theme(profile.path(), profile.path(), "0.24.0",
            "tabularis-dark",
            "Copy",
            Some(editor)
        )
        .is_err());
        assert_eq!(std::fs::read_dir(profile.path()).unwrap().count(), 0);
    }
}

#[test]
fn missing_snapshot_collections_do_not_leak_named_source_rules() {
    let profile = tempfile::tempdir().unwrap();
    let entry = duplicate_personal_theme(profile.path(), profile.path(), "0.24.0",
        "dracula",
        "Empty editor",
        Some(json!({"base":"vs-dark","inherit":true})),
    )
    .unwrap();
    let exported: Value = serde_json::from_str(&standalone_theme_source(&entry).unwrap()).unwrap();
    assert!(exported["editor"].get("rules").is_none());
    assert!(exported["editor"].get("colors").is_none());
    let preview =
        super::super::commands::preview_theme_document(exported.to_string(), "Preview".into())
            .unwrap();
    assert_eq!(preview.editor, entry.editor);
}
