use crate::explain_import::*;
use tauri::{Manager, Runtime, State};

/// Tauri command: pop the CLI-provided file path (if any).
///
/// Returns `None` after the first successful read, allowing the window to
/// differentiate "cold start from CLI" from "opened manually".
#[tauri::command]
pub fn get_pending_explain_file(
    state: State<'_, std::sync::Arc<PendingExplainFile>>,
) -> Option<String> {
    state.take()
}

/// Creates (or focuses) the standalone Visual Explain window.
///
/// Runs fully synchronously so it can be invoked from the Tauri `setup` hook
/// without taking a detour through the async runtime.
pub fn spawn_visual_explain_window<R: Runtime, M: Manager<R>>(
    app: &M,
    file: Option<String>,
) -> Result<(), String> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    if let Some(path) = file.as_ref() {
        if let Some(state) = app.try_state::<std::sync::Arc<PendingExplainFile>>() {
            state.set(path.clone());
        }
    }

    if let Some(existing) = app.get_webview_window("visual-explain") {
        existing
            .set_focus()
            .map_err(|e| format!("Failed to focus Visual Explain window: {e}"))?;
        return Ok(());
    }

    WebviewWindowBuilder::new(
        app,
        "visual-explain",
        WebviewUrl::App("/visual-explain".into()),
    )
    .title("tabularis - Visual Explain")
    .inner_size(1280.0, 820.0)
    .min_inner_size(900.0, 600.0)
    .center()
    .decorations(crate::transport::desktop::window_decorations::native_decorations_enabled())
    .build()
    .map_err(|e| format!("Failed to create Visual Explain window: {e}"))?;

    Ok(())
}

/// Tauri command: read an EXPLAIN file from disk.
///
/// The content comes back untouched; the frontend sniffs the format and
/// parses it with `@tabularis/explain`.
#[tauri::command]
pub async fn load_explain_from_file(path: String) -> Result<ExplainFileContent, String> {
    crate::explain_import::load_explain_from_file(path).await
}
