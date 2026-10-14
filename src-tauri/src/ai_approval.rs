//! Approval gate IPC for MCP write/DDL queries.
//!
//! The MCP subprocess cannot show UI. To gate sensitive queries on user
//! approval we use a file-queue:
//!   - MCP writes `{id}.pending.json` and polls for `{id}.decision.json`
//!   - The main Tauri app watches the directory, opens an approval modal,
//!     then writes `{id}.decision.json`
//!
//! Storage: `<config_dir>/pending_approvals/`.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::paths::get_app_config_dir;

const DIR_NAME: &str = "pending_approvals";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PendingApproval {
    pub id: String,
    pub created_at: String,
    pub session_id: String,
    pub connection_id: String,
    pub connection_name: String,
    /// Database the query targets when the MCP caller picked one other than
    /// the connection's default, so the approver sees where a write lands.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub database: Option<String>,
    pub query: String,
    pub query_kind: String,
    pub client_hint: Option<String>,
    pub explain_plan: Option<serde_json::Value>,
    pub explain_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalDecision {
    pub approval_id: String,
    pub decided_at: String,
    /// `"approve"` or `"deny"`.
    pub decision: String,
    pub reason: Option<String>,
    pub edited_query: Option<String>,
}

/// Result of polling for an approval decision when liveness checking is in
/// play. `HostUnavailable` signals that the GUI heartbeat went stale during
/// polling — there is nobody left to write the decision file, so further
/// waiting is pointless.
#[derive(Debug, PartialEq)]
pub enum PollOutcome {
    Decided(ApprovalDecision),
    TimedOut,
    HostUnavailable,
}

// ---------------------------------------------------------------------------
// Path helpers (testable: take a directory)
// ---------------------------------------------------------------------------

fn approvals_dir(base: &Path) -> PathBuf {
    base.join(DIR_NAME)
}

fn ensure_dir(base: &Path) -> Result<PathBuf, String> {
    let dir = approvals_dir(base);
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(dir)
}

fn pending_file(base: &Path, id: &str) -> PathBuf {
    approvals_dir(base).join(format!("{}.pending.json", id))
}

fn decision_file(base: &Path, id: &str) -> PathBuf {
    approvals_dir(base).join(format!("{}.decision.json", id))
}

// ---------------------------------------------------------------------------
// Writers / readers
// ---------------------------------------------------------------------------

pub fn write_pending_in(base: &Path, req: &PendingApproval) -> Result<PathBuf, String> {
    let dir = ensure_dir(base)?;
    let path = dir.join(format!("{}.pending.json", req.id));
    let content = serde_json::to_string_pretty(req).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(path)
}

pub fn read_pending_in(base: &Path, id: &str) -> Result<Option<PendingApproval>, String> {
    let path = pending_file(base, id);
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content)
        .map(Some)
        .map_err(|e| e.to_string())
}

pub fn list_pending_in(base: &Path) -> Result<Vec<PendingApproval>, String> {
    let dir = approvals_dir(base);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out: Vec<PendingApproval> = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = match path.file_name().and_then(|s| s.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        if !name.ends_with(".pending.json") {
            continue;
        }
        // Skip if already decided.
        let id = name.trim_end_matches(".pending.json").to_string();
        if decision_file(base, &id).exists() {
            continue;
        }
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(p) = serde_json::from_str::<PendingApproval>(&content) {
                out.push(p);
            }
        }
    }
    out.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    Ok(out)
}

pub fn write_decision_in(base: &Path, decision: &ApprovalDecision) -> Result<(), String> {
    ensure_dir(base)?;
    let path = decision_file(base, &decision.approval_id);
    let content = serde_json::to_string_pretty(decision).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

pub fn read_decision_in(base: &Path, id: &str) -> Result<Option<ApprovalDecision>, String> {
    let path = decision_file(base, id);
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content)
        .map(Some)
        .map_err(|e| e.to_string())
}

/// Async polling helper. Returns `Ok(Some(decision))` once a decision file
/// is written, or `Ok(None)` if `timeout_secs` elapses with none.
///
/// The returned future also clears both the pending and decision files so
/// the directory does not accumulate consumed approvals.
pub async fn poll_decision_in(
    base: &Path,
    approval_id: &str,
    timeout_secs: u64,
    poll_interval_ms: u64,
) -> Result<Option<ApprovalDecision>, String> {
    match poll_decision_with_liveness_in(base, approval_id, timeout_secs, poll_interval_ms, || {
        true
    })
    .await?
    {
        PollOutcome::Decided(d) => Ok(Some(d)),
        PollOutcome::TimedOut => Ok(None),
        // Unreachable when `is_alive` always returns true, but map defensively.
        PollOutcome::HostUnavailable => Ok(None),
    }
}

/// Same as `poll_decision_in`, but also bails out with
/// `PollOutcome::HostUnavailable` as soon as `is_alive()` returns false.
/// Used by the MCP subprocess to detect that the Tabularis GUI exited
/// mid-approval and fail without waiting for the full timeout.
pub async fn poll_decision_with_liveness_in<F>(
    base: &Path,
    approval_id: &str,
    timeout_secs: u64,
    poll_interval_ms: u64,
    is_alive: F,
) -> Result<PollOutcome, String>
where
    F: Fn() -> bool,
{
    let deadline = std::time::Instant::now() + Duration::from_secs(timeout_secs);
    loop {
        if let Some(decision) = read_decision_in(base, approval_id)? {
            let _ = fs::remove_file(decision_file(base, approval_id));
            let _ = fs::remove_file(pending_file(base, approval_id));
            return Ok(PollOutcome::Decided(decision));
        }
        if !is_alive() {
            let _ = fs::remove_file(pending_file(base, approval_id));
            return Ok(PollOutcome::HostUnavailable);
        }
        if std::time::Instant::now() >= deadline {
            let _ = fs::remove_file(pending_file(base, approval_id));
            return Ok(PollOutcome::TimedOut);
        }
        tokio::time::sleep(Duration::from_millis(poll_interval_ms)).await;
    }
}

/// Remove pending+decision files older than `max_age_secs`.
/// Returns the number of files deleted.
pub fn cleanup_expired_in(base: &Path, max_age_secs: u64) -> Result<usize, String> {
    let dir = approvals_dir(base);
    if !dir.exists() {
        return Ok(0);
    }
    let mut deleted = 0usize;
    let now = std::time::SystemTime::now();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let modified = match metadata.modified() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let age = match now.duration_since(modified) {
            Ok(a) => a,
            Err(_) => continue,
        };
        if age.as_secs() > max_age_secs && fs::remove_file(&path).is_ok() {
            deleted += 1;
        }
    }
    Ok(deleted)
}

// ---------------------------------------------------------------------------
// Default-dir wrappers (used at runtime)
// ---------------------------------------------------------------------------

pub fn write_pending(req: &PendingApproval) -> Result<PathBuf, String> {
    write_pending_in(&get_app_config_dir(), req)
}

pub fn list_pending() -> Result<Vec<PendingApproval>, String> {
    list_pending_in(&get_app_config_dir())
}

pub fn read_pending(id: &str) -> Result<Option<PendingApproval>, String> {
    read_pending_in(&get_app_config_dir(), id)
}

pub fn write_decision(decision: &ApprovalDecision) -> Result<(), String> {
    write_decision_in(&get_app_config_dir(), decision)
}

pub async fn poll_decision(
    approval_id: &str,
    timeout_secs: u64,
    poll_interval_ms: u64,
) -> Result<Option<ApprovalDecision>, String> {
    poll_decision_in(
        &get_app_config_dir(),
        approval_id,
        timeout_secs,
        poll_interval_ms,
    )
    .await
}

/// Default-dir wrapper for liveness-aware polling. The MCP subprocess wires
/// `is_alive` to the heartbeat module so it can short-circuit when the GUI
/// is closed.
pub async fn poll_decision_with_liveness<F>(
    approval_id: &str,
    timeout_secs: u64,
    poll_interval_ms: u64,
    is_alive: F,
) -> Result<PollOutcome, String>
where
    F: Fn() -> bool,
{
    poll_decision_with_liveness_in(
        &get_app_config_dir(),
        approval_id,
        timeout_secs,
        poll_interval_ms,
        is_alive,
    )
    .await
}

pub fn cleanup_expired(max_age_secs: u64) -> Result<usize, String> {
    cleanup_expired_in(&get_app_config_dir(), max_age_secs)
}

pub fn approvals_dir_path() -> PathBuf {
    approvals_dir(&get_app_config_dir())
}

pub fn new_approval_id() -> String {
    uuid::Uuid::new_v4().to_string()
}
