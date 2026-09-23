use super::super::{lifecycle::*, *};
use super::archive::{definition, manifest, package};
use serde_json::json;

fn display_named_package() -> Vec<u8> {
    let mut value = manifest();
    value["id"] = json!("fixture-theme");
    value["name"] = json!("Fixture Theme for Tabularis");
    value["description"] = json!("Registry-owned metadata the host tolerates");
    value["tags"] = json!(["theme", "fixture"]);
    package(
        vec![
            (".tabularium".into(), serde_json::to_vec(&value).unwrap()),
            ("themes/dark.json".into(), definition()),
        ],
        false,
    )
}

#[test]
fn package_identity_prefers_id_and_keeps_legacy_slug_names() {
    assert_eq!(
        package_id(&json!({"id":"ember-theme","name":"Ember Theme"})).unwrap(),
        "ember-theme"
    );
    assert_eq!(
        package_id(&json!({"name":"ember-theme"})).unwrap(),
        "ember-theme"
    );
    for value in [
        json!({"name":"Ember Theme"}),
        json!({"id":"Ember","name":"x"}),
        json!({"id":"con","name":"x"}),
        json!({"id":"a".repeat(65),"name":"x"}),
        json!({"id":7,"name":"x"}),
        json!({"id":"","name":"x"}),
        json!({}),
    ] {
        assert!(package_id(&value).is_err(), "{value}");
    }
}

#[test]
fn unknown_manifest_metadata_is_tolerated_but_grants_no_files() {
    let mut value = manifest();
    value["description"] = json!("Catalog text");
    value["executable"] = json!("theme.sh");
    let bytes = package(
        vec![
            (".tabularium".into(), serde_json::to_vec(&value).unwrap()),
            ("themes/dark.json".into(), definition()),
        ],
        false,
    );
    assert!(validate_local_archive(&bytes, "0.99.0", &|| Ok(())).is_ok());
    let with_payload = package(
        vec![
            (".tabularium".into(), serde_json::to_vec(&value).unwrap()),
            ("themes/dark.json".into(), definition()),
            ("theme.sh".into(), b"#!/bin/sh".to_vec()),
        ],
        false,
    );
    assert!(validate_local_archive(&with_payload, "0.99.0", &|| Ok(())).is_err());
}

#[test]
fn display_named_packages_install_and_resolve_under_their_id() {
    let temp = tempfile::tempdir().unwrap();
    let key = local_registry_key();
    let bytes = display_named_package();
    let preview = local_preview(&bytes, "0.99.0").unwrap();
    assert_eq!(preview.variants.len(), 1);
    assert_eq!(
        preview.variants[0].id,
        format!("theme:{key}:fixture-theme:dark")
    );
    assert_eq!(
        preview.variants[0].origin["identity"]["packageName"],
        "fixture-theme"
    );
    assert_eq!(preview.manifest["name"], "Fixture Theme for Tabularis");
    // Registry installs compare the archive with the requested slug, never the display name.
    assert!(validate_theme_archive(&bytes, "fixture-theme", "1.0.0", "0.99.0", &|| Ok(())).is_ok());
    assert!(validate_theme_archive(
        &bytes,
        "Fixture Theme for Tabularis",
        "1.0.0",
        "0.99.0",
        &|| Ok(())
    )
    .is_err());
    let package = validate_local_archive(&bytes, "0.99.0", &|| Ok(())).unwrap();
    let storage = temp.path().join("plugins");
    install_validated_theme(&storage, &key, &package, &|| Ok(())).unwrap();
    assert!(storage.join("themes/fixture-theme/.tabularium").exists());
    let installed: Vec<ThemeContribution> = read_theme_catalog(temp.path(), temp.path(), "0.99.0")
        .themes
        .into_iter()
        .filter(|entry| entry.origin["kind"] == "installed")
        .collect();
    assert_eq!(installed.len(), 1);
    assert_eq!(installed[0].id, format!("theme:{key}:fixture-theme:dark"));
    set_package_enabled(temp.path(), &key, "fixture-theme", false).unwrap();
    assert!(
        !read_theme_catalog(temp.path(), temp.path(), "0.99.0")
            .themes
            .into_iter()
            .find(|entry| entry.origin["kind"] == "installed")
            .unwrap()
            .available
    );
    remove_package(temp.path(), &key, "fixture-theme").unwrap();
    assert!(!storage.join("themes/fixture-theme").exists());
}
