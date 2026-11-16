use crate::clipboard_import::*;
use tauri::{AppHandle, Manager, Runtime};

#[tauri::command]
pub async fn execute_clipboard_import<R: Runtime>(
    app: AppHandle<R>,
    req: ClipboardImportRequest,
) -> Result<ClipboardImportResult, String> {
    import_with_runtime(&app.state::<crate::runtime::RuntimeContext>(), None, req).await
}
