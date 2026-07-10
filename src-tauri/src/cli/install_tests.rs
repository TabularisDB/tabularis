use super::install::{find_link_in_dirs, install_symlink, remove_symlink};
use std::path::{Path, PathBuf};

fn fake_exe(dir: &Path) -> PathBuf {
    let exe = dir.join("tabularis-binary");
    std::fs::write(&exe, b"#!/bin/sh\n").unwrap();
    exe
}

#[test]
fn install_symlink_creates_link_to_exe() {
    let tmp = tempfile::tempdir().unwrap();
    let exe = fake_exe(tmp.path());
    let bin = tmp.path().join("bin");

    let link = install_symlink(&exe, &bin, false).unwrap();

    assert_eq!(link, bin.join("tabularis"));
    assert_eq!(std::fs::read_link(&link).unwrap(), exe);
}

#[test]
fn install_symlink_creates_missing_target_dir() {
    let tmp = tempfile::tempdir().unwrap();
    let exe = fake_exe(tmp.path());
    let bin = tmp.path().join("nested/deeper/bin");

    install_symlink(&exe, &bin, false).unwrap();

    assert!(bin.join("tabularis").exists());
}

#[test]
fn install_symlink_is_idempotent_when_link_already_points_to_exe() {
    let tmp = tempfile::tempdir().unwrap();
    let exe = fake_exe(tmp.path());
    let bin = tmp.path().join("bin");

    install_symlink(&exe, &bin, false).unwrap();
    let link = install_symlink(&exe, &bin, false).unwrap();

    assert_eq!(std::fs::read_link(&link).unwrap(), exe);
}

#[test]
fn install_symlink_refuses_foreign_entry_without_force() {
    let tmp = tempfile::tempdir().unwrap();
    let exe = fake_exe(tmp.path());
    let bin = tmp.path().join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    std::fs::write(bin.join("tabularis"), b"something else").unwrap();

    let err = install_symlink(&exe, &bin, false).unwrap_err();

    assert!(err.contains("--force"), "unexpected error: {}", err);
    // The foreign file must be untouched.
    assert_eq!(
        std::fs::read(bin.join("tabularis")).unwrap(),
        b"something else"
    );
}

#[test]
fn install_symlink_force_replaces_foreign_entry() {
    let tmp = tempfile::tempdir().unwrap();
    let exe = fake_exe(tmp.path());
    let bin = tmp.path().join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    std::fs::write(bin.join("tabularis"), b"something else").unwrap();

    let link = install_symlink(&exe, &bin, true).unwrap();

    assert_eq!(std::fs::read_link(&link).unwrap(), exe);
}

#[test]
fn install_symlink_force_replaces_stale_symlink() {
    let tmp = tempfile::tempdir().unwrap();
    let exe = fake_exe(tmp.path());
    let old_exe = fake_exe(&tmp.path().join("old").tap_create());
    let bin = tmp.path().join("bin");

    install_symlink(&old_exe, &bin, false).unwrap();
    let link = install_symlink(&exe, &bin, true).unwrap();

    assert_eq!(std::fs::read_link(&link).unwrap(), exe);
}

#[test]
fn find_link_in_dirs_finds_symlink_pointing_to_exe() {
    let tmp = tempfile::tempdir().unwrap();
    let exe = fake_exe(tmp.path());
    let bin = tmp.path().join("bin");
    install_symlink(&exe, &bin, false).unwrap();

    let found = find_link_in_dirs(&exe, &[tmp.path().join("empty"), bin.clone()]);

    assert_eq!(found, Some(bin.join("tabularis")));
}

#[test]
fn find_link_in_dirs_finds_exe_itself_when_named_tabularis() {
    let tmp = tempfile::tempdir().unwrap();
    let bin = tmp.path().join("bin").tap_create();
    let exe = bin.join("tabularis");
    std::fs::write(&exe, b"#!/bin/sh\n").unwrap();

    assert_eq!(find_link_in_dirs(&exe, &[bin.clone()]), Some(exe));
}

#[test]
fn find_link_in_dirs_ignores_foreign_entries() {
    let tmp = tempfile::tempdir().unwrap();
    let exe = fake_exe(tmp.path());
    let bin = tmp.path().join("bin").tap_create();
    std::fs::write(bin.join("tabularis"), b"something else").unwrap();

    assert_eq!(find_link_in_dirs(&exe, &[bin]), None);
}

#[test]
fn find_link_in_dirs_returns_none_for_missing_dirs() {
    let tmp = tempfile::tempdir().unwrap();
    let exe = fake_exe(tmp.path());

    assert_eq!(find_link_in_dirs(&exe, &[tmp.path().join("nope")]), None);
}

#[test]
fn remove_symlink_deletes_our_link() {
    let tmp = tempfile::tempdir().unwrap();
    let exe = fake_exe(tmp.path());
    let bin = tmp.path().join("bin");
    let link = install_symlink(&exe, &bin, false).unwrap();

    remove_symlink(&exe, &link).unwrap();

    assert!(std::fs::symlink_metadata(&link).is_err());
}

#[test]
fn remove_symlink_refuses_plain_file() {
    let tmp = tempfile::tempdir().unwrap();
    let exe = fake_exe(tmp.path());
    let bin = tmp.path().join("bin").tap_create();
    let entry = bin.join("tabularis");
    std::fs::write(&entry, b"the real binary").unwrap();

    let err = remove_symlink(&exe, &entry).unwrap_err();

    assert!(err.contains("not a symlink"), "unexpected error: {}", err);
    assert!(entry.exists());
}

#[test]
fn remove_symlink_refuses_link_to_another_target() {
    let tmp = tempfile::tempdir().unwrap();
    let exe = fake_exe(tmp.path());
    let other = fake_exe(&tmp.path().join("other").tap_create());
    let bin = tmp.path().join("bin");
    let link = install_symlink(&other, &bin, false).unwrap();

    let err = remove_symlink(&exe, &link).unwrap_err();

    assert!(
        err.contains("does not point to this binary"),
        "unexpected error: {}",
        err
    );
    assert!(std::fs::symlink_metadata(&link).is_ok());
}

/// Tiny helper so the stale-symlink test can create a sibling dir inline.
trait TapCreate {
    fn tap_create(self) -> PathBuf;
}

impl TapCreate for PathBuf {
    fn tap_create(self) -> PathBuf {
        std::fs::create_dir_all(&self).unwrap();
        self
    }
}
