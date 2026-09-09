use std::collections::HashMap;
use std::ffi::OsString;

use crate::sandbox::{detect, Sandbox};

fn env_of(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<OsString> {
    let map: HashMap<String, OsString> = pairs
        .iter()
        .map(|(k, v)| (k.to_string(), OsString::from(v)))
        .collect();
    move |key| map.get(key).cloned()
}

#[test]
fn detects_snap_from_mount_point_variable() {
    let env = env_of(&[("SNAP", "/snap/tabularis/45")]);
    assert_eq!(detect(env), Some(Sandbox::Snap));
}

#[test]
fn detects_flatpak_from_app_id_variable() {
    let env = env_of(&[("FLATPAK_ID", "dev.tabularis.Tabularis")]);
    assert_eq!(detect(env), Some(Sandbox::Flatpak));
}

#[test]
fn snap_wins_when_both_markers_are_present() {
    let env = env_of(&[("SNAP", "/snap/tabularis/45"), ("FLATPAK_ID", "x")]);
    assert_eq!(detect(env), Some(Sandbox::Snap));
}

#[test]
fn empty_marker_does_not_count_as_sandboxed() {
    let env = env_of(&[("SNAP", ""), ("FLATPAK_ID", "")]);
    assert_eq!(detect(env), None);
}

#[test]
fn plain_environment_is_not_sandboxed() {
    let env = env_of(&[("HOME", "/home/user"), ("PATH", "/usr/bin")]);
    assert_eq!(detect(env), None);
}

#[test]
fn names_are_stable_for_logs_and_hints() {
    assert_eq!(Sandbox::Snap.name(), "snap");
    assert_eq!(Sandbox::Flatpak.name(), "flatpak");
}
