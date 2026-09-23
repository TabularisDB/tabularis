use super::*;
use serde_json::json;

fn bundle(root: &Path, relative: &str, id: &str, kind: Option<&str>) -> PathBuf {
    let path = root.join(relative);
    fs::create_dir_all(&path).unwrap();
    let mut manifest = json!({"name": id, "version": "1.0.0", "description": "fixture"});
    if let Some(kind) = kind {
        manifest["kind"] = json!(kind);
    }
    fs::write(path.join(".tabularium"), manifest.to_string()).unwrap();
    path
}

#[test]
fn kind_scoped_drivers_win_and_flat_legacy_bundles_remain_visible() {
    let root = tempfile::tempdir().unwrap();
    bundle(root.path(), "renamed-copy", "sample", None);
    let preferred = bundle(root.path(), "drivers/sample", "sample", Some("driver"));
    let flat = bundle(root.path(), "legacy", "legacy-id", None);
    bundle(root.path(), "themes/ember", "ember", Some("theme"));
    bundle(root.path(), "flat-theme", "flat-theme", Some("theme"));
    bundle(root.path(), "drivers/not-a-driver", "bad", Some("theme"));
    bundle(root.path(), "unknown", "unknown", Some("other"));
    bundle(root.path(), ".tmp-hidden", "hidden", None);
    let paths = driver_directories(root.path()).unwrap();
    assert_eq!(paths, vec![preferred.clone(), flat.clone()]);
    assert_eq!(resolve_driver(root.path(), "sample").unwrap(), preferred);
    assert_eq!(resolve_driver(root.path(), "legacy-id").unwrap(), flat);
    assert!(resolve_driver(root.path(), "ember").is_err());
    assert_eq!(driver_candidates(root.path()).unwrap().len(), 3);
}

#[test]
fn installations_always_target_driver_kind_and_reject_path_arguments() {
    let root = tempfile::tempdir().unwrap();
    bundle(root.path(), "sample", "sample", None);
    assert_eq!(
        driver_destination(root.path(), "sample").unwrap(),
        root.path().join("drivers/sample")
    );
    for id in ["", "..", "../sample", "a/b", "a\\b", "/outside"] {
        assert!(driver_destination(root.path(), id).is_err());
        assert!(resolve_driver(root.path(), id).is_err());
    }
}

#[test]
fn kind_containers_are_never_returned_as_removable_flat_bundles() {
    let root = tempfile::tempdir().unwrap();
    bundle(root.path(), "drivers", "drivers", None);
    bundle(root.path(), "themes", "themes", None);
    let canonical = bundle(root.path(), "drivers/drivers", "drivers", Some("driver"));
    assert_eq!(driver_candidates(root.path()).unwrap(), vec![canonical]);
    assert!(resolve_driver(root.path(), "themes").is_err());
}

#[test]
fn kind_folder_aliases_preserve_unknown_kinds() {
    for (kind, folder) in [
        ("theme", "themes"),
        ("driver", "drivers"),
        ("extension", "extension"),
        ("custom-kind", "custom-kind"),
    ] {
        assert_eq!(kind_directory(kind), folder);
    }
    assert!(is_kind_directory("themes"));
    assert!(is_kind_directory("drivers"));
    assert!(!is_kind_directory("theme"));
    assert!(!is_kind_directory("driver"));
}

#[test]
fn read_only_discovery_does_not_create_missing_directories() {
    let root = tempfile::tempdir().unwrap();
    let missing = root.path().join("missing");
    assert!(driver_directories(&missing).unwrap().is_empty());
    assert!(!missing.exists());
}
