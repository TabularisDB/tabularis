use super::super::{lifecycle::*, *};
use super::archive::valid_package;
use std::{fs, path::Path};

fn manual(root: &Path, relative: &str) {
    let package = validate_local_archive(&valid_package(), "0.99.0", &|| Ok(())).unwrap();
    let folder = root.join(relative);
    for (name, bytes) in package.files {
        let path = folder.join(name);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }
}

fn installed(root: &Path) -> Vec<ThemeContribution> {
    read_theme_catalog(root, root, "0.99.0")
        .themes
        .into_iter()
        .filter(|entry| entry.origin["kind"] == "installed")
        .collect()
}

#[test]
fn manual_themes_in_either_location_need_no_lock_or_registry_metadata() {
    for relative in ["plugins/fixture-theme", "plugins/themes/fixture-theme"] {
        let root = tempfile::tempdir().unwrap();
        manual(root.path(), relative);
        let themes = installed(root.path());
        assert_eq!(themes.len(), 1);
        assert_eq!(
            themes[0].origin["identity"]["registryKey"],
            local_registry_key()
        );
        assert!(!root.path().join("plugins/.lock").exists());
        assert!(!root.path().join("plugins/themes/.lock").exists());
        let key = local_registry_key();
        set_package_enabled(root.path(), &key, "fixture-theme", false).unwrap();
        assert!(!installed(root.path())[0].available);
        set_package_enabled(root.path(), &key, "fixture-theme", true).unwrap();
        assert!(installed(root.path())[0].available);
        remove_package(root.path(), &key, "fixture-theme").unwrap();
        assert!(installed(root.path()).is_empty());
    }
}

#[test]
fn canonical_themes_shadow_flat_copies_and_uninstall_does_not_resurrect_them() {
    let root = tempfile::tempdir().unwrap();
    manual(root.path(), "plugins/fixture-theme");
    manual(root.path(), "plugins/themes/fixture-theme");
    fs::write(
        root.path().join("plugins/fixture-theme/themes/dark.json"),
        r#"{"schemaVersion":1,"mode":"light"}"#,
    )
    .unwrap();
    let themes = installed(root.path());
    assert_eq!(themes.len(), 1);
    assert_eq!(themes[0].mode, "dark");
    remove_package(root.path(), &local_registry_key(), "fixture-theme").unwrap();
    assert!(installed(root.path()).is_empty());
}

#[test]
fn updates_always_install_in_kind_directory_and_preserve_disabled_flat_state() {
    let root = tempfile::tempdir().unwrap();
    manual(root.path(), "plugins/fixture-theme");
    let key = local_registry_key();
    set_package_enabled(root.path(), &key, "fixture-theme", false).unwrap();
    let package = validate_local_archive(&valid_package(), "0.99.0", &|| Ok(())).unwrap();
    let result =
        install_validated_theme(&root.path().join("plugins"), &key, &package, &|| Ok(())).unwrap();
    assert!(result.warnings.is_empty(), "{:?}", result.warnings);
    assert!(root
        .path()
        .join("plugins/themes/fixture-theme/.tabularium")
        .exists());
    assert!(!root.path().join("plugins/fixture-theme").exists());
    assert!(!root.path().join("plugins").join(&key).exists());
    assert!(!installed(root.path())[0].available);
}

#[test]
fn failed_update_leaves_flat_installation_untouched() {
    let root = tempfile::tempdir().unwrap();
    manual(root.path(), "plugins/fixture-theme");
    let before = fs::read(root.path().join("plugins/fixture-theme/.tabularium")).unwrap();
    let package = validate_local_archive(&valid_package(), "0.99.0", &|| Ok(())).unwrap();
    assert!(install_validated_theme(
        &root.path().join("plugins"),
        &local_registry_key(),
        &package,
        &|| Err("cancelled".into())
    )
    .is_err());
    assert_eq!(
        fs::read(root.path().join("plugins/fixture-theme/.tabularium")).unwrap(),
        before
    );
    assert_eq!(installed(root.path()).len(), 1);
}

#[test]
fn root_driver_with_same_name_is_never_removed_by_theme_installation() {
    let root = tempfile::tempdir().unwrap();
    let driver = root.path().join("plugins/fixture-theme");
    fs::create_dir_all(&driver).unwrap();
    fs::write(
        driver.join(".tabularium"),
        r#"{"kind":"driver","name":"fixture-theme"}"#,
    )
    .unwrap();
    let package = validate_local_archive(&valid_package(), "0.99.0", &|| Ok(())).unwrap();
    install_validated_theme(
        &root.path().join("plugins"),
        &local_registry_key(),
        &package,
        &|| Ok(()),
    )
    .unwrap();
    assert_eq!(installed(root.path()).len(), 1);
    remove_package(root.path(), &local_registry_key(), "fixture-theme").unwrap();
    assert!(driver.join(".tabularium").exists());
}

#[test]
fn reinstall_after_removing_a_disabled_flat_theme_keeps_it_disabled() {
    let root = tempfile::tempdir().unwrap();
    manual(root.path(), "plugins/fixture-theme");
    let key = local_registry_key();
    set_package_enabled(root.path(), &key, "fixture-theme", false).unwrap();
    remove_package(root.path(), &key, "fixture-theme").unwrap();
    let package = validate_local_archive(&valid_package(), "0.99.0", &|| Ok(())).unwrap();
    install_validated_theme(&root.path().join("plugins"), &key, &package, &|| Ok(())).unwrap();
    assert!(!installed(root.path())[0].available);
}

#[test]
fn reserved_kind_names_never_retire_the_container_directory() {
    for name in ["themes", "drivers"] {
        let root = tempfile::tempdir().unwrap();
        let mut manifest = super::archive::manifest();
        manifest["name"] = name.into();
        let source = serde_json::to_vec(&manifest).unwrap();
        let container = root.path().join("plugins").join(name);
        fs::create_dir_all(&container).unwrap();
        fs::write(container.join(".tabularium"), &source).unwrap();
        fs::write(container.join("sentinel"), "keep").unwrap();
        let bytes = super::archive::package(
            vec![
                (".tabularium".into(), source),
                ("themes/dark.json".into(), super::archive::definition()),
            ],
            false,
        );
        let package = validate_local_archive(&bytes, "0.99.0", &|| Ok(())).unwrap();
        let key = local_registry_key();
        install_validated_theme(&root.path().join("plugins"), &key, &package, &|| Ok(())).unwrap();
        assert!(root
            .path()
            .join("plugins/themes")
            .join(name)
            .join(".tabularium")
            .exists());
        remove_package(root.path(), &key, name).unwrap();
        assert_eq!(
            fs::read_to_string(container.join("sentinel")).unwrap(),
            "keep"
        );
    }
}

#[test]
fn canonical_lock_covers_flat_mutations_and_catalog_fallback() {
    use fs2::FileExt;
    let root = tempfile::tempdir().unwrap();
    manual(root.path(), "plugins/fixture-theme");
    let storage = root.path().join("plugins/themes");
    fs::create_dir_all(&storage).unwrap();
    let lock = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(storage.join(".lock"))
        .unwrap();
    FileExt::lock_exclusive(&lock).unwrap();
    assert!(
        set_package_enabled(root.path(), &local_registry_key(), "fixture-theme", false).is_err()
    );
    assert!(remove_package(root.path(), &local_registry_key(), "fixture-theme").is_err());
    let catalog = read_theme_catalog(root.path(), root.path(), "0.99.0");
    assert!(!catalog.issues.is_empty());
    assert!(installed(root.path()).is_empty());
    assert!(root
        .path()
        .join("plugins/fixture-theme/.tabularium")
        .exists());
    FileExt::unlock(&lock).unwrap();
    assert_eq!(installed(root.path()).len(), 1);
}

#[cfg(unix)]
#[test]
fn symlinked_canonical_theme_does_not_expose_a_flat_copy_or_modify_its_target() {
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    manual(root.path(), "plugins/fixture-theme");
    fs::create_dir_all(root.path().join("plugins/themes")).unwrap();
    std::os::unix::fs::symlink(
        outside.path(),
        root.path().join("plugins/themes/fixture-theme"),
    )
    .unwrap();
    assert!(installed(root.path()).is_empty());
    assert!(remove_package(root.path(), &local_registry_key(), "fixture-theme").is_err());
    assert!(root
        .path()
        .join("plugins/fixture-theme/.tabularium")
        .exists());
}
