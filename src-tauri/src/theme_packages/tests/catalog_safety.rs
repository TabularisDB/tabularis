use super::super::{files, read_theme_catalog};
use std::fs;

#[test]
fn catalog_read_budget_counts_invalid_sources_without_writing_them() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("theme.json");
    fs::write(&path, b"not JSON").unwrap();
    let mut remaining = 12;
    assert_eq!(
        files::read_budgeted_file(&path, 32, &mut remaining).unwrap(),
        "not JSON"
    );
    assert_eq!(remaining, 4);
    assert!(files::read_budgeted_file(&path, 32, &mut remaining).is_err());
    assert_eq!(remaining, 0);
    assert_eq!(fs::read(&path).unwrap(), b"not JSON");
}

#[test]
fn duplicated_legacy_snapshots_remain_editable_and_exportable() {
    let root = tempfile::tempdir().unwrap();
    let editor = serde_json::json!({"base":"vs-dark","inherit":true,"colors":{"editor.background":"#123456"},"rules":[]});
    let duplicate = super::super::duplicate_personal_theme(root.path(), root.path(), "0.99.0",
        "monokai",
        "Copy",
        Some(editor.clone()),
    )
    .unwrap();
    let mut update: serde_json::Value = serde_json::from_str(&duplicate.source).unwrap();
    update["name"] = serde_json::json!("Edited copy");
    update["colors"]["bg"]["base"] = serde_json::json!("#abcdef");
    update["monacoTheme"] = editor.clone();
    super::super::save_legacy_theme(root.path(), update).unwrap();
    let exported = super::super::export_personal_theme(root.path(), &duplicate.id).unwrap();
    let snapshot: serde_json::Value = serde_json::from_str(&exported).unwrap();
    assert_eq!(snapshot["themeSnapshotVersion"], 1);
    let source: serde_json::Value =
        serde_json::from_str(snapshot["source"].as_str().unwrap()).unwrap();
    assert_eq!(source["colors"]["bg"]["base"], "#abcdef");
    let entry = read_theme_catalog(root.path(), root.path(), "0.99.0")
        .themes
        .into_iter()
        .find(|entry| entry.id == duplicate.id)
        .unwrap();
    assert_eq!(entry.name, "Edited copy");
    assert_eq!(entry.editor, Some(editor));
}

#[test]
fn standalone_preview_issues_host_identity_and_cannot_claim_ownership() {
    let source = super::super::legacy::builtin_themes()[0].to_string();
    let preview =
        super::super::commands::preview_theme_document(source.clone(), "Preview".into()).unwrap();
    assert_eq!(preview.id, "theme:preview-document");
    assert_eq!(preview.origin["kind"], "personal");
    assert!(!preview.read_only);
    assert_eq!(preview.source, source);
    let wire = serde_json::to_value(preview).unwrap();
    assert_eq!(wire["readOnly"], false);
    assert!(wire.get("read_only").is_none());
}

#[test]
fn standalone_preview_keeps_v1_validation_strict() {
    assert!(super::super::commands::preview_theme_document(
        r#"{"schemaVersion":1,"mode":"dark"}"#.into(),
        "Preview".into()
    )
    .is_ok());
    for source in [
        r#"{"schemaVersion":1,"mode":"dark","isReadOnly":false}"#,
        r#"{"schemaVersion":1,"mode":"dark",}"#,
        r#"{"schemaVersion":2,"mode":"dark"}"#,
    ] {
        assert!(
            super::super::commands::preview_theme_document(source.into(), "Preview".into())
                .is_err()
        );
    }
}

#[cfg(unix)]
#[test]
fn fifo_namespace_locks_are_rejected_without_opening_them() {
    let root = tempfile::tempdir().unwrap();
    let namespace = root.path().join("plugins/themes");
    fs::create_dir_all(&namespace).unwrap();
    assert!(std::process::Command::new("mkfifo")
        .arg(namespace.join(".lock"))
        .status()
        .unwrap()
        .success());
    assert!(files::package_read_lock(&namespace).is_err());
    let catalog = read_theme_catalog(root.path(), root.path(), "0.99.0");
    assert_eq!(catalog.themes.len(), 12);
    assert!(catalog
        .issues
        .iter()
        .any(|issue| issue.contains("Invalid theme storage lock")));
    assert!(std::process::Command::new("mkfifo")
        .arg(root.path().join(".theme-write.lock"))
        .status()
        .unwrap()
        .success());
    assert!(files::write_lock(root.path()).is_err());
}
