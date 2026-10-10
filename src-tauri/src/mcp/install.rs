use tauri::{AppHandle, Runtime};

#[tauri::command]
pub async fn get_mcp_status<R: Runtime>(
    _app: AppHandle<R>,
) -> Result<Vec<crate::application::mcp_host::McpClientStatus>, String> {
    crate::application::mcp_host::get_status().await
}

#[tauri::command]
pub async fn install_mcp_config<R: Runtime>(
    _app: AppHandle<R>,
    client_id: String,
) -> Result<String, String> {
    crate::application::mcp_host::install_config(client_id).await
}
