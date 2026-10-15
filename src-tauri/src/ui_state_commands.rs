//! Desktop entry points for the shared UI state store.

use crate::application::ui_state::{execute, UiStateCommand};
use crate::runtime::RuntimeContext;
use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime};

#[tauri::command]
pub async fn get_ui_state<R: Runtime>(
    app: AppHandle<R>,
    keys: Option<Vec<String>>,
) -> Result<Value, String> {
    execute(&app.state::<RuntimeContext>(), UiStateCommand::Get { keys }).await
}

#[tauri::command]
pub async fn set_ui_state<R: Runtime>(
    app: AppHandle<R>,
    key: String,
    value: Value,
) -> Result<(), String> {
    execute(
        &app.state::<RuntimeContext>(),
        UiStateCommand::Set { key, value },
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn delete_ui_state<R: Runtime>(app: AppHandle<R>, key: String) -> Result<(), String> {
    execute(
        &app.state::<RuntimeContext>(),
        UiStateCommand::Delete { key },
    )
    .await?;
    Ok(())
}
