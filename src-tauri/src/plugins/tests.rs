use std::fs;

use tempfile::tempdir;

use super::installer::read_plugin_info_from_dir;
use super::manager::ConfigManifest;

#[test]
fn reads_installed_plugin_info_from_manifest() {
    let dir = tempdir().expect("temp dir");
    let manifest_path = dir.path().join("manifest.json");
    fs::write(
        &manifest_path,
        r#"{
  "id": "google-sheets",
  "name": "Google Sheets",
  "version": "0.2.0",
  "description": "Query Sheets"
}"#,
    )
    .expect("write manifest");

    let plugin = read_plugin_info_from_dir(dir.path()).expect("read manifest");

    assert_eq!(plugin.id, "google-sheets");
    assert_eq!(plugin.name, "Google Sheets");
    assert_eq!(plugin.version, "0.2.0");
    assert_eq!(plugin.description, "Query Sheets");
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
    let manifest_path = dir.path().join("manifest.json");
    fs::write(&manifest_path, "{ invalid json").expect("write manifest");

    let error = read_plugin_info_from_dir(dir.path()).expect_err("invalid manifest");

    assert!(error.contains("Failed to parse plugin manifest"));
}
