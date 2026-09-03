use std::fs;

use tempfile::tempdir;

use super::install_cancellation::{begin, cancel, INSTALL_CANCELLED_ERROR};
use super::installer::{has_manifest, migrate_plugins_between, read_plugin_info_from_dir};
use super::manager::ConfigManifest;
use super::runtime_version::{
    check_min_runtime_version, evaluate_min_runtime_version, push_runtime_warning,
    take_runtime_warnings, RuntimeVersionVerdict,
};

#[test]
fn cancellation_marks_an_active_install() {
    let guard = begin("cancellation-test-plugin").expect("begin install");

    assert!(!guard.cancellation().is_cancelled());
    assert!(cancel("cancellation-test-plugin"));
    assert_eq!(
        guard.cancellation().check().expect_err("cancelled install"),
        INSTALL_CANCELLED_ERROR
    );

    drop(guard);
    assert!(!cancel("cancellation-test-plugin"));
}

#[test]
fn duplicate_install_is_rejected_until_guard_is_dropped() {
    let guard = begin("duplicate-install-test-plugin").expect("begin install");
    let error = begin("duplicate-install-test-plugin")
        .err()
        .expect("duplicate install must fail");
    assert!(error.contains("already running"));

    drop(guard);
    assert!(begin("duplicate-install-test-plugin").is_ok());
}

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
fn preserves_explain_parser_declarations_from_manifest() {
    let manifest: ConfigManifest = serde_json::from_str(
        r#"{
  "id": "explain-plugin",
  "name": "EXPLAIN Plugin",
  "version": "1.0.0",
  "description": "Plugin-owned parser",
  "explain_parsers": [
    {
      "engine": "example-db",
      "format": "example-db-plan-text",
      "label": "Example DB plan",
      "module": "explain/dist/index.iife.js"
    }
  ]
}"#,
    )
    .expect("parse manifest");

    let entries = manifest.explain_parsers.expect("explain_parsers present");
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].engine, "example-db");
    assert_eq!(entries[0].format, "example-db-plan-text");
    assert_eq!(entries[0].label.as_deref(), Some("Example DB plan"));
    assert_eq!(entries[0].module, "explain/dist/index.iife.js");
}

#[test]
fn returns_error_for_invalid_manifest() {
    let dir = tempdir().expect("temp dir");
    fs::write(dir.path().join(".tabularium"), "{ invalid json").expect("write manifest");

    let error = read_plugin_info_from_dir(dir.path()).expect_err("invalid manifest");

    assert!(error.contains("Failed to parse plugin manifest"));
}

#[test]
fn migrates_plugin_folders_into_empty_target() {
    let root = tempdir().expect("temp dir");
    let legacy = root.path().join("legacy/plugins");
    let target = root.path().join("new/plugins");
    fs::create_dir_all(legacy.join("my-plugin")).expect("legacy plugin dir");
    fs::write(legacy.join("my-plugin/manifest.json"), "{}").expect("manifest");

    let moved = migrate_plugins_between(&legacy, &target);

    assert_eq!(moved, 1);
    assert!(target.join("my-plugin/manifest.json").exists());
    assert!(!legacy.exists(), "empty legacy dir should be removed");
}

#[test]
fn skips_migration_when_target_already_populated() {
    let root = tempdir().expect("temp dir");
    let legacy = root.path().join("legacy/plugins");
    let target = root.path().join("new/plugins");
    fs::create_dir_all(legacy.join("old")).expect("legacy");
    fs::create_dir_all(target.join("already-there")).expect("target");

    let moved = migrate_plugins_between(&legacy, &target);

    assert_eq!(moved, 0);
    assert!(legacy.join("old").exists(), "legacy left untouched");
    assert!(!target.join("old").exists());
}

#[test]
fn migration_is_a_no_op_when_legacy_equals_target() {
    let root = tempdir().expect("temp dir");
    let same = root.path().join("plugins");
    fs::create_dir_all(same.join("p")).expect("dir");

    let moved = migrate_plugins_between(&same, &same);

    assert_eq!(moved, 0);
    assert!(same.join("p").exists());
}

#[test]
fn migration_is_a_no_op_when_legacy_missing() {
    let root = tempdir().expect("temp dir");
    let legacy = root.path().join("does-not-exist");
    let target = root.path().join("new");

    assert_eq!(migrate_plugins_between(&legacy, &target), 0);
    assert!(
        !target.exists(),
        "target not created when nothing to migrate"
    );
}

#[test]
fn preserves_min_runtime_version_from_manifest() {
    let manifest: ConfigManifest = serde_json::from_str(
        r#"{
  "name": "sqlserver",
  "version": "1.0.0-beta.1",
  "description": "SQL Server driver",
  "min_runtime_version": "0.23.0"
}"#,
    )
    .expect("parse manifest");

    assert_eq!(manifest.min_runtime_version.as_deref(), Some("0.23.0"));
}

#[test]
fn min_runtime_version_is_optional_in_manifest() {
    let manifest: ConfigManifest = serde_json::from_str(
        r#"{
  "name": "firestore",
  "version": "0.3.8",
  "description": "Firestore driver"
}"#,
    )
    .expect("parse manifest");

    assert_eq!(manifest.min_runtime_version, None);
}

#[test]
fn runtime_check_accepts_plugins_without_a_floor() {
    assert_eq!(check_min_runtime_version("p", None, "0.22.0"), Ok(()));
    assert_eq!(check_min_runtime_version("p", Some(""), "0.22.0"), Ok(()));
    assert_eq!(
        check_min_runtime_version("p", Some("   "), "0.22.0"),
        Ok(())
    );
}

#[test]
fn runtime_check_accepts_equal_or_newer_hosts() {
    assert_eq!(
        check_min_runtime_version("p", Some("0.23.0"), "0.23.0"),
        Ok(())
    );
    assert_eq!(
        check_min_runtime_version("p", Some("0.23.0"), "0.23.1"),
        Ok(())
    );
    assert_eq!(
        check_min_runtime_version("p", Some("0.23.0"), "1.0.0"),
        Ok(())
    );
    // A nightly built after the release carries the next patch as prerelease.
    assert_eq!(
        check_min_runtime_version("p", Some("0.23.0"), "0.23.1-3"),
        Ok(())
    );
    assert_eq!(
        check_min_runtime_version("p", Some("v0.23.0"), "v0.23.0"),
        Ok(())
    );
}

#[test]
fn runtime_check_refuses_older_hosts_with_both_versions_named() {
    let error = check_min_runtime_version("sqlserver", Some("0.23.0"), "0.22.0")
        .expect_err("older host must be refused");

    assert_eq!(
        error,
        "Plugin 'sqlserver' requires Tabularis 0.23.0 or newer, but this is Tabularis 0.22.0. Update Tabularis to use this plugin."
    );
}

#[test]
fn runtime_check_treats_prerelease_hosts_as_below_the_release() {
    assert!(check_min_runtime_version("p", Some("0.23.0"), "0.23.0-nightly.1").is_err());
    assert!(check_min_runtime_version("p", Some("0.23.0"), "0.22.1-4").is_err());
}

#[test]
fn runtime_check_ignores_non_semver_values() {
    assert_eq!(
        check_min_runtime_version("p", Some("latest"), "0.22.0"),
        Ok(())
    );
    assert_eq!(
        check_min_runtime_version("p", Some("0.23"), "0.22.0"),
        Ok(())
    );
    assert_eq!(
        check_min_runtime_version("p", Some("0.23.0"), "dev"),
        Ok(())
    );
}

#[test]
fn runtime_verdict_is_compatible_when_the_floor_is_met() {
    assert_eq!(
        evaluate_min_runtime_version("p", Some("0.23.0"), "0.23.0", false),
        RuntimeVersionVerdict::Compatible
    );
    assert_eq!(
        evaluate_min_runtime_version("p", None, "0.1.0", true),
        RuntimeVersionVerdict::Compatible
    );
}

#[test]
fn runtime_verdict_refuses_older_release_hosts() {
    assert_eq!(
        evaluate_min_runtime_version("sqlserver", Some("0.23.0"), "0.22.0", false),
        RuntimeVersionVerdict::Incompatible(
            "Plugin 'sqlserver' requires Tabularis 0.23.0 or newer, but this is Tabularis 0.22.0. Update Tabularis to use this plugin.".to_string()
        )
    );
}

#[test]
fn runtime_verdict_overrides_in_development_builds_and_says_so() {
    let verdict = evaluate_min_runtime_version("sqlserver", Some("0.23.0"), "0.22.0", true);

    let RuntimeVersionVerdict::DevOverride(message) = verdict else {
        panic!("development builds must override, got {verdict:?}");
    };
    assert!(message.starts_with("Plugin 'sqlserver' requires Tabularis 0.23.0 or newer"));
    assert!(message.ends_with("Loaded anyway because this is a development build."));
}

#[test]
fn runtime_warnings_are_returned_exactly_once() {
    push_runtime_warning("queue-test-plugin", "first");
    push_runtime_warning("queue-test-plugin", "second");

    let drained: Vec<String> = take_runtime_warnings()
        .into_iter()
        .filter(|w| w.plugin_id == "queue-test-plugin")
        .map(|w| w.message)
        .collect();
    assert_eq!(drained, vec!["first".to_string(), "second".to_string()]);

    let again = take_runtime_warnings();
    assert!(again.iter().all(|w| w.plugin_id != "queue-test-plugin"));
}
