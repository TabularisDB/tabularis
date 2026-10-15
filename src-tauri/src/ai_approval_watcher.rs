//! Watches the pending-approvals directory and emits `ai://pending_approval`
//! Tauri events whenever the MCP subprocess writes a new pending request.
//!
//! Also runs a periodic cleanup that removes stale pending/decision files
//! left behind by crashed MCP processes.

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::{HashMap, HashSet};
use std::sync::{mpsc, Arc};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Runtime};

use crate::ai_approval;

const PENDING_APPROVAL_EVENT: &str = "ai://pending_approval";
/// Stale pending+decision files older than this are deleted by the periodic
/// cleanup task. 1 hour is comfortably longer than the maximum approval
/// timeout (`mcp_approval_timeout_seconds` default: 120).
const CLEANUP_MAX_AGE_SECS: u64 = 3_600;
const CLEANUP_INTERVAL_SECS: u64 = 60;
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

/// Spawn the watcher + cleanup tasks. The watcher returns immediately if it
/// fails to initialise (e.g. unsupported filesystem); cleanup keeps running.
pub fn spawn<R: Runtime>(app: AppHandle<R>) {
    let app_for_watcher = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(e) = run_watcher(app_for_watcher) {
            log::warn!("AI approval watcher disabled: {}", e);
        }
    });

    let app_for_cleanup = app.clone();
    tauri::async_runtime::spawn(async move {
        run_cleanup_loop(app_for_cleanup).await;
    });
}

fn run_watcher<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let dir = ai_approval::approvals_dir_path();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
    let mut watcher: RecommendedWatcher =
        notify::recommended_watcher(tx).map_err(|e| e.to_string())?;
    watcher
        .watch(&dir, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;

    log::info!("AI approval watcher started on {}", dir.display());

    // The watcher is dropped when this function returns; keep it alive for the
    // process lifetime by looping forever.
    for evt in rx {
        match evt {
            Ok(event) => handle_event(&app, &event),
            Err(e) => log::warn!("approval watcher error: {}", e),
        }
    }
    Ok(())
}

fn handle_event<R: Runtime>(app: &AppHandle<R>, event: &Event) {
    if !matches!(event.kind, EventKind::Create(_) | EventKind::Modify(_)) {
        return;
    }
    for path in &event.paths {
        let name = match path.file_name().and_then(|s| s.to_str()) {
            Some(n) => n,
            None => continue,
        };
        if !name.ends_with(".pending.json") {
            continue;
        }
        let id = name.trim_end_matches(".pending.json").to_string();
        // The file may not yet be fully flushed when notify fires Create —
        // try to read; if it fails this iteration we'll catch it on the
        // next Modify event.
        if let Ok(Some(pending)) = ai_approval::read_pending(&id) {
            if let Err(e) = app.emit(PENDING_APPROVAL_EVENT, &pending) {
                log::warn!("Failed to emit {}: {}", PENDING_APPROVAL_EVENT, e);
            }
        }
    }
}

async fn run_cleanup_loop<R: Runtime>(_app: AppHandle<R>) {
    let mut ticker = tokio::time::interval(Duration::from_secs(CLEANUP_INTERVAL_SECS));
    // Skip the immediate first tick.
    ticker.tick().await;
    loop {
        ticker.tick().await;
        let cleaned = tokio::task::spawn_blocking(|| {
            ai_approval::cleanup_expired(CLEANUP_MAX_AGE_SECS)
        })
        .await
        .ok()
        .and_then(|r| r.ok())
        .unwrap_or(0);
        if cleaned > 0 {
            log::info!("Cleaned {} stale approval file(s)", cleaned);
        }
    }
}
