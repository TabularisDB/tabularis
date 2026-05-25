//! Tauri commands exposed to the frontend for AI activity, approval gates,
//! and notebook export. The MCP subprocess writes the underlying files; the
//! main app only reads and decides on them through these endpoints.

use crate::ai_activity::{self, AiActivityEvent, EventFilter, SessionSummary};
use crate::ai_approval::{self, ApprovalDecision, PendingApproval};
use crate::ai_notebook_export::{self, NotebookExport};
use crate::config;

/// The user's configured display timezone (IANA name), or `None` to fall back
/// to the OS local timezone. Read from `config.json` so exports match the UI.
fn display_timezone() -> Option<String> {
    config::load_config_from_disk().display_timezone
}

#[tauri::command]
pub async fn get_ai_activity(
    filter: Option<EventFilter>,
) -> Result<Vec<AiActivityEvent>, String> {
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
    let events =
        tokio::task::spawn_blocking(|| ai_activity::read_events(&EventFilter::default()))
            .await
            .map_err(|e| e.to_string())??;
    let tz = display_timezone();
    let mut out = String::new();
    for mut ev in events {
        ev.timestamp = ai_activity::to_local_rfc3339(&ev.timestamp, tz.as_deref());
        let line = serde_json::to_string(&ev).map_err(|e| e.to_string())?;
        out.push_str(&line);
        out.push('\n');
    }
    Ok(out)
}

#[tauri::command]
pub async fn export_ai_activity_csv() -> Result<String, String> {
    let events =
        tokio::task::spawn_blocking(|| ai_activity::read_events(&EventFilter::default()))
            .await
            .map_err(|e| e.to_string())??;
    let mut wtr = csv::Writer::from_writer(vec![]);
    wtr.write_record([
        "id",
        "session_id",
        "timestamp",
        "tool",
        "connection_id",
        "connection_name",
        "query",
        "query_kind",
        "duration_ms",
        "status",
        "rows",
        "error",
        "client_hint",
        "approval_id",
    ])
    .map_err(|e| e.to_string())?;
    let tz = display_timezone();
    for ev in events {
        let timestamp = ai_activity::to_local_rfc3339(&ev.timestamp, tz.as_deref());
        wtr.write_record([
            ev.id,
            ev.session_id,
            timestamp,
            ev.tool,
            ev.connection_id.unwrap_or_default(),
            ev.connection_name.unwrap_or_default(),
            ev.query.unwrap_or_default(),
            ev.query_kind.unwrap_or_default(),
            ev.duration_ms.to_string(),
            ev.status,
            ev.rows.map(|r| r.to_string()).unwrap_or_default(),
            ev.error.unwrap_or_default(),
            ev.client_hint.unwrap_or_default(),
            ev.approval_id.unwrap_or_default(),
        ])
        .map_err(|e| e.to_string())?;
    }
    let bytes = wtr.into_inner().map_err(|e| e.to_string())?;
    String::from_utf8(bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn export_ai_session_as_notebook(session_id: String) -> Result<NotebookExport, String> {
    let tz = display_timezone();
    tokio::task::spawn_blocking(move || {
        ai_notebook_export::export_session(&session_id, tz.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
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
