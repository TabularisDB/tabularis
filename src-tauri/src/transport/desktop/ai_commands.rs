//! Tauri commands exposed to the frontend for AI activity, approval gates,
//! and notebook export. The MCP subprocess writes the underlying files; the
//! main app only reads and decides on them through these endpoints.

use crate::ai_activity::EventFilter;
use crate::ai_notebook_export::NotebookExport;
use crate::application::ai::{self, AiCommand};
use crate::runtime::{state::ApplicationState, RuntimeContext};
use serde_json::Value;
use std::sync::Arc;
use tauri::{AppHandle, Manager};

async fn execute(app: &AppHandle, command: AiCommand) -> Result<Value, String> {
    let state = app.state::<Arc<ApplicationState>>();
    ai::execute(&app.state::<RuntimeContext>(), &state, None, command).await
}

#[tauri::command]
pub async fn get_ai_activity(app: AppHandle, filter: Option<EventFilter>) -> Result<Value, String> {
    execute(&app, AiCommand::GetActivity { filter }).await
}

#[tauri::command]
pub async fn get_ai_sessions(app: AppHandle) -> Result<Value, String> {
    execute(&app, AiCommand::GetSessions).await
}

#[tauri::command]
pub async fn get_ai_session_events(app: AppHandle, session_id: String) -> Result<Value, String> {
    execute(&app, AiCommand::GetSessionEvents { session_id }).await
}

#[tauri::command]
pub async fn clear_ai_activity(app: AppHandle) -> Result<Value, String> {
    execute(&app, AiCommand::ClearActivity).await
}

#[tauri::command]
pub async fn list_pending_approvals(app: AppHandle) -> Result<Value, String> {
    execute(&app, AiCommand::ListPendingApprovals).await
}

#[tauri::command]
pub async fn decide_pending_approval(
    app: AppHandle,
    approval_id: String,
    decision: String,
    reason: Option<String>,
    edited_query: Option<String>,
) -> Result<Value, String> {
    execute(
        &app,
        AiCommand::DecidePendingApproval {
            approval_id,
            decision,
            reason,
            edited_query,
        },
    )
    .await
}

#[tauri::command]
pub async fn get_ai_schema_context(
    app: AppHandle,
    connection_id: String,
    schema: Option<String>,
    database: Option<String>,
) -> Result<Value, String> {
    execute(
        &app,
        AiCommand::GetSchemaContext {
            connection_id,
            schema,
            database,
        },
    )
    .await
}

#[tauri::command]
pub async fn export_ai_activity_json() -> Result<String, String> {
    crate::application::generic_exports::generate_ai_activity_json().await
}

#[tauri::command]
pub async fn export_ai_activity_csv() -> Result<String, String> {
    crate::application::generic_exports::generate_ai_activity_csv().await
}

#[tauri::command]
pub async fn export_ai_session_as_notebook(session_id: String) -> Result<NotebookExport, String> {
    crate::application::generic_exports::generate_ai_session_notebook(session_id).await
}
