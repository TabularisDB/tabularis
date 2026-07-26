//! Host-side glue for importing an EXPLAIN plan from disk.
//!
//! Everything in this module is a *host* concern: Tauri commands, the standalone
//! window, the CLI hand-off slot and the file read. The parsing itself lives in
//! the `@tabularis/explain` package — the frontend receives the file content
//! untouched and sniffs the format there.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{Manager, Runtime, State};

/// A plan file read from disk, parsed on the frontend by `@tabularis/explain`.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExplainFileContent {
    /// The raw file content, untouched.
    pub content: String,
    /// The basename the UI shows as the plan's source label.
    pub display_name: String,
}

/// Holds the path passed via `--explain <FILE>` on the CLI, so the frontend
/// can claim it once the visual-explain window has mounted.
///
/// The slot is cleared on read to avoid re-opening the same plan if the
/// window is navigated.
#[derive(Default)]
pub struct PendingExplainFile(pub Mutex<Option<String>>);

impl PendingExplainFile {
    pub fn set(&self, path: String) {
        if let Ok(mut guard) = self.0.lock() {
            *guard = Some(path);
        }
    }

    pub fn take(&self) -> Option<String> {
        self.0.lock().ok().and_then(|mut guard| guard.take())
    }
}

/// Tauri command: read an EXPLAIN file from disk.
///
/// The content comes back untouched; the frontend sniffs the format and
/// parses it with `@tabularis/explain`.
#[tauri::command]
pub async fn load_explain_from_file(path: String) -> Result<ExplainFileContent, String> {
    load_from_file(&path).await
}

/// Tauri command: pop the CLI-provided file path (if any).
///
/// Returns `None` after the first successful read, allowing the window to
/// differentiate "cold start from CLI" from "opened manually".
#[tauri::command]
pub fn get_pending_explain_file(state: State<'_, PendingExplainFile>) -> Option<String> {
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
        if let Some(state) = app.try_state::<PendingExplainFile>() {
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
    .build()
    .map_err(|e| format!("Failed to create Visual Explain window: {e}"))?;

    Ok(())
}

/// Tauri command wrapper around [`spawn_visual_explain_window`].
#[tauri::command]
pub async fn open_visual_explain_window<R: Runtime>(
    app: tauri::AppHandle<R>,
    file: Option<String>,
) -> Result<(), String> {
    spawn_visual_explain_window(&app, file)
}

/// Read a file from disk, returning its content plus the display name the UI
/// shows as the plan's source label.
///
/// The heavy file read happens on a blocking thread via `tokio::task::spawn_blocking`
/// so this async wrapper never stalls the runtime.
pub async fn load_from_file(path: &str) -> Result<ExplainFileContent, String> {
    let buf = PathBuf::from(path);
    let content = tokio::task::spawn_blocking(move || std::fs::read_to_string(&buf))
        .await
        .map_err(|e| format!("Failed to read explain file: {e}"))?
        .map_err(|e| format!("Failed to read explain file: {e}"))?;

    Ok(ExplainFileContent {
        content,
        display_name: display_name(path),
    })
}

/// Reduce a path to the basename the UI shows, falling back to the full path.
fn display_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(path)
        .to_string()
}
