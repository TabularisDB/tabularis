use crate::ai_approval;
use crate::ai_approval_watcher::*;
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::sync::mpsc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Runtime};

/// Spawn the watcher + cleanup tasks. The watcher returns immediately if it
/// fails to initialise (e.g. unsupported filesystem); cleanup keeps running.
pub fn spawn<R: Runtime>(app: AppHandle<R>) {
    let app_for_watcher = app.clone();
    crate::async_rt::spawn_blocking(move || {
        if let Err(e) = run_watcher(app_for_watcher) {
            log::warn!("AI approval watcher disabled: {}", e);
        }
    });

    let app_for_cleanup = app.clone();
    crate::async_rt::spawn(async move {
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
        let cleaned =
            tokio::task::spawn_blocking(|| ai_approval::cleanup_expired(CLEANUP_MAX_AGE_SECS))
                .await
                .ok()
                .and_then(|r| r.ok())
                .unwrap_or(0);
        if cleaned > 0 {
            log::info!("Cleaned {} stale approval file(s)", cleaned);
        }
    }
}
