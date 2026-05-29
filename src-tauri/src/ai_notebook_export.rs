//! Build a `.tabularis-notebook` document from an audit log session.
//!
//! Produces the same JSON shape that the frontend's notebook editor reads
//! and writes (see `src/types/notebook.ts` `NotebookFile`). Results are not
//! embedded — notebook cells re-execute on load, which matches the existing
//! notebook UX.

use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::ai_activity::{read_session_events_in, AiActivityEvent};
use crate::paths::get_app_config_dir;

const NOTEBOOK_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NotebookCellExport {
    #[serde(rename = "type")]
    pub cell_type: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NotebookExport {
    pub version: u32,
    pub title: String,
    pub created_at: String,
    pub cells: Vec<NotebookCellExport>,
}

pub fn export_session_in(
    dir: &Path,
    session_id: &str,
    tz: Option<&str>,
) -> Result<NotebookExport, String> {
    let events = read_session_events_in(dir, session_id)?;
    if events.is_empty() {
        return Err(format!("No events found for session {}", session_id));
    }
    Ok(build_notebook(session_id, &events, tz))
}

pub fn export_session(session_id: &str, tz: Option<&str>) -> Result<NotebookExport, String> {
    export_session_in(&get_app_config_dir(), session_id, tz)
}

fn build_notebook(session_id: &str, events: &[AiActivityEvent], tz: Option<&str>) -> NotebookExport {
    let header = build_header_cell(session_id, events, tz);
    let mut cells: Vec<NotebookCellExport> = vec![header];

    let mut query_index = 1usize;
    for ev in events {
        match ev.tool.as_str() {
            "run_query" => {
                if let Some(query) = ev.query.as_deref() {
                    let name = derive_cell_name(query, query_index);
                    cells.push(NotebookCellExport {
                        cell_type: "sql".to_string(),
                        content: query.to_string(),
                        name: Some(name),
                        schema: ev.connection_name.clone(),
                    });
                    query_index += 1;
                }
            }
            "list_tables" | "describe_table" => {
                cells.push(NotebookCellExport {
                    cell_type: "markdown".to_string(),
                    content: build_metadata_cell(ev),
                    name: Some(format!("Context — {}", ev.tool)),
                    schema: None,
                });
            }
            _ => {}
        }
    }

    NotebookExport {
        version: NOTEBOOK_VERSION,
        title: format!("AI Session {}", session_id),
        created_at: events
            .first()
            .map(|e| e.timestamp.clone())
            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
        cells,
    }
}

fn build_header_cell(
    session_id: &str,
    events: &[AiActivityEvent],
    tz: Option<&str>,
) -> NotebookCellExport {
    // Timestamps are stored as UTC; render the human-readable Started/Ended
    // values in the user's display timezone to match the rest of the UI. The
    // min/max run on the raw UTC strings (uniform offset keeps them ordered)
    // before converting the chosen endpoints.
    let started = events
        .iter()
        .map(|e| e.timestamp.clone())
        .min()
        .map(|ts| crate::ai_activity::to_local_rfc3339(&ts, tz))
        .unwrap_or_default();
    let ended = events
        .iter()
        .map(|e| e.timestamp.clone())
        .max()
        .map(|ts| crate::ai_activity::to_local_rfc3339(&ts, tz))
        .unwrap_or_default();
    let client_hint = events
        .iter()
        .find_map(|e| e.client_hint.clone())
        .unwrap_or_else(|| "unknown client".to_string());
    let mut connections: Vec<String> = events
        .iter()
        .filter_map(|e| e.connection_name.clone())
        .collect();
    connections.sort();
    connections.dedup();
    let conn_list = if connections.is_empty() {
        "—".to_string()
    } else {
        connections.join(", ")
    };

    let content = format!(
        "# AI Session {session_id}\n\n\
         - **Client:** {client_hint}\n\
         - **Connections:** {conn_list}\n\
         - **Started:** {started}\n\
         - **Ended:** {ended}\n\
         - **Events:** {count}\n\n\
         > Cell results are not included — re-run the cells to repopulate them.",
        session_id = session_id,
        client_hint = client_hint,
        conn_list = conn_list,
        started = started,
        ended = ended,
        count = events.len(),
    );

    NotebookCellExport {
        cell_type: "markdown".to_string(),
        content,
        name: Some("Session metadata".to_string()),
        schema: None,
    }
}

fn build_metadata_cell(ev: &AiActivityEvent) -> String {
    let conn = ev.connection_name.as_deref().unwrap_or("?");
    let status = &ev.status;
    let preview = ev
        .query
        .as_deref()
        .map(|q| format!("\n\n```\n{}\n```", q))
        .unwrap_or_default();
    format!(
        "**Tool:** `{tool}` on `{conn}` — *{status}*{preview}",
        tool = ev.tool,
        conn = conn,
        status = status,
        preview = preview
    )
}

/// Derive a friendly cell name from the first single-line `--` comment in
/// the query, or fall back to a positional name like `Query 3`.
pub fn derive_cell_name(query: &str, fallback_index: usize) -> String {
    for line in query.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("--") {
            let comment = rest.trim();
            if !comment.is_empty() {
                return shorten(comment, 60);
            }
        } else if !trimmed.is_empty() {
            // First non-comment line means we missed the chance.
            break;
        }
    }
    format!("Query {}", fallback_index)
}

fn shorten(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(max).collect();
        out.push('…');
        out
    }
}
