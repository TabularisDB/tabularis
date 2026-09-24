use super::{
    canonicalize_roots, list_directory, resolve_save_target, validate_directory_target,
    validate_existing_file, validate_save_target,
};
use std::fs;
use tempfile::tempdir;

#[test]
fn lists_only_paths_inside_configured_roots() {
    let root = tempdir().unwrap();
    fs::create_dir(root.path().join("databases")).unwrap();
    fs::write(root.path().join("main.sqlite"), b"").unwrap();
    let roots = canonicalize_roots(&[root.path().to_path_buf()]).unwrap();

    let listing = list_directory(&roots, root.path().to_str()).unwrap();

    assert_eq!(listing.entries.len(), 2);
    assert_eq!(listing.entries[0].name, "databases");
    assert_eq!(listing.entries[1].name, "main.sqlite");
}

#[test]
fn rejects_paths_outside_configured_roots() {
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let roots = canonicalize_roots(&[root.path().to_path_buf()]).unwrap();

    let error = list_directory(&roots, outside.path().to_str()).unwrap_err();

    assert!(error.contains("outside the configured browser roots"));
}

#[test]
fn resolves_new_files_inside_configured_roots() {
    let root = tempdir().unwrap();
    let roots = canonicalize_roots(&[root.path().to_path_buf()]).unwrap();

    let target =
        resolve_save_target(&roots, root.path().to_str().unwrap(), "customers.db").unwrap();

    assert_eq!(target, roots[0].join("customers.db").to_str().unwrap());
    assert_eq!(validate_save_target(&roots, &target).unwrap(), target);
}

#[test]
fn rejects_save_file_names_with_path_traversal() {
    let root = tempdir().unwrap();
    let roots = canonicalize_roots(&[root.path().to_path_buf()]).unwrap();

    let error =
        resolve_save_target(&roots, root.path().to_str().unwrap(), "../outside.db").unwrap_err();

    assert!(error.contains("without directory separators"));
}

#[test]
fn rejects_missing_roots_during_startup_validation() {
    let root = tempdir().unwrap();
    let missing = root.path().join("missing");

    let error = canonicalize_roots(&[missing]).unwrap_err();

    assert!(error.contains("Failed to resolve server file browser root"));
}

#[test]
fn validates_existing_files_inside_configured_roots() {
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    fs::write(root.path().join("query.sql"), b"select 1").unwrap();
    fs::write(outside.path().join("secret.sql"), b"").unwrap();
    fs::create_dir(root.path().join("folder")).unwrap();
    let roots = canonicalize_roots(&[root.path().to_path_buf()]).unwrap();

    let file = root.path().join("query.sql");
    assert_eq!(
        validate_existing_file(&roots, file.to_str().unwrap()).unwrap(),
        roots[0].join("query.sql")
    );
    let escaped = root.path().join("folder/../../").join(
        outside.path().file_name().unwrap(),
    );
    assert!(validate_existing_file(&roots, escaped.join("secret.sql").to_str().unwrap()).is_err());
    assert!(validate_existing_file(&roots, root.path().join("folder").to_str().unwrap()).is_err());
    assert!(validate_existing_file(&[], file.to_str().unwrap()).is_err());
}

#[test]
fn validates_new_directories_inside_configured_roots() {
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let roots = canonicalize_roots(&[root.path().to_path_buf()]).unwrap();

    let nested = root.path().join("sync/tabularis");
    assert_eq!(
        validate_directory_target(&roots, nested.to_str().unwrap()).unwrap(),
        roots[0].join("sync/tabularis")
    );
    assert!(validate_directory_target(&roots, outside.path().join("new").to_str().unwrap()).is_err());
    assert!(validate_directory_target(&roots, "relative/dir").is_err());
    assert!(validate_directory_target(
        &roots,
        root.path().join("missing/../../escape").to_str().unwrap()
    )
    .is_err());
}
