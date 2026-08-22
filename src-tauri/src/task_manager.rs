use crate::application::operations;
use crate::runtime::RuntimeContext;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

pub use operations::{
    ChildProcessInfo, ProcessInfo, SystemStats, TabularisChildProcess, TabularisSelfStats,
};

#[tauri::command]
pub async fn get_process_list() -> Result<Vec<ProcessInfo>, String> {
    operations::get_process_list().await
}

#[tauri::command]
pub async fn get_system_stats() -> Result<SystemStats, String> {
    operations::get_system_stats().await
}

#[tauri::command]
pub async fn get_tabularis_children() -> Result<Vec<TabularisChildProcess>, String> {
    operations::get_tabularis_children().await
}

#[tauri::command]
pub async fn kill_plugin_process(plugin_id: String) -> Result<(), String> {
    crate::application::plugins::kill_plugin_process(plugin_id).await
}

#[tauri::command]
pub async fn restart_plugin_process(
    runtime: State<'_, RuntimeContext>,
    plugin_id: String,
) -> Result<(), String> {
    crate::application::plugins::restart_plugin_process(runtime.inner(), plugin_id).await
}

#[tauri::command]
pub async fn open_task_manager_window(app: AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window("task-manager") {
        existing
            .set_focus()
            .map_err(|error| format!("Failed to focus task manager window: {error}"))?;
        return Ok(());
    }

    WebviewWindowBuilder::new(
        &app,
        "task-manager",
        WebviewUrl::App("/task-manager".into()),
    )
    .title("tabularis - Task Manager")
    .inner_size(900.0, 600.0)
    .min_inner_size(700.0, 450.0)
    .center()
    .build()
    .map_err(|error| format!("Failed to create task manager window: {error}"))?;

    Ok(())
}
