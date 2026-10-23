//! Watches the pending-approvals directory and emits `ai://pending_approval`
//! Tauri events whenever the MCP subprocess writes a new pending request.
//!
//! Also runs a periodic cleanup that removes stale pending/decision files
//! left behind by crashed MCP processes.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use crate::ai_approval;

pub(crate) const PENDING_APPROVAL_EVENT: &str = "ai://pending_approval";
/// Stale pending+decision files older than this are deleted by the periodic
/// cleanup task. 1 hour is comfortably longer than the maximum approval
/// timeout (`mcp_approval_timeout_seconds` default: 120).
pub(crate) const CLEANUP_MAX_AGE_SECS: u64 = 3_600;
pub(crate) const CLEANUP_INTERVAL_SECS: u64 = 60;
const HEADLESS_POLL_INTERVAL_MS: u64 = 250;

/// Poll the approval queue for headless Web mode and deliver each prompt to
/// exactly one browser session that currently owns the target connection.
pub fn spawn_headless(
    runtime: crate::runtime::RuntimeContext,
    state: Arc<crate::runtime::state::ApplicationState>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let config_dir = runtime.paths.config_dir().to_path_buf();
        let mut delivered = HashMap::new();
        let mut poll = tokio::time::interval(Duration::from_millis(HEADLESS_POLL_INTERVAL_MS));
        let mut last_cleanup = std::time::Instant::now();

        loop {
            poll.tick().await;
            let pending = match ai_approval::list_pending_in(&config_dir) {
                Ok(pending) => pending,
                Err(error) => {
                    log::warn!("Failed to poll pending AI approvals: {error}");
                    continue;
                }
            };
            let current = pending
                .iter()
                .map(|approval| approval.id.clone())
                .collect::<HashSet<_>>();
            delivered.retain(|approval_id, _| current.contains(approval_id));

            for approval in pending {
                let authorized_sessions =
                    crate::application::ai::authorized_sessions_for_pending(&state, &approval);
                if delivered
                    .get(&approval.id)
                    .is_some_and(|owner| authorized_sessions.contains(owner))
                {
                    continue;
                }
                if let Some(previous_owner) = delivered.remove(&approval.id) {
                    crate::application::ai::release_pending_owner(
                        &state,
                        &approval.id,
                        previous_owner,
                    );
                }
                let payload = match serde_json::to_value(&approval) {
                    Ok(payload) => payload,
                    Err(error) => {
                        log::warn!("Failed to serialize {PENDING_APPROVAL_EVENT}: {error}");
                        continue;
                    }
                };
                for session_id in authorized_sessions {
                    if !crate::application::ai::claim_pending_for_session(
                        &state, session_id, &approval,
                    ) {
                        continue;
                    }
                    match runtime.events.emit_to(
                        session_id,
                        PENDING_APPROVAL_EVENT,
                        payload.clone(),
                    ) {
                        Ok(()) => {
                            delivered.insert(approval.id.clone(), session_id);
                            break;
                        }
                        Err(error) => {
                            crate::application::ai::release_pending_owner(
                                &state,
                                &approval.id,
                                session_id,
                            );
                            log::warn!("Failed to emit {PENDING_APPROVAL_EVENT}: {error}");
                        }
                    }
                }
            }

            if last_cleanup.elapsed() >= Duration::from_secs(CLEANUP_INTERVAL_SECS) {
                if let Err(error) =
                    ai_approval::cleanup_expired_in(&config_dir, CLEANUP_MAX_AGE_SECS)
                {
                    log::warn!("Failed to clean pending AI approvals: {error}");
                }
                last_cleanup = std::time::Instant::now();
            }
        }
    })
}

