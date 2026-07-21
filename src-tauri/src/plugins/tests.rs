use std::fs;

use tempfile::tempdir;

use super::installer::{has_manifest, read_plugin_info_from_dir};
use super::manager::ConfigManifest;

#[test]
fn reads_canonical_tabularium_manifest() {
    // The canonical bundle ships `.tabularium` (JSON content). It drops `id`
    // (name is the slug) and keeps the required `version`; identity falls back
    // to `name`.
    let dir = tempdir().expect("temp dir");
    fs::write(
        dir.path().join(".tabularium"),
        r#"{
  "name": "firestore",
  "kind": "driver",
  "version": "0.3.8",
  "description": "Firestore driver"
}"#,
    )
    .expect("write .tabularium");

    let plugin = read_plugin_info_from_dir(dir.path()).expect("read manifest");

    assert_eq!(plugin.id, "firestore");
    assert_eq!(plugin.name, "firestore");
    assert_eq!(plugin.version, "0.3.8");
    assert_eq!(plugin.description, "Firestore driver");
}

#[test]
fn falls_back_to_legacy_manifest_json() {
    // COMPAT(registry-ga): a bundle that ships only the legacy manifest.json
    // now loads successfully via the compat fallback until the publisher
    // migrates to .tabularium.
    let dir = tempdir().expect("temp dir");
    fs::write(
        dir.path().join("manifest.json"),
        r#"{ "name": "google-sheets", "version": "0.2.0", "description": "Query Sheets" }"#,
    )
    .expect("write manifest");

    let plugin = read_plugin_info_from_dir(dir.path()).expect("legacy fallback must succeed");
    assert_eq!(plugin.name, "google-sheets");
    assert_eq!(plugin.version, "0.2.0");
}

#[test]
fn errors_when_no_manifest_present() {
    let dir = tempdir().expect("temp dir");
    let error = read_plugin_info_from_dir(dir.path()).expect_err("no manifest");
    assert!(error.contains("No .tabularium manifest"));
}

// Regression: install and list gate on has_manifest before read_manifest gets a
// say. When it only knew `.tabularium`, a legacy bundle (e.g. redis) was
// rejected as manifest-less even though read_manifest would have loaded it.
#[test]
fn has_manifest_accepts_both_canonical_and_legacy_bundles() {
    let canonical = tempdir().expect("temp dir");
    fs::write(canonical.path().join(".tabularium"), "{}").expect("write manifest");
    assert!(has_manifest(canonical.path()));

    let legacy = tempdir().expect("temp dir");
    fs::write(legacy.path().join("manifest.json"), "{}").expect("write manifest");
    assert!(
        has_manifest(legacy.path()),
        "legacy manifest.json bundles must not look manifest-less"
    );

    let empty = tempdir().expect("temp dir");
    assert!(!has_manifest(empty.path()));
}

#[test]
fn preserves_ui_extension_driver_filter_from_manifest() {
    let manifest: ConfigManifest = serde_json::from_str(
        r#"{
  "id": "wordpress",
  "name": "WordPress",
  "version": "1.0.0",
  "description": "WordPress driver",
  "ui_extensions": [
    {
      "slot": "connection-modal.connection_content",
      "module": "ui/dist/index.js",
      "driver": "wordpress"
    },
    {
      "slot": "data-grid.toolbar.actions",
      "module": "ui/dist/index.js",
      "order": 10
    }
  ]
}"#,
    )
    .expect("parse manifest");

    let entries = manifest.ui_extensions.expect("ui_extensions present");
    assert_eq!(entries[0].driver.as_deref(), Some("wordpress"));
    assert_eq!(entries[1].driver, None);
    assert_eq!(entries[1].order, Some(10));
}

#[test]
fn returns_error_for_invalid_manifest() {
    let dir = tempdir().expect("temp dir");
    fs::write(dir.path().join(".tabularium"), "{ invalid json").expect("write manifest");

    let error = read_plugin_info_from_dir(dir.path()).expect_err("invalid manifest");

    assert!(error.contains("Failed to parse plugin manifest"));
}
