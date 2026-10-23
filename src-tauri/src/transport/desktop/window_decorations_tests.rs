use super::*;
use std::collections::HashMap;

fn variables(values: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
    let values = values
        .iter()
        .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
        .collect::<HashMap<_, _>>();

    move |name| values.get(name).cloned()
}

#[cfg(target_os = "linux")]
#[test]
fn automatic_mode_hides_decorations_for_hyprland() {
    assert!(!native_decorations_enabled_for_mode(
        Some(&WindowDecorationsMode::Automatic),
        variables(&[("HYPRLAND_INSTANCE_SIGNATURE", "instance")]),
    ));
}

#[cfg(target_os = "linux")]
#[test]
fn automatic_mode_recognizes_colon_separated_desktops() {
    assert!(!native_decorations_enabled_for_mode(
        Some(&WindowDecorationsMode::Automatic),
        variables(&[("XDG_CURRENT_DESKTOP", "Wayland:Hyprland")]),
    ));
}

#[cfg(target_os = "linux")]
#[test]
fn automatic_mode_keeps_decorations_for_non_tiling_desktops() {
    assert!(native_decorations_enabled_for_mode(
        Some(&WindowDecorationsMode::Automatic),
        variables(&[("XDG_CURRENT_DESKTOP", "GNOME")]),
    ));
}

#[test]
fn explicit_modes_override_environment_detection() {
    let tiling_environment = || variables(&[("SWAYSOCK", "/run/user/1000/sway.sock")]);

    assert!(native_decorations_enabled_for_mode(
        Some(&WindowDecorationsMode::AlwaysShow),
        tiling_environment(),
    ));
    assert!(!native_decorations_enabled_for_mode(
        Some(&WindowDecorationsMode::AlwaysHide),
        variables(&[("XDG_CURRENT_DESKTOP", "GNOME")]),
    ));
}

#[cfg(target_os = "linux")]
#[test]
fn missing_mode_defaults_to_automatic() {
    assert!(!native_decorations_enabled_for_mode(
        None,
        variables(&[("XDG_SESSION_DESKTOP", "sway")]),
    ));
}

#[test]
fn decoration_modes_use_camel_case_config_values() {
    assert_eq!(
        serde_json::to_string(&WindowDecorationsMode::AlwaysShow).unwrap(),
        "\"alwaysShow\""
    );
    assert_eq!(
        serde_json::to_string(&WindowDecorationsMode::AlwaysHide).unwrap(),
        "\"alwaysHide\""
    );
}
