use crate::plugins::deep_link::*;
use tauri::{AppHandle, Emitter, Manager};

/// Dispatch a single URL to the frontend. Called from:
///   * the deep-link plugin's `on_open_url` handler (warm handoff),
///   * the cold-start `get_current()` path on app boot,
///   * the `single_instance` callback when a second launch forwards args.
///
/// We both **emit** an event (so an already-mounted listener reacts
/// immediately) AND **stash** the request in `PendingInstall` so a fresh
/// React subscription can drain it on mount. Without the stash a cold-start
/// URL is delivered before the webview's event listener exists and silently
/// dropped.
pub fn handle_url(app: &AppHandle, raw: &str) {
    let Some(req) = parse_install_url(raw) else {
        log::info!("Ignoring tabularis:// URL: {}", raw);
        return;
    };

    // Stash for cold-start replay; the frontend pulls this on mount via
    // `consume_pending_deep_link_install`.
    if let Some(state) = app.try_state::<std::sync::Arc<PendingInstall>>() {
        if let Ok(mut slot) = state.0.lock() {
            *slot = Some(req.clone());
        }
    }

    if let Err(err) = app.emit(PLUGIN_INSTALL_EVENT, &req) {
        log::error!(
            "Failed to emit {}: {} (request: {:?})",
            PLUGIN_INSTALL_EVENT,
            err,
            req
        );
    } else {
        log::info!("Emitted {} for slug '{}'", PLUGIN_INSTALL_EVENT, req.slug);
    }

    // Focus the main window so the user sees the confirmation modal —
    // a second launch may otherwise leave Tabularis in the background.
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// Drains the pending deep-link install request, if any. Called from the
/// frontend immediately after the listener mounts to recover URLs that
/// arrived during cold-start before the event subscription existed.
#[tauri::command]
pub fn consume_pending_deep_link_install(
    state: tauri::State<'_, std::sync::Arc<PendingInstall>>,
) -> Option<PluginInstallRequest> {
    state.0.lock().ok().and_then(|mut slot| slot.take())
}
