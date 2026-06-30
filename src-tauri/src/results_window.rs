use std::collections::HashMap;
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use urlencoding::encode;

/// Persisted geometry so a re-opened detached results window restores where the
/// user last left it. Mirrors the pattern used by `json_viewer.rs`.
#[derive(Debug, Clone, Copy)]
pub struct WindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Geometry is remembered per tab so that with several windows detached at once
/// each one re-opens where its own window last was, instead of all stacking on
/// top of the most-recently-closed one.
#[derive(Default)]
pub struct ResultsWindowStore {
    pub bounds: Mutex<HashMap<String, WindowBounds>>,
}

/// One detached results window per editor tab. The frontend keeps each window's
/// data in sync over Tauri events keyed by `tab_id`.
fn window_label(tab_id: &str) -> String {
    format!("results-window-{}", tab_id)
}

/// Open (or focus) the detached results window for a given tab. Result data is
/// streamed from the main window via the `results-window:sync` event (keyed by
/// `tabId`), so no payload is passed here.
#[tauri::command]
pub async fn open_results_window(
    app: AppHandle,
    store: tauri::State<'_, ResultsWindowStore>,
    tab_id: String,
    title: Option<String>,
) -> Result<(), String> {
    let label = window_label(&tab_id);

    // If it already exists, just bring it to the front.
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.unminimize();
        let _ = window.set_focus();
        return Ok(());
    }

    let window_title = title.unwrap_or_else(|| "Query Results".to_string());

    let remembered = store
        .bounds
        .lock()
        .map_err(|e| format!("Failed to acquire bounds lock: {}", e))?
        .get(&tab_id)
        .copied();

    let url = format!("/results-window?tab={}", encode(&tab_id));
    let mut builder =
        WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
            .title(&window_title)
            .min_inner_size(500.0, 300.0)
            .background_color(tauri::webview::Color(2, 6, 23, 255));

    builder = match remembered {
        Some(b) => builder
            .inner_size(b.width as f64, b.height as f64)
            .position(b.x as f64, b.y as f64),
        None => builder.inner_size(900.0, 600.0).center(),
    };

    match builder.build() {
        Err(e) => Err(format!("Failed to create results window: {}", e)),
        Ok(window) => {
            let app_handle = app.clone();
            let captured_label = label.clone();
            let captured_tab_id = tab_id.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { .. } = event {
                    if let Some(win) = app_handle.get_webview_window(&captured_label) {
                        // Save the inner size: it is restored via `.inner_size(...)`
                        // below, so saving `outer_size()` would grow the window by
                        // the decoration height on each detach→close→reopen cycle.
                        if let (Ok(pos), Ok(size)) = (win.outer_position(), win.inner_size()) {
                            let store = app_handle.state::<ResultsWindowStore>();
                            if let Ok(mut bounds) = store.bounds.lock() {
                                bounds.insert(
                                    captured_tab_id.clone(),
                                    WindowBounds {
                                        x: pos.x,
                                        y: pos.y,
                                        width: size.width,
                                        height: size.height,
                                    },
                                );
                            };
                        }
                    }
                    // Let the main window re-attach this tab's results panel.
                    let _ = app_handle.emit(
                        "results-window:closed",
                        serde_json::json!({ "tabId": captured_tab_id }),
                    );
                }
            });
            Ok(())
        }
    }
}

/// Programmatically close a tab's detached results window (used by the
/// "Re-attach" button and when the bound tab is closed).
#[tauri::command]
pub async fn close_results_window(app: AppHandle, tab_id: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(&window_label(&tab_id)) {
        window
            .close()
            .map_err(|e| format!("Failed to close results window: {}", e))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_label_is_tab_scoped() {
        assert_eq!(window_label("abc"), "results-window-abc");
        assert_eq!(window_label("tab-123"), "results-window-tab-123");
        // Distinct tabs must map to distinct labels (each gets its own window).
        assert_ne!(window_label("a"), window_label("b"));
    }

    #[test]
    fn bounds_are_remembered_per_tab() {
        let store = ResultsWindowStore::default();
        {
            let mut bounds = store.bounds.lock().unwrap();
            bounds.insert(
                "tab-a".to_string(),
                WindowBounds {
                    x: 100,
                    y: 200,
                    width: 800,
                    height: 600,
                },
            );
            bounds.insert(
                "tab-b".to_string(),
                WindowBounds {
                    x: 10,
                    y: 20,
                    width: 400,
                    height: 300,
                },
            );
        }
        let bounds = store.bounds.lock().unwrap();
        let a = bounds.get("tab-a").unwrap();
        assert_eq!((a.x, a.y, a.width, a.height), (100, 200, 800, 600));
        let b = bounds.get("tab-b").unwrap();
        assert_eq!((b.x, b.y, b.width, b.height), (10, 20, 400, 300));
    }

    #[test]
    fn bounds_default_is_empty() {
        let store = ResultsWindowStore::default();
        assert!(store.bounds.lock().unwrap().is_empty());
    }
}
