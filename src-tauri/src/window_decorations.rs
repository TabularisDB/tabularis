use crate::config::{get_cached_config, WindowDecorationsMode};
use tauri::{AppHandle, Manager, Runtime};

#[cfg(target_os = "linux")]
const TILING_SESSION_VARIABLES: &[&str] = &[
    "HYPRLAND_INSTANCE_SIGNATURE",
    "SWAYSOCK",
    "I3SOCK",
    "NIRI_SOCKET",
    "RIVER_SOCKET",
    "BSPWM_SOCKET",
];

#[cfg(target_os = "linux")]
const TILING_DESKTOPS: &[&str] = &[
    "awesome", "bspwm", "dwm", "hyprland", "i3", "leftwm", "niri", "qtile", "river", "sway",
    "xmonad",
];

pub fn native_decorations_enabled() -> bool {
    native_decorations_enabled_for_mode(get_cached_config().window_decorations.as_ref(), |name| {
        std::env::var(name).ok()
    })
}

pub fn apply_to_all_windows<R: Runtime>(app: &AppHandle<R>, mode: Option<&WindowDecorationsMode>) {
    let enabled = native_decorations_enabled_for_mode(mode, |name| std::env::var(name).ok());

    for (label, window) in app.webview_windows() {
        if let Err(error) = window.set_decorations(enabled) {
            log::warn!(
                "Failed to set native decorations for window '{}': {}",
                label,
                error
            );
        }
    }
}

fn native_decorations_enabled_for_mode<F>(
    mode: Option<&WindowDecorationsMode>,
    get_variable: F,
) -> bool
where
    F: Fn(&str) -> Option<String>,
{
    match mode.unwrap_or(&WindowDecorationsMode::Automatic) {
        WindowDecorationsMode::AlwaysShow => true,
        WindowDecorationsMode::AlwaysHide => false,
        WindowDecorationsMode::Automatic => automatic_native_decorations_enabled(get_variable),
    }
}

#[cfg(target_os = "linux")]
fn automatic_native_decorations_enabled<F>(get_variable: F) -> bool
where
    F: Fn(&str) -> Option<String>,
{
    !is_tiling_session(get_variable)
}

#[cfg(not(target_os = "linux"))]
fn automatic_native_decorations_enabled<F>(_get_variable: F) -> bool
where
    F: Fn(&str) -> Option<String>,
{
    true
}

#[cfg(target_os = "linux")]
fn is_tiling_session<F>(get_variable: F) -> bool
where
    F: Fn(&str) -> Option<String>,
{
    if TILING_SESSION_VARIABLES
        .iter()
        .any(|name| get_variable(name).is_some())
    {
        return true;
    }

    [
        "XDG_CURRENT_DESKTOP",
        "XDG_SESSION_DESKTOP",
        "DESKTOP_SESSION",
    ]
    .iter()
    .filter_map(|name| get_variable(name))
    .flat_map(|value| {
        value
            .split([':', ';'])
            .map(|part| part.trim().to_ascii_lowercase())
            .collect::<Vec<_>>()
    })
    .any(|desktop| TILING_DESKTOPS.contains(&desktop.as_str()))
}

#[cfg(test)]
#[path = "window_decorations_tests.rs"]
mod tests;
