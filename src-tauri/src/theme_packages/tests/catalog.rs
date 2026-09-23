use super::super::*;
use super::archive::valid_package;
use serde_json::{json, Value};
use std::fs;
use std::path::Path;

fn legacy() -> Value {
    serde_json::from_str(include_str!(
        "../../../../tests/fixtures/themes/legacy-native.json"
    ))
    .unwrap()
}
fn store(root: &Path, filename: &str, value: &Value) {
    fs::create_dir_all(root.join("themes")).unwrap();
    fs::write(
        root.join("themes").join(filename),
        serde_json::to_vec(value).unwrap(),
    )
    .unwrap();
}
fn install(root: &Path) -> String {
    let key = "a".repeat(64);
    let package = validate_theme_archive(
        &valid_package(),
        "fixture-theme",
        "1.0.0",
        "0.99.0",
        &|| Ok(()),
    )
    .unwrap();
    install_validated_theme(&root.join("plugins"), &key, &package, &|| Ok(())).unwrap();
    key
}

#[test]
fn empty_profile_reads_do_not_create_directories_and_keep_all_builtins() {
    let temp = tempfile::tempdir().unwrap();
    let absent = temp.path().join("absent");
    let catalog = read_theme_catalog(&absent, &absent, "0.99.0");
    assert_eq!(catalog.themes.len(), 12);
    assert!(catalog.issues.is_empty(), "{:?}", catalog.issues);
    assert!(catalog
        .themes
        .iter()
        .all(|entry| entry.read_only && entry.origin["kind"] == "builtin"));
    assert!(!absent.exists());
}

#[test]
fn native_and_frontend_legacy_shapes_and_nulls_are_read_without_rewriting() {
    let temp = tempfile::tempdir().unwrap();
    for (index, source) in [
        include_str!("../../../../tests/fixtures/themes/legacy-native.json"),
        include_str!("../../../../tests/fixtures/themes/legacy-native-nullable.json"),
        include_str!("../../../../tests/fixtures/themes/legacy-frontend.json"),
    ]
    .into_iter()
    .enumerate()
    {
        let mut value: Value = serde_json::from_str(source).unwrap();
        value["id"] = json!(format!("custom-{index}"));
        value["isPreset"] = json!(true);
        value["isReadOnly"] = json!(true);
        store(temp.path(), &format!("{index}.json"), &value);
    }
    let before: Vec<_> = (0..3)
        .map(|i| fs::read(temp.path().join(format!("themes/{i}.json"))).unwrap())
        .collect();
    let catalog = read_theme_catalog(temp.path(), temp.path(), "0.99.0");
    assert_eq!(catalog.themes.len(), 15, "{:?}", catalog.issues);
    for entry in catalog
        .themes
        .iter()
        .filter(|entry| entry.origin["kind"] == "personal")
    {
        assert!(!entry.read_only);
    }
    for (index, bytes) in before.iter().enumerate() {
        assert_eq!(
            &fs::read(temp.path().join(format!("themes/{index}.json"))).unwrap(),
            bytes
        );
    }
}

#[test]
fn corrupt_and_colliding_personal_files_do_not_hide_builtins_or_get_renamed() {
    let temp = tempfile::tempdir().unwrap();
    let value = legacy();
    store(temp.path(), "a.json", &value);
    store(temp.path(), "b.json", &value);
    fs::write(temp.path().join("themes/corrupt.json"), b"{").unwrap();
    let catalog = read_theme_catalog(temp.path(), temp.path(), "0.99.0");
    assert_eq!(catalog.themes.len(), 12);
    assert!(!catalog.issues.is_empty());
    assert_eq!(fs::read_dir(temp.path().join("themes")).unwrap().count(), 3);
}

#[test]
fn immutable_ids_and_traversal_are_rejected_without_touching_outside_files() {
    let temp = tempfile::tempdir().unwrap();
    let outside = temp.path().join("sentinel.json");
    fs::write(&outside, b"unchanged").unwrap();
    let root = temp.path().join("profile");
    for id in [
        "tabularis-dark",
        "../sentinel",
        "a/b",
        "C:\\evil",
        "CON",
        "theme:fake:pkg:dark",
    ] {
        let mut value = legacy();
        value["id"] = json!(id);
        value["isPreset"] = json!(false);
        assert!(save_legacy_theme(&root, value).is_err(), "{id}");
        assert!(remove_personal_theme(&root, id).is_err(), "{id}");
    }
    assert_eq!(fs::read(outside).unwrap(), b"unchanged");
}

#[test]
fn editing_known_fields_preserves_opaque_legacy_metadata_and_integer_lexemes() {
    let temp = tempfile::tempdir().unwrap();
    let mut value = legacy();
    value["id"] = json!("custom-metadata");
    value["opaque"] = json!({"number":"replace-me", "nested":[null, true]});
    value["colors"]["bg"]["vendor"] = json!({"number":"replace-me"});
    let source = value
        .to_string()
        .replace("\"replace-me\"", "123456789012345678901234567890");
    fs::create_dir_all(temp.path().join("themes")).unwrap();
    fs::write(temp.path().join("themes/custom-metadata.json"), &source).unwrap();
    let before = export_personal_theme(temp.path(), "custom-metadata").unwrap();
    assert_eq!(before, source);
    value["name"] = json!("Edited name");
    value["colors"]["bg"]["base"] = json!("#112233");
    save_legacy_theme(temp.path(), value).unwrap();
    let output = export_personal_theme(temp.path(), "custom-metadata").unwrap();
    assert_eq!(output.matches("123456789012345678901234567890").count(), 2);
    let parsed: Value = serde_json::from_str(&output).unwrap();
    assert_eq!(parsed["name"], "Edited name");
    assert_eq!(parsed["colors"]["bg"]["base"], "#112233");
}

#[test]
fn import_issues_distinct_native_ids_and_preserves_source_metadata() {
    let temp = tempfile::tempdir().unwrap();
    let mut value = legacy();
    value["isPreset"] = json!(true);
    value["extra"] = json!({"license":"fixture"});
    let a = import_legacy_theme(temp.path(), &value.to_string()).unwrap();
    let b = import_legacy_theme(temp.path(), &value.to_string()).unwrap();
    assert_ne!(a["id"], b["id"]);
    assert_eq!(a["extra"], value["extra"]);
    assert_eq!(a["isPreset"], false);
    assert_eq!(a["isReadOnly"], false);
    assert_eq!(read_theme_catalog(temp.path(), temp.path(), "0.99.0").themes.len(), 14);
}

#[test]
fn definitions_are_additive_and_stale_updates_do_not_replace_them() {
    let temp = tempfile::tempdir().unwrap();
    let created = create_personal_definition(
        temp.path(),
        "Personal",
        r##"{"schemaVersion":1,"mode":"dark"}"##,
    )
    .unwrap();
    assert!(!temp.path().join("themes").exists());
    assert!(!temp.path().join("config.json").exists());
    let changed = update_personal_definition(
        temp.path(),
        &created.id,
        "Changed",
        r##"{"schemaVersion":1,"mode":"light"}"##,
        &created.revision,
    )
    .unwrap();
    assert_ne!(changed.revision, created.revision);
    assert!(update_personal_definition(
        temp.path(),
        &created.id,
        "Stale",
        &created.source,
        &created.revision
    )
    .is_err());
    assert_eq!(
        read_theme_catalog(temp.path(), temp.path(), "0.99.0")
            .themes
            .into_iter()
            .find(|t| t.id == created.id)
            .unwrap()
            .name,
        "Changed"
    );
    remove_personal_theme(temp.path(), &created.id).unwrap();
    assert_eq!(read_theme_catalog(temp.path(), temp.path(), "0.99.0").themes.len(), 12);
}

#[test]
fn installed_catalog_uses_host_identity_and_never_activates_or_recovers() {
    let temp = tempfile::tempdir().unwrap();
    let key = install(temp.path());
    let namespace = temp.path().join("plugins/themes");
    fs::create_dir(namespace.join(".staging-00000000-0000-0000-0000-000000000000")).unwrap();
    let catalog = read_theme_catalog(temp.path(), temp.path(), "0.99.0");
    assert_eq!(catalog.themes.len(), 13, "{:?}", catalog.issues);
    let theme = catalog
        .themes
        .iter()
        .find(|t| t.origin["kind"] == "installed")
        .unwrap();
    assert_eq!(theme.id, format!("theme:{key}:fixture-theme:dark"));
    assert!(theme.read_only);
    assert_eq!(theme.origin["identity"]["registryKey"], key);
    assert!(namespace
        .join(".staging-00000000-0000-0000-0000-000000000000")
        .exists());
    assert!(!temp.path().join("config.json").exists());
    assert_eq!(read_theme_catalog(temp.path(), temp.path(), "0.24.0").themes.len(), 12);
}

#[test]
fn package_tampering_isolated_and_disabled_variants_keep_identity() {
    let temp = tempfile::tempdir().unwrap();
    install(temp.path());
    let namespace = temp.path().join("plugins/themes");
    fs::write(namespace.join(".disabled-fixture-theme"), "1").unwrap();
    let catalog = read_theme_catalog(temp.path(), temp.path(), "0.99.0");
    assert_eq!(catalog.themes.len(), 13);
    assert!(!catalog.themes.last().unwrap().available);
    fs::write(namespace.join("fixture-theme/extra.js"), "do not execute").unwrap();
    let catalog = read_theme_catalog(temp.path(), temp.path(), "0.99.0");
    assert_eq!(catalog.themes.len(), 12);
    assert!(!catalog.issues.is_empty());
}

#[test]
fn duplication_is_independent_and_issued_by_native_context() {
    let temp = tempfile::tempdir().unwrap();
    let key = install(temp.path());
    let id = format!("theme:{key}:fixture-theme:dark");
    let copy = duplicate_personal_theme(temp.path(), temp.path(), "0.99.0", &id, "My copy", None).unwrap();
    assert_ne!(copy.id, id);
    assert_eq!(copy.origin["kind"], "personal");
    assert!(!copy.read_only);
    fs::remove_dir_all(temp.path().join("plugins")).unwrap();
    assert!(read_theme_catalog(temp.path(), temp.path(), "0.99.0")
        .themes
        .iter()
        .any(|t| t.id == copy.id));
    let editor = json!({"base":"vs-dark","inherit":true,"rules":[],"colors":{"editor.background":"#123456"}});
    let snapshot = duplicate_personal_theme(temp.path(), temp.path(), "0.99.0",
        "tabularis-dark",
        "Snapshot",
        Some(editor.clone()),
    )
    .unwrap();
    assert_eq!(snapshot.editor, Some(editor));
}

#[test]
#[cfg(unix)]
fn symlinked_files_and_roots_never_read_or_modify_external_data() {
    use std::os::unix::fs::symlink;
    let temp = tempfile::tempdir().unwrap();
    let outside = temp.path().join("outside");
    store(&outside, "secret.json", &legacy());
    let root = temp.path().join("profile");
    fs::create_dir(&root).unwrap();
    symlink(outside.join("themes"), root.join("themes")).unwrap();
    let catalog = read_theme_catalog(&root, &root, "0.99.0");
    assert_eq!(catalog.themes.len(), 12);
    assert!(!catalog.issues.is_empty());
    assert!(save_legacy_theme(&root, legacy()).is_err());
    assert!(outside.join("themes/secret.json").exists());
}
