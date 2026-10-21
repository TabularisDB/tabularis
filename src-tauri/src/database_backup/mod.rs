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
    DumpRequest, DUMP_CANCELLED,
};

// ---------- Runtime state & lock ----------

/// A value recorded for one plan, keyed by [`plan_key`], so it stops counting
/// once the plan's connection, database or destination changes.
type PlanEntry<T> = Mutex<Option<(String, T)>>;

struct DatabaseBackupRuntimeState {
    is_running: AtomicBool,
    /// Set by `cancel_database_backup` during a run, cleared when it ends.
    was_cancelled: AtomicBool,
    /// Cancellation slot of the run in progress, so a cancel reaches it even
    /// when the plan was edited in the meantime.
    active_slot: Mutex<Option<String>>,
    last_run_at: Mutex<Option<String>>,
    last_outcome: Mutex<Option<String>>,
    last_error: Mutex<Option<String>>,
    /// Finish time and file of the last successful run in this session.
    last_success: PlanEntry<(DateTime<Utc>, String)>,
    last_failure_attempt_at: PlanEntry<DateTime<Utc>>,
    last_cancelled_at: PlanEntry<DateTime<Utc>>,
}

static RUNTIME_STATE: Lazy<DatabaseBackupRuntimeState> = Lazy::new(|| DatabaseBackupRuntimeState {
    is_running: AtomicBool::new(false),
    was_cancelled: AtomicBool::new(false),
    active_slot: Mutex::new(None),
    last_run_at: Mutex::new(None),
    last_outcome: Mutex::new(None),
    last_error: Mutex::new(None),
    last_success: Mutex::new(None),
    last_failure_attempt_at: Mutex::new(None),
    last_cancelled_at: Mutex::new(None),
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

/// Identifies what a plan backs up and where. Runs recorded under another key
/// (another connection, database or destination) do not count for the plan.
pub(crate) fn plan_key(plan: &DatabaseBackupPlan) -> String {
    format!(
        "{}\n{}\n{}",
        plan.connection_id,
        plan.database.as_deref().unwrap_or(""),
        plan.destination_directory
    )
}

/// The value recorded in `entry` when it belongs to `key`.
pub(crate) fn entry_for<T: Clone>(entry: &Option<(String, T)>, key: &str) -> Option<T> {
    entry
        .as_ref()
        .filter(|(entry_key, _)| entry_key == key)
        .map(|(_, value)| value.clone())
}

/// The plan's newest successful backup: the later of `recorded` (this
/// session) and the newest matching file in its destination directory. The
/// directory is read on every call, so a changed destination or a backup
/// written by another session is picked up right away.
pub(crate) fn last_success_for(
    plan: &DatabaseBackupPlan,
    recorded: Option<(DateTime<Utc>, String)>,
) -> Option<(DateTime<Utc>, String)> {
    let on_disk = if plan.destination_directory.trim().is_empty() {
        None
    } else {
        let dest = Path::new(&plan.destination_directory);
        find_newest_backup(dest, &plan.connection_id, plan.database.as_deref()).map(
            |(file_name, ts)| {
                (
                    DateTime::<Utc>::from_naive_utc_and_offset(ts, Utc),
                    dest.join(file_name).display().to_string(),
                )
            },
        )
    };
    match (recorded, on_disk) {
        (Some(recorded), Some(on_disk)) => Some(if recorded.0 >= on_disk.0 {
            recorded
        } else {
            on_disk
        }),
        (recorded, on_disk) => recorded.or(on_disk),
    }
}

/// What the schedule of `plan` depends on.
struct ScheduleInputs {
    last_success: Option<(DateTime<Utc>, String)>,
    /// When today's slot was settled, see [`slot_settled_at`].
    settled_at: Option<DateTime<Utc>>,
    last_failure: Option<DateTime<Utc>>,
}

fn schedule_inputs(plan: &DatabaseBackupPlan) -> ScheduleInputs {
    let key = plan_key(plan);
    let last_success = last_success_for(
        plan,
        entry_for(&RUNTIME_STATE.last_success.lock().unwrap(), &key),
    );
    let cancelled = entry_for(&RUNTIME_STATE.last_cancelled_at.lock().unwrap(), &key);
    let settled_at = slot_settled_at(
        &plan.time,
        &plan.timezone,
        last_success.as_ref().map(|(at, _)| *at),
        cancelled,
    );
    let last_failure = entry_for(&RUNTIME_STATE.last_failure_attempt_at.lock().unwrap(), &key);
    ScheduleInputs {
        last_success,
        settled_at,
        last_failure,
    }
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

/// Records a finished run of the plan `key`. A cancellation is not a
/// failure: it settles the day's slot (see [`slot_settled_at`]) instead of
/// arming the retry delay, so a cancelled scheduled run stays cancelled.
fn record_report(key: &str, report: &BackupRunReport, finished_at: DateTime<Utc>) {
    *RUNTIME_STATE.last_run_at.lock().unwrap() = Some(finished_at.to_rfc3339());
    *RUNTIME_STATE.last_outcome.lock().unwrap() = Some(report.outcome.as_str().to_string());
    *RUNTIME_STATE.last_error.lock().unwrap() = report.error.clone();
    match report.outcome {
        BackupOutcome::Success => {
            let file = report.file.clone().unwrap_or_default();
            *RUNTIME_STATE.last_success.lock().unwrap() =
                Some((key.to_string(), (finished_at, file)));
            *RUNTIME_STATE.last_failure_attempt_at.lock().unwrap() = None;
        }
        BackupOutcome::Error => {
            // The previous successful run is kept, so it still counts.
            *RUNTIME_STATE.last_failure_attempt_at.lock().unwrap() =
                Some((key.to_string(), finished_at));
        }
        BackupOutcome::Cancelled => {
            *RUNTIME_STATE.last_cancelled_at.lock().unwrap() = Some((key.to_string(), finished_at));
        }
    }
}

pub async fn run_database_backup<R: Runtime>(
    app: AppHandle<R>,
    trigger: &str,
) -> Result<String, String> {
    run_exclusive(&RUNTIME_STATE.is_running, || async {
        let result = run_plan_once(&app, trigger).await;
        // Reset on every way out, so a cancel never leaks into the next run.
        *RUNTIME_STATE.active_slot.lock().unwrap() = None;
        RUNTIME_STATE.was_cancelled.store(false, Ordering::SeqCst);
        result
    })
    .await
}

async fn run_plan_once<R: Runtime>(app: &AppHandle<R>, trigger: &str) -> Result<String, String> {
    let config = crate::config::load_config_internal(app);
    let plan = config
        .database_backup_plan
        .clone()
        .ok_or_else(|| "No database backup plan configured".to_string())?;

    if plan.destination_directory.trim().is_empty() {
        return Err("Destination directory is not configured".into());
    }
    if !plan.include_structure && !plan.include_data {
        return Err("Select the structure, the data or both to back up".into());
    }
    let dest_dir = PathBuf::from(&plan.destination_directory);

    let cancellation_state = app.state::<DumpCancellationState>();
    let slot_key = db_backup_slot_key(&plan.connection_id);
    *RUNTIME_STATE.active_slot.lock().unwrap() = Some(slot_key.clone());
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
                app,
                &cancellation_state.handles,
                DumpRequest {
                    slot_key,
                    connection_id: plan.connection_id.clone(),
                    file_path: target,
                    options,
                    schema: plan.schema.clone(),
                    database: plan.database.clone(),
                },
                Some(&RUNTIME_STATE.was_cancelled),
            )
        },
    )
    .await;

    record_report(&plan_key(&plan), &report, Utc::now());

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
            let inputs = schedule_inputs(&plan);

            // Don't hammer the database if an attempt failed recently.
            let recently_failed = is_retry_blocked(now_utc, inputs.last_failure);

            if is_backup_due(now_utc, &plan.time, &plan.timezone, inputs.settled_at)
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
    let now_utc = Utc::now();

    // The last success and the next run always describe the current plan.
    let (last_successful_run_at, last_backup_file, next_run_at) = match config.database_backup_plan
    {
        Some(plan) => {
            let inputs = schedule_inputs(&plan);
            let next_run_at = (plan.enabled && !plan.connection_id.is_empty()).then(|| {
                next_attempt_utc(
                    now_utc,
                    &plan.time,
                    &plan.timezone,
                    inputs.settled_at,
                    inputs.last_failure,
                )
                .to_rfc3339()
            });
            let (at, file) = inputs.last_success.unzip();
            (at.map(|at| at.to_rfc3339()), file, next_run_at)
        }
        None => (None, None, None),
    };

    Ok(DatabaseBackupStatus {
        last_run_at: RUNTIME_STATE.last_run_at.lock().unwrap().clone(),
        last_successful_run_at,
        last_outcome: RUNTIME_STATE.last_outcome.lock().unwrap().clone(),
        last_error: RUNTIME_STATE.last_error.lock().unwrap().clone(),
        last_backup_file,
        next_run_at,
        is_running: RUNTIME_STATE.is_running.load(Ordering::SeqCst),
    })
}

#[tauri::command]
pub async fn run_database_backup_now<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    run_database_backup(app, "manual").await
}

/// Cancels the run in progress, whatever the plan says now. Before the dump
/// task exists (e.g. during the SSH/K8s setup) the flag alone stops it: the
/// dump checks it once the setup is done and again right after registering.
#[tauri::command]
pub async fn cancel_database_backup(
    state: tauri::State<'_, DumpCancellationState>,
) -> Result<(), String> {
    if !RUNTIME_STATE.is_running.load(Ordering::SeqCst) {
        return Err("No database backup is running".into());
    }
    RUNTIME_STATE.was_cancelled.store(true, Ordering::SeqCst);
    if let Some(slot) = RUNTIME_STATE.active_slot.lock().unwrap().clone() {
        abort_slot(&state.handles, &slot);
    }
    // is_running stays set: the run's RunGuard clears it once the aborted
    // dump has been cleaned up.
    Ok(())
}
