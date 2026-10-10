//! Persist only the main window's last normal bounds, separately from
//! user configuration. Utility windows have their own creation constraints.
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{Manager, PhysicalPosition, PhysicalSize, Runtime, WebviewWindow, Window};

const MIN_WIDTH: u32 = 480;
const MIN_HEIGHT: u32 = 320;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct WindowPlacement {
    width: u32,
    height: u32,
    // Window positioning can be unavailable (notably under Wayland).
    x: Option<i32>,
    y: Option<i32>,
}

#[derive(Default)]
pub(crate) struct WindowPlacementCache(Mutex<Option<WindowPlacement>>);

fn placement_path() -> PathBuf {
    crate::paths::get_app_config_dir().join("main-window-placement.json")
}

fn overlaps_monitor(
    saved: WindowPlacement,
    monitor_position: PhysicalPosition<i32>,
    monitor_size: PhysicalSize<u32>,
) -> bool {
    let (x, y) = match (saved.x, saved.y) {
        (Some(x), Some(y)) => (i64::from(x), i64::from(y)),
        _ => return false,
    };
    let (mx, my) = (i64::from(monitor_position.x), i64::from(monitor_position.y));
    // Leave enough of the window visible to move or resize it, even after
    // monitor topology changes. i64 avoids overflow with large coordinates.
    let overlap_x = (x + i64::from(saved.width)).min(mx + i64::from(monitor_size.width))
        - x.max(mx);
    let overlap_y = (y + i64::from(saved.height)).min(my + i64::from(monitor_size.height))
        - y.max(my);
    overlap_x >= 80 && overlap_y >= 80
}

/// Called before the existing start_maximized preference is applied.
/// Missing/corrupt state falls back to Tauri's configured 1280x800 window.
pub(crate) fn restore(window: &WebviewWindow) {
    let path = placement_path();
    let Ok(bytes) = fs::read(&path) else { return };
    let Ok(saved) = serde_json::from_slice::<WindowPlacement>(&bytes) else {
        log::warn!("Ignoring malformed main-window placement at {}", path.display());
        return;
    };
    if saved.width < MIN_WIDTH || saved.height < MIN_HEIGHT { return; }

    // Avoid opening a window larger than the currently attached primary monitor.
    let size = match window.primary_monitor() {
        Ok(Some(monitor)) => PhysicalSize::new(
            saved.width.min(monitor.size().width),
            saved.height.min(monitor.size().height),
        ),
        _ => PhysicalSize::new(saved.width, saved.height),
    };
    if let Err(e) = window.set_size(size) {
        log::warn!("Could not restore main window size: {e}");
    }

    if let (Some(x), Some(y), Ok(monitors)) =
        (saved.x, saved.y, window.available_monitors())
    {
        if monitors.iter().any(|monitor| overlaps_monitor(
            saved,
            *monitor.position(),
            *monitor.size(),
        )) {
            if let Err(e) = window.set_position(PhysicalPosition::new(x, y)) {
                log::debug!("Window positioning not supported: {e}");
            }
        }
    }
    // Keep the last normal bounds available if the user closes while maximized.
    *window.app_handle().state::<WindowPlacementCache>().0.lock().unwrap() = Some(saved);
}

/// Update only in normal mode. Maximizing/minimizing must not overwrite the
/// last non-maximized bounds with screen-sized or zero dimensions.
pub(crate) fn remember<R: Runtime>(window: &Window<R>) {
    if window.is_maximized().unwrap_or(true) || window.is_minimized().unwrap_or(true) {
        return;
    }
    let Ok(size) = window.inner_size() else { return };
    if size.width < MIN_WIDTH || size.height < MIN_HEIGHT { return; }
    let position = window.outer_position().ok();
    let placement = WindowPlacement {
        width: size.width,
        height: size.height,
        x: position.map(|p| p.x),
        y: position.map(|p| p.y),
    };
    *window.app_handle().state::<WindowPlacementCache>().0.lock().unwrap() = Some(placement);
}

/// A single disk write when closing the main window, not on every resize pixel.
pub(crate) fn persist<R: Runtime>(window: &Window<R>) {
    remember(window);
    let cached = *window.app_handle().state::<WindowPlacementCache>().0.lock().unwrap();
    let Some(placement) = cached else { return };
    let path = placement_path();
    let result = (|| -> Result<(), Box<dyn std::error::Error>> {
        if let Some(parent) = path.parent() { fs::create_dir_all(parent)?; }
        fs::write(&path, serde_json::to_vec_pretty(&placement)?)?;
        Ok(())
    })();
    if let Err(e) = result {
        log::warn!("Could not save main window placement: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_negative_coordinates_on_a_secondary_monitor() {
        let state = WindowPlacement { x: Some(-900), y: Some(200), width: 700, height: 500 };
        assert!(overlaps_monitor(
            state, PhysicalPosition::new(-1920, 0), PhysicalSize::new(1920, 1080)
        ));
    }

    #[test]
    fn refuses_off_screen_window_after_monitor_is_removed() {
        let state = WindowPlacement { x: Some(3000), y: Some(100), width: 700, height: 500 };
        assert!(!overlaps_monitor(
            state, PhysicalPosition::new(0, 0), PhysicalSize::new(1920, 1080)
        ));
    }

    #[test]
    fn requires_enough_visible_area_to_grab_window() {
        let state = WindowPlacement { x: Some(1870), y: Some(100), width: 700, height: 500 };
        assert!(!overlaps_monitor(
            state, PhysicalPosition::new(0, 0), PhysicalSize::new(1920, 1080)
        ));
    }
}
