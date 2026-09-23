use super::super::storage::install_with_rename;
use super::super::{install_validated_theme, recover_theme_transactions, validate_theme_archive};
use super::archive::{definition, manifest, package, valid_package};
use std::cell::Cell;
use std::fs;
use std::path::Path;
use uuid::Uuid;

#[test]
fn lock_contention_remains_cancellable_without_touching_the_installation() {
    use fs2::FileExt;
    let temporary = tempfile::tempdir().unwrap();
    let key = "a".repeat(64);
    install_validated_theme(temporary.path(), &key, &validated("1.0.0"), &|| Ok(())).unwrap();
    let folder = temporary.path().join("themes");
    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(folder.join(".lock"))
        .unwrap();
    FileExt::lock_exclusive(&file).unwrap();
    let checks = Cell::new(0);
    let result = install_validated_theme(temporary.path(), &key, &validated("2.0.0"), &|| {
        checks.set(checks.get() + 1);
        if checks.get() >= 3 {
            Err("PLUGIN_INSTALL_CANCELLED".into())
        } else {
            Ok(())
        }
    });
    assert!(matches!(result, Err(error) if error == "PLUGIN_INSTALL_CANCELLED"));
    assert_clean(&folder);
}

#[test]
fn cancellation_after_commit_begins_cannot_misreport_a_committed_update() {
    let temporary = tempfile::tempdir().unwrap();
    let key = "a".repeat(64);
    install_validated_theme(temporary.path(), &key, &validated("1.0.0"), &|| Ok(())).unwrap();
    let cancelled = Cell::new(false);
    let result = install_with_rename(
        temporary.path(),
        &key,
        &validated("2.0.0"),
        &|| {
            if cancelled.get() {
                Err("PLUGIN_INSTALL_CANCELLED".into())
            } else {
                Ok(())
            }
        },
        &|from, to| {
            cancelled.set(true);
            fs::rename(from, to)
        },
    );
    assert!(result.is_ok());
    let value: serde_json::Value = serde_json::from_slice(
        &fs::read(
            temporary
                .path()
                .join("themes")
                .join("fixture-theme/.tabularium"),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(value["version"], "2.0.0");
    assert_clean(&temporary.path().join("themes"));
}

fn validated(version: &str) -> super::super::ValidatedThemePackage {
    let mut value = manifest();
    value["version"] = version.into();
    let bytes = package(
        vec![
            (".tabularium".into(), serde_json::to_vec(&value).unwrap()),
            ("themes/dark.json".into(), definition()),
        ],
        false,
    );
    validate_theme_archive(&bytes, "fixture-theme", version, "0.99.0", &|| Ok(())).unwrap()
}

fn assert_clean(folder: &Path) {
    let mut names: Vec<_> = fs::read_dir(folder)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    assert_eq!(names, [".lock", "fixture-theme"]);
}

#[test]
fn install_and_update_are_namespaced_and_do_not_touch_preferences_or_personal_files() {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path().join("plugins");
    let key = "a".repeat(64);
    let other_key = "b".repeat(64);
    fs::write(temporary.path().join("config.json"), b"saved selections").unwrap();
    fs::create_dir(temporary.path().join("themes")).unwrap();
    fs::write(
        temporary.path().join("themes/personal.json"),
        b"original personal bytes",
    )
    .unwrap();
    assert!(
        install_validated_theme(&root, &key, &validated("1.0.0"), &|| Ok(()))
            .unwrap()
            .warnings
            .is_empty()
    );
    install_validated_theme(&root, &other_key, &validated("1.0.0"), &|| Ok(())).unwrap();
    install_validated_theme(&root, &key, &validated("2.0.0"), &|| Ok(())).unwrap();
    let manifest: serde_json::Value = serde_json::from_slice(
        &fs::read(root.join("themes/fixture-theme/.tabularium")).unwrap(),
    )
    .unwrap();
    assert_eq!(manifest["version"], "2.0.0");
    // Different registries replace the same kind/name, not parallel copies.
    assert!(!root.join(&key).exists());
    assert!(!root.join(&other_key).exists());
    assert_eq!(
        fs::read(temporary.path().join("config.json")).unwrap(),
        b"saved selections"
    );
    assert_eq!(
        fs::read(temporary.path().join("themes/personal.json")).unwrap(),
        b"original personal bytes"
    );
    assert_clean(&root.join("themes"));
}

#[test]
fn every_precommit_cancellation_point_preserves_the_previous_installation() {
    let temporary = tempfile::tempdir().unwrap();
    let key = "a".repeat(64);
    let root = temporary.path();
    install_validated_theme(root, &key, &validated("1.0.0"), &|| Ok(())).unwrap();
    let original = fs::read(root.join("themes/fixture-theme/.tabularium")).unwrap();
    for cancel_at in 1..=6 {
        let checks = Cell::new(0);
        let result = install_validated_theme(root, &key, &validated("2.0.0"), &|| {
            checks.set(checks.get() + 1);
            if checks.get() == cancel_at {
                Err("PLUGIN_INSTALL_CANCELLED".into())
            } else {
                Ok(())
            }
        });
        assert!(
            matches!(result, Err(error) if error == "PLUGIN_INSTALL_CANCELLED"),
            "checkpoint {}",
            cancel_at
        );
        assert_eq!(
            fs::read(root.join("themes/fixture-theme/.tabularium")).unwrap(),
            original
        );
        assert_clean(&root.join("themes"));
    }
}

#[test]
fn replacement_failure_restores_old_data_and_cleans_staging() {
    let temporary = tempfile::tempdir().unwrap();
    let key = "a".repeat(64);
    install_validated_theme(temporary.path(), &key, &validated("1.0.0"), &|| Ok(())).unwrap();
    let destination = temporary
        .path()
        .join("themes")
        .join("fixture-theme/.tabularium");
    let original = fs::read(&destination).unwrap();
    let result = install_with_rename(
        temporary.path(),
        &key,
        &validated("2.0.0"),
        &|| Ok(()),
        &|from, to| {
            if from
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with(".staging-")
            {
                Err(std::io::Error::other("injected replacement failure"))
            } else {
                fs::rename(from, to)
            }
        },
    );
    assert!(result.is_err());
    assert_eq!(fs::read(destination).unwrap(), original);
    assert_clean(&temporary.path().join("themes"));
}

#[test]
fn failed_rollback_retains_recoverable_originals_and_explicit_recovery_is_idempotent() {
    let temporary = tempfile::tempdir().unwrap();
    let key = "a".repeat(64);
    install_validated_theme(temporary.path(), &key, &validated("1.0.0"), &|| Ok(())).unwrap();
    let folder = temporary.path().join("themes");
    let original = fs::read(folder.join("fixture-theme/.tabularium")).unwrap();
    let result = install_with_rename(
        temporary.path(),
        &key,
        &validated("2.0.0"),
        &|| Ok(()),
        &|from, to| {
            let name = from.file_name().unwrap().to_string_lossy();
            if name.starts_with(".staging-") || name.starts_with(".backup-") {
                Err(std::io::Error::other("injected rename failure"))
            } else {
                fs::rename(from, to)
            }
        },
    );
    assert!(result.unwrap_err().contains("recovery retained"));
    assert!(!folder.join("fixture-theme").exists());
    recover_theme_transactions(temporary.path(), &key).unwrap();
    recover_theme_transactions(temporary.path(), &key).unwrap();
    assert_eq!(
        fs::read(folder.join("fixture-theme/.tabularium")).unwrap(),
        original
    );
    assert_clean(&folder);
}

#[test]
fn recovery_removes_precommit_staging_and_keeps_an_already_committed_destination() {
    let temporary = tempfile::tempdir().unwrap();
    let key = "a".repeat(64);
    install_validated_theme(temporary.path(), &key, &validated("1.0.0"), &|| Ok(())).unwrap();
    let folder = temporary.path().join("themes");
    let id = Uuid::new_v4();
    fs::create_dir(folder.join(format!(".backup-{}", id))).unwrap();
    fs::write(folder.join(format!(".backup-{}/old", id)), b"old data").unwrap();
    fs::create_dir(folder.join(format!(".staging-{}", id))).unwrap();
    fs::write(
        folder.join(format!(".transaction-{}.json", id)),
        br#"{"version":1,"package":"fixture-theme"}"#,
    )
    .unwrap();
    recover_theme_transactions(temporary.path(), &key).unwrap();
    assert!(folder.join("fixture-theme/.tabularium").exists());
    assert_clean(&folder);
    let orphan = folder.join(format!(".staging-{}", Uuid::new_v4()));
    fs::create_dir(&orphan).unwrap();
    recover_theme_transactions(temporary.path(), &key).unwrap();
    assert!(!orphan.exists());
}

#[test]
fn invalid_registry_identity_and_missing_recovery_do_not_create_directories() {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path().join("absent");
    let parsed = validate_theme_archive(
        &valid_package(),
        "fixture-theme",
        "1.0.0",
        "0.99.0",
        &|| Ok(()),
    )
    .unwrap();
    assert!(install_validated_theme(&root, "../escape", &parsed, &|| Ok(())).is_err());
    assert!(!root.exists());
    recover_theme_transactions(&root, &"a".repeat(64)).unwrap();
    assert!(!root.exists());
}

#[test]
fn untrusted_or_corrupt_recovery_records_cannot_escape_the_namespace() {
    let temporary = tempfile::tempdir().unwrap();
    let key = "a".repeat(64);
    install_validated_theme(temporary.path(), &key, &validated("1.0.0"), &|| Ok(())).unwrap();
    let folder = temporary.path().join("themes");
    let id = Uuid::new_v4();
    let marker = folder.join(format!(".transaction-{}.json", id));
    fs::write(&marker, br#"{"version":1,"package":"../../escape"}"#).unwrap();
    assert!(recover_theme_transactions(temporary.path(), &key).is_err());
    assert!(folder.join("fixture-theme/.tabularium").exists());
    assert!(marker.exists());
    fs::write(&marker, b"{partial").unwrap();
    assert!(recover_theme_transactions(temporary.path(), &key).is_err());
}

#[cfg(unix)]
#[test]
fn symlinked_storage_roots_namespaces_and_destinations_are_rejected() {
    use std::os::unix::fs::symlink;
    for target in ["root", "namespace", "destination"] {
        let temporary = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("sentinel"), b"unchanged").unwrap();
        let root = temporary.path().join("packages");
        let key = "a".repeat(64);
        let link = match target {
            "root" => root.clone(),
            "namespace" => {
                fs::create_dir(&root).unwrap();
                root.join("themes")
            }
            _ => {
                fs::create_dir_all(root.join("themes")).unwrap();
                root.join("themes").join("fixture-theme")
            }
        };
        symlink(outside.path(), link).unwrap();
        assert!(install_validated_theme(&root, &key, &validated("1.0.0"), &|| Ok(())).is_err());
        assert_eq!(
            fs::read(outside.path().join("sentinel")).unwrap(),
            b"unchanged"
        );
        assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 1);
    }
}
