//! Tauri commands exposed to the frontend for AI activity, approval gates,
//! and notebook export. The MCP subprocess writes the underlying files; the
//! main app only reads and decides on them through these endpoints.

use crate::ai_activity::{self, AiActivityEvent, EventFilter, SessionSummary};
use crate::ai_approval::{self, ApprovalDecision, PendingApproval};
use crate::ai_notebook_export::NotebookExport;

#[tauri::command]
pub async fn get_ai_activity(filter: Option<EventFilter>) -> Result<Vec<AiActivityEvent>, String> {
    let f = filter.unwrap_or_default();
    tokio::task::spawn_blocking(move || ai_activity::read_events(&f))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_ai_sessions() -> Result<Vec<SessionSummary>, String> {
    tokio::task::spawn_blocking(ai_activity::read_sessions)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_ai_session_events(session_id: String) -> Result<Vec<AiActivityEvent>, String> {
    tokio::task::spawn_blocking(move || ai_activity::read_session_events(&session_id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn clear_ai_activity() -> Result<(), String> {
    tokio::task::spawn_blocking(ai_activity::clear)
        .await
        .map_err(|e| e.to_string())?
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

#[tauri::command]
pub async fn list_pending_approvals() -> Result<Vec<PendingApproval>, String> {
    tokio::task::spawn_blocking(ai_approval::list_pending)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn decide_pending_approval(
    approval_id: String,
    decision: String,
    reason: Option<String>,
    edited_query: Option<String>,
) -> Result<(), String> {
    if decision != "approve" && decision != "deny" {
        return Err(format!(
            "Invalid decision '{}': expected 'approve' or 'deny'",
            decision
        ));
    }
    let payload = ApprovalDecision {
        approval_id,
        decided_at: ai_activity::now_iso8601(),
        decision,
        reason,
        edited_query,
    };
    tokio::task::spawn_blocking(move || ai_approval::write_decision(&payload))
        .await
        .map_err(|e| e.to_string())?
}
