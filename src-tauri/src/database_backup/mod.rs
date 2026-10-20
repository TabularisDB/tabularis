//! Scheduled database content backups (Milestone 1).
//!
//! Manages daily scheduled backups of database contents while the app is open
//! (app-open execution boundary). Uses the dump pipeline (`dump_commands`),
//! respects IANA timezone boundaries, enforces strict non-concurrency,
//! and prunes oldest successful backups without ever touching good backups
//! upon failure.

mod files;
mod schedule;

#[cfg(test)]
mod tests;

pub use files::*;
pub use schedule::*;

use chrono::{DateTime, Utc};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::fs;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime};

use crate::config::DatabaseBackupPlan;
use crate::dump_commands::{
    abort_slot, db_backup_slot_key, dump_database_with_handles, DumpCancellationState, DumpOptions,
    DUMP_CANCELLED,
};

// ---------- Runtime state & lock ----------

struct DatabaseBackupRuntimeState {
    is_running: AtomicBool,
    was_cancelled: AtomicBool,
    last_run_at: Mutex<Option<String>>,
    last_successful_run_at: Mutex<Option<String>>,
    last_outcome: Mutex<Option<String>>,
    last_error: Mutex<Option<String>>,
    last_backup_file: Mutex<Option<String>>,
    last_failure_attempt_at: Mutex<Option<DateTime<Utc>>>,
}

static RUNTIME_STATE: Lazy<DatabaseBackupRuntimeState> = Lazy::new(|| DatabaseBackupRuntimeState {
    is_running: AtomicBool::new(false),
    was_cancelled: AtomicBool::new(false),
    last_run_at: Mutex::new(None),
    last_successful_run_at: Mutex::new(None),
    last_outcome: Mutex::new(None),
    last_error: Mutex::new(None),
    last_backup_file: Mutex::new(None),
    last_failure_attempt_at: Mutex::new(None),
});

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseBackupStatus {
    pub last_run_at: Option<String>,
    pub last_successful_run_at: Option<String>,
    pub last_outcome: Option<String>,
    pub last_error: Option<String>,
    pub last_backup_file: Option<String>,
    pub next_run_at: Option<String>,
    pub is_running: bool,
}

// ---------- Execution ----------

/// Holds the "a backup is running" flag for as long as it lives. Dropping it
/// (normal return, error, or the run's future being dropped) clears the flag.
pub(crate) struct RunGuard<'a>(&'a AtomicBool);

impl<'a> RunGuard<'a> {
    /// Takes the flag, or returns `None` when another run already holds it.
    pub(crate) fn acquire(flag: &'a AtomicBool) -> Option<Self> {
        if flag.swap(true, Ordering::SeqCst) {
            None
        } else {
            Some(Self(flag))
        }
    }
}

impl Drop for RunGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

pub(crate) const ALREADY_RUNNING: &str = "A database backup is already in progress";

/// Runs `run` unless another run holds `flag`, so a plan never runs
/// concurrently with itself.
pub(crate) async fn run_exclusive<T, F>(
    flag: &AtomicBool,
    run: impl FnOnce() -> F,
) -> Result<T, String>
where
    F: Future<Output = Result<T, String>>,
{
    let Some(_guard) = RunGuard::acquire(flag) else {
        return Err(ALREADY_RUNNING.into());
    };
    run().await
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BackupOutcome {
    Success,
    Error,
    Cancelled,
}

impl BackupOutcome {
    fn as_str(self) -> &'static str {
        match self {
            BackupOutcome::Success => "success",
            BackupOutcome::Error => "error",
            BackupOutcome::Cancelled => "cancelled",
        }
    }
}

#[derive(Debug)]
pub(crate) struct BackupRunReport {
    pub outcome: BackupOutcome,
    /// The written backup on success.
    pub file: Option<String>,
    pub error: Option<String>,
    pub pruned: Vec<String>,
}

/// One backup attempt into `dest_dir`: runs `dump` with the target file path,
/// then prunes old backups on success, or deletes the partial file on failure
/// so previous backups are never touched. A failure counts as a cancellation
/// when the dump reports [`DUMP_CANCELLED`] or `cancel_requested` was set.
pub(crate) async fn execute_backup<F>(
    dest_dir: &Path,
    plan: &DatabaseBackupPlan,
    now_utc: DateTime<Utc>,
    cancel_requested: &AtomicBool,
    dump: impl FnOnce(String) -> F,
) -> BackupRunReport
where
    F: Future<Output = Result<(), String>>,
{
    let failed = |outcome, error: String| BackupRunReport {
        outcome,
        file: None,
        error: Some(error),
        pruned: Vec::new(),
    };

    if let Err(e) = fs::create_dir_all(dest_dir) {
        return failed(
            BackupOutcome::Error,
            format!("Failed to create destination directory: {e}"),
        );
    }

    let file_name = backup_file_name(
        &plan.connection_id,
        plan.database.as_deref(),
        now_utc.naive_utc(),
    );
    let target_path = dest_dir.join(&file_name);
    let target = target_path.display().to_string();

    match dump(target.clone()).await {
        Ok(()) => {
            let retention = if plan.retention > 0 {
                plan.retention as usize
            } else {
                7
            };
            let to_prune = select_backups_to_prune(
                &list_directory_files(dest_dir),
                &plan.connection_id,
                plan.database.as_deref(),
                retention,
            );
            let mut pruned = Vec::new();
            for old_file in to_prune {
                match fs::remove_file(dest_dir.join(&old_file)) {
                    Ok(()) => {
                        log::info!("Pruned old database backup '{old_file}'");
                        pruned.push(old_file);
                    }
                    Err(e) => log::warn!("Failed to rotate old database backup '{old_file}': {e}"),
                }
            }
            BackupRunReport {
                outcome: BackupOutcome::Success,
                file: Some(target),
                error: None,
                pruned,
            }
        }
        Err(err) => {
            if target_path.exists() {
                let _ = fs::remove_file(&target_path);
            }
            let outcome = if err == DUMP_CANCELLED || cancel_requested.load(Ordering::SeqCst) {
                BackupOutcome::Cancelled
            } else {
                BackupOutcome::Error
            };
            failed(outcome, err)
        }
    }
}

fn record_report(report: &BackupRunReport, finished_at: DateTime<Utc>) {
    let finished_iso = finished_at.to_rfc3339();
    *RUNTIME_STATE.last_run_at.lock().unwrap() = Some(finished_iso.clone());
    *RUNTIME_STATE.last_outcome.lock().unwrap() = Some(report.outcome.as_str().to_string());
    *RUNTIME_STATE.last_error.lock().unwrap() = report.error.clone();
    if report.outcome == BackupOutcome::Success {
        *RUNTIME_STATE.last_successful_run_at.lock().unwrap() = Some(finished_iso);
        *RUNTIME_STATE.last_backup_file.lock().unwrap() = report.file.clone();
        *RUNTIME_STATE.last_failure_attempt_at.lock().unwrap() = None;
    } else {
        // last_successful_run_at is kept so the previous good run still counts.
        *RUNTIME_STATE.last_failure_attempt_at.lock().unwrap() = Some(finished_at);
    }
}

pub async fn run_database_backup<R: Runtime>(
    app: AppHandle<R>,
    trigger: &str,
) -> Result<String, String> {
    run_exclusive(&RUNTIME_STATE.is_running, || async {
        RUNTIME_STATE.was_cancelled.store(false, Ordering::SeqCst);

        let config = crate::config::load_config_internal(&app);
        let plan = config
            .database_backup_plan
            .clone()
            .ok_or_else(|| "No database backup plan configured".to_string())?;

        if plan.destination_directory.trim().is_empty() {
            return Err("Destination directory is not configured".into());
        }
        let dest_dir = PathBuf::from(&plan.destination_directory);

        let cancellation_state = app.state::<DumpCancellationState>();
        let options = DumpOptions {
            structure: plan.include_structure,
            data: plan.include_data,
            tables: plan.tables.clone(),
        };

        log::info!(
            "Starting database backup ({trigger}) for connection '{}' into '{}'",
            plan.connection_id,
            dest_dir.display()
        );

        let report = execute_backup(
            &dest_dir,
            &plan,
            Utc::now(),
            &RUNTIME_STATE.was_cancelled,
            |target| {
                dump_database_with_handles(
                    &app,
                    &cancellation_state.handles,
                    db_backup_slot_key(&plan.connection_id),
                    plan.connection_id.clone(),
                    target,
                    options,
                    plan.schema.clone(),
                    plan.database.clone(),
                )
            },
        )
        .await;

        record_report(&report, Utc::now());

        match (report.outcome, report.file) {
            (BackupOutcome::Success, Some(file)) => {
                log::info!(
                    "Database backup completed successfully: {file} ({} old backup(s) pruned)",
                    report.pruned.len()
                );
                Ok(file)
            }
            _ => {
                let err = report.error.unwrap_or_default();
                log::warn!("Database backup ({trigger}) failed: {err}");
                Err(err)
            }
        }
    })
    .await
}

// ---------- Background scheduler ----------

pub fn spawn_database_backup_scheduler(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // App-open boundary: scheduler runs every 30 seconds while Tabularis is open
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(30)).await;

            let config = crate::config::load_config_internal(&app);
            let Some(plan) = config.database_backup_plan else {
                continue;
            };

            if !plan.enabled
                || plan.connection_id.trim().is_empty()
                || plan.destination_directory.trim().is_empty()
            {
                continue;
            }

            let now_utc = Utc::now();

            // Populate last_successful_run_at from disk if not yet loaded in memory
            let last_success_utc = {
                let mut guard = RUNTIME_STATE.last_successful_run_at.lock().unwrap();
                if guard.is_none() {
                    let dest_path = Path::new(&plan.destination_directory);
                    if let Some((file_name, ts)) =
                        find_newest_backup(dest_path, &plan.connection_id, plan.database.as_deref())
                    {
                        let dt_utc = DateTime::<Utc>::from_naive_utc_and_offset(ts, Utc);
                        *guard = Some(dt_utc.to_rfc3339());
                        let mut file_guard = RUNTIME_STATE.last_backup_file.lock().unwrap();
                        if file_guard.is_none() {
                            *file_guard = Some(dest_path.join(file_name).display().to_string());
                        }
                    }
                }
                guard
                    .as_deref()
                    .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                    .map(|dt| dt.with_timezone(&Utc))
            };

            // Don't hammer the database if an attempt failed recently.
            let last_failure = *RUNTIME_STATE.last_failure_attempt_at.lock().unwrap();
            let recently_failed = is_retry_blocked(now_utc, last_failure);

            if is_backup_due(now_utc, &plan.time, &plan.timezone, last_success_utc)
                && !recently_failed
                && !RUNTIME_STATE.is_running.load(Ordering::SeqCst)
            {
                let app_clone = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = run_database_backup(app_clone, "scheduled").await;
                });
            }
        }
    });
}

// ---------- Tauri commands ----------

#[tauri::command]
pub async fn get_database_backup_status<R: Runtime>(
    app: AppHandle<R>,
) -> Result<DatabaseBackupStatus, String> {
    let config = crate::config::load_config_internal(&app);
    let plan = config.database_backup_plan;

    let now_utc = Utc::now();

    // Check disk on first query if last_successful_run_at is empty
    if let Some(ref p) = plan {
        let mut guard = RUNTIME_STATE.last_successful_run_at.lock().unwrap();
        if guard.is_none() && !p.destination_directory.trim().is_empty() {
            let dest_path = Path::new(&p.destination_directory);
            if let Some((file_name, ts)) =
                find_newest_backup(dest_path, &p.connection_id, p.database.as_deref())
            {
                let dt_utc = DateTime::<Utc>::from_naive_utc_and_offset(ts, Utc);
                *guard = Some(dt_utc.to_rfc3339());
                let mut file_guard = RUNTIME_STATE.last_backup_file.lock().unwrap();
                if file_guard.is_none() {
                    *file_guard = Some(dest_path.join(file_name).display().to_string());
                }
            }
        }
    }

    let last_run_at = RUNTIME_STATE.last_run_at.lock().unwrap().clone();
    let last_successful_run_at = RUNTIME_STATE.last_successful_run_at.lock().unwrap().clone();
    let last_outcome = RUNTIME_STATE.last_outcome.lock().unwrap().clone();
    let last_error = RUNTIME_STATE.last_error.lock().unwrap().clone();
    let last_backup_file = RUNTIME_STATE.last_backup_file.lock().unwrap().clone();
    let is_running = RUNTIME_STATE.is_running.load(Ordering::SeqCst);

    let next_run_at = if let Some(p) = plan.filter(|p| p.enabled && !p.connection_id.is_empty()) {
        let last_success_utc = last_successful_run_at
            .as_deref()
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.with_timezone(&Utc));
        let last_failure = *RUNTIME_STATE.last_failure_attempt_at.lock().unwrap();
        let next_utc = next_attempt_utc(
            now_utc,
            &p.time,
            &p.timezone,
            last_success_utc,
            last_failure,
        );
        Some(next_utc.to_rfc3339())
    } else {
        None
    };

    Ok(DatabaseBackupStatus {
        last_run_at,
        last_successful_run_at,
        last_outcome,
        last_error,
        last_backup_file,
        next_run_at,
        is_running,
    })
}

#[tauri::command]
pub async fn run_database_backup_now<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    run_database_backup(app, "manual").await
}

#[tauri::command]
pub async fn cancel_database_backup(
    state: tauri::State<'_, DumpCancellationState>,
    connection_id: String,
) -> Result<(), String> {
    if !abort_slot(&state.handles, &db_backup_slot_key(&connection_id)) {
        return Err("No active database backup process found to cancel".into());
    }
    RUNTIME_STATE.was_cancelled.store(true, Ordering::SeqCst);
    // is_running stays set: the run's RunGuard clears it once the aborted
    // dump has been cleaned up.
    Ok(())
}
