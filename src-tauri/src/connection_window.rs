use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use urlencoding::encode;

/// Window label for a connection opened in its own window. One window per
/// connection id, so re-invoking just focuses the existing one.
pub fn window_label(connection_id: &str) -> String {
    // Window labels only allow alphanumerics plus `-`, `/`, `:`, `_`, `.`.
    // Connection ids are UUID-like but sanitize defensively so any id is safe.
    let sanitized: String = connection_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect();
    format!("connection-window-{}", sanitized)
}

pub fn connection_route(connection_id: &str) -> String {
    format!(
        "/connections?connect={}&standalone=connection",
        encode(connection_id)
    )
}

/// Open (or focus) a standalone window bound to a specific connection. The new
/// window loads the shared connections route with a `connect` query parameter,
/// which the frontend reads on startup to auto-connect and jump to the editor.
#[tauri::command]
pub async fn open_connection_window(
    app: AppHandle,
    connection_id: String,
    title: Option<String>,
) -> Result<(), String> {
    let label = window_label(&connection_id);

    // If a window for this connection already exists, just bring it to the front.
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.unminimize();
        let _ = window.set_focus();
        return Ok(());
    }

    let window_title = match title {
        Some(t) => format!("tabularis - {}", t),
        None => "tabularis".to_string(),
    };

    let url = connection_route(&connection_id);

    let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .title(&window_title)
        .inner_size(1280.0, 800.0)
        .min_inner_size(800.0, 500.0)
        .center()
        .background_color(tauri::webview::Color(2, 6, 23, 255))
        // The native drag-drop handler swallows DOM drag events (sidebar
        // reorder, split panel moves), see dragDropEnabled in tauri.conf.json
        .disable_drag_drop_handler()
        .build()
        .map_err(|e| format!("Failed to create connection window: {}", e))?;

    // A dedicated connection window owns its connection: when it closes, tear
    // down the backend pool so the connection doesn't leak. The main window no
    // longer references this connection (it was detached on the frontend), so
    // closing the pool here is safe.
    let close_app = app.clone();
    let close_connection_id = connection_id.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { .. } = event {
            let app = close_app.clone();
            let connection_id = close_connection_id.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) =
                    crate::commands::disconnect_connection(app, connection_id.clone()).await
                {
                    log::warn!(
                        "Failed to disconnect '{}' on connection window close: {}",
                        connection_id,
                        e
                    );
                }
            });
        }
    });

    Ok(())
}
