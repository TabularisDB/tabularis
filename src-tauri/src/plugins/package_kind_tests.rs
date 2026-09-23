use super::*;
use serde_json::json;
use std::io::{Cursor, Write};

#[test]
fn explicit_legacy_driver_rule_keeps_executable_and_ui_only_manifests() {
    for value in [
        json!({"name":"legacy","executable":"driver"}),
        json!({"name":"ui-only","ui_extensions":[]}),
        json!({"kind":"driver"}),
    ] {
        assert!(require_driver_kind(value.to_string().as_bytes()).is_ok());
    }
    for kind in [
        json!("theme"),
        json!("unknown"),
        json!(null),
        json!(false),
        json!(1),
    ] {
        assert_eq!(
            require_driver_kind(json!({"kind":kind}).to_string().as_bytes()).unwrap_err(),
            KIND_ERROR
        );
    }
    assert!(require_driver_kind(br#"{"kind":"theme","kind":"driver"}"#).is_err());
    assert!(require_driver_kind(b"[]").is_err());
}

#[test]
fn both_manifest_names_refuse_themes_before_extraction() {
    for name in [".tabularium", "manifest.json"] {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        writer
            .start_file(name, zip::write::SimpleFileOptions::default())
            .unwrap();
        writer
            .write_all(br#"{"name":"fixture","kind":"theme","executable":"do-not-run"}"#)
            .unwrap();
        let bytes = writer.finish().unwrap().into_inner();
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        assert_eq!(validate_archive_kind(&mut archive).unwrap_err(), KIND_ERROR);
    }
}

#[tokio::test]
async fn startup_refuses_a_theme_before_driver_or_ui_extension_registration() {
    let temp = tempfile::tempdir().unwrap();
    std::fs::write(temp.path().join(".tabularium"), br#"{"name":"theme-startup-fixture","kind":"theme","version":"1.0.0","executable":"must-not-start","ui_extensions":[{"slot":"sidebar","module":"must-not-load.js"}]}"#).unwrap();
    let error = crate::plugins::manager::load_plugin_from_dir(
        temp.path(),
        None,
        std::collections::HashMap::new(),
    )
    .await
    .unwrap_err();
    assert_eq!(error, KIND_ERROR);
}

#[test]
fn generic_manifest_read_cannot_discard_an_executable_theme_kind() {
    for name in [".tabularium", "manifest.json"] {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(
            temp.path().join(name),
            br#"{"name":"fixture","kind":"theme","version":"1.0.0","executable":"do-not-run"}"#,
        )
        .unwrap();
        assert_eq!(
            crate::plugins::installer::read_manifest::<serde_json::Value>(temp.path()).unwrap_err(),
            KIND_ERROR
        );
    }
}
