use super::super::{lifecycle::*, *};
use super::archive::valid_package;
use std::fs;

#[test]
fn local_preview_is_validated_and_never_installs_or_changes_preferences() {
    let bytes = valid_package();
    let preview = local_preview(&bytes, "0.99.0").unwrap();
    assert_eq!(preview.variants.len(), 1);
    assert_eq!(preview.variants[0].mode, "dark");
    assert!(preview.variants[0]
        .id
        .starts_with(&format!("theme:{}:", local_registry_key())));
    assert_eq!(preview.digest.len(), 64);
    assert!(local_preview(&bytes, "0.24.0").is_err());
    assert!(validate_local_archive(&bytes, "0.99.0", &|| Err("cancelled".into())).is_err());
}

#[test]
fn disable_uninstall_and_reinstall_keep_source_identity_and_configuration() {
    let temp = tempfile::tempdir().unwrap();
    let key = local_registry_key();
    let package = validate_local_archive(&valid_package(), "0.99.0", &|| Ok(())).unwrap();
    let storage = temp.path().join("plugins");
    fs::write(temp.path().join("config.json"), "untouched preferences").unwrap();
    install_validated_theme(&storage, &key, &package, &|| Ok(())).unwrap();
    let initial = read_theme_catalog(temp.path(), temp.path(), "0.99.0")
        .themes
        .pop()
        .unwrap();
    set_package_enabled(temp.path(), &key, "fixture-theme", false).unwrap();
    let disabled = read_theme_catalog(temp.path(), temp.path(), "0.99.0")
        .themes
        .pop()
        .unwrap();
    assert_eq!(initial.id, disabled.id);
    assert!(!disabled.available);
    remove_package(temp.path(), &key, "fixture-theme").unwrap();
    assert_eq!(read_theme_catalog(temp.path(), temp.path(), "0.99.0").themes.len(), 12);
    assert!(storage.join("themes/.lock").exists());
    install_validated_theme(&storage, &key, &package, &|| Ok(())).unwrap();
    let restored = read_theme_catalog(temp.path(), temp.path(), "0.99.0")
        .themes
        .pop()
        .unwrap();
    assert_eq!(initial.id, restored.id);
    assert!(!restored.available);
    set_package_enabled(temp.path(), &key, "fixture-theme", true).unwrap();
    assert!(
        read_theme_catalog(temp.path(), temp.path(), "0.99.0")
            .themes
            .pop()
            .unwrap()
            .available
    );
    assert_eq!(
        fs::read_to_string(temp.path().join("config.json")).unwrap(),
        "untouched preferences"
    );
}

#[test]
fn mutation_arguments_cannot_escape_package_storage() {
    let temp = tempfile::tempdir().unwrap();
    for (key, package) in [
        ("../outside".into(), "fixture-theme"),
        (local_registry_key(), "../outside"),
        (local_registry_key(), "CON"),
    ] {
        assert!(remove_package(temp.path(), &key, package).is_err());
        assert!(set_package_enabled(temp.path(), &key, package, false).is_err());
    }
    assert!(fs::read_dir(temp.path()).unwrap().next().is_none());
}
