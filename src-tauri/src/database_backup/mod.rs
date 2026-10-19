//! Scheduled database content backups (Milestone 1).
//!
//! Manages daily scheduled backups of database contents while the app is open
//! (app-open execution boundary). Uses the dump pipeline (`dump_commands`),
//! respects IANA timezone boundaries, enforces strict non-concurrency,
//! and prunes oldest successful backups without ever touching good backups
//! upon failure.

use chrono::{DateTime, Datelike, Duration, NaiveDate, NaiveDateTime, TimeZone, Timelike, Utc};
use chrono_tz::Tz;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime};

use crate::config::DatabaseBackupPlan;
use crate::dump_commands::{db_backup_slot_key, dump_database_with_handles, DumpCancellationState, DumpOptions};

#[cfg(test)]
mod tests;

pub const FILE_PREFIX: &str = "tabularis-db-backup-";
pub const FILE_SUFFIX: &str = ".sql";
pub const TIMESTAMP_FORMAT: &str = "%Y%m%d-%H%M%S";

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

// ---------- Pure helpers (tested in tests.rs) ----------

/// Sanitizes a string into safe alphanumeric characters with underscores.
/// Hyphens and punctuation are collapsed into single underscores to avoid
/// delimiter ambiguities with the `--` component separator.
pub fn sanitize_component(s: &str) -> String {
    let sanitized: String = s
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    let trimmed = sanitized.trim_matches('_');
    if trimmed.is_empty() {
        "default".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Computes the unique file prefix for a specific plan's connection and database.
/// Uses `--` delimiters so that a plan with no database (`--_all_--`) or a connection ID
/// that is a prefix of another connection can never match or prune another plan's backups.
pub fn plan_file_prefix(connection_id: &str, database: Option<&str>) -> String {
    let safe_conn = sanitize_component(connection_id);
    let safe_db = database
        .map(|d| d.trim())
        .filter(|d| !d.is_empty())
        .map(sanitize_component)
        .unwrap_or_else(|| "_all_".to_string());
    format!("{FILE_PREFIX}{safe_conn}--{safe_db}--")
}

pub fn backup_file_name(connection_id: &str, database: Option<&str>, now_utc: NaiveDateTime) -> String {
    let prefix = plan_file_prefix(connection_id, database);
    format!("{}{}{FILE_SUFFIX}", prefix, now_utc.format(TIMESTAMP_FORMAT))
}

pub fn parse_backup_timestamp(file_name: &str) -> Option<NaiveDateTime> {
    if !file_name.starts_with(FILE_PREFIX) || !file_name.ends_with(FILE_SUFFIX) {
        return None;
    }
    let stem = file_name
        .strip_prefix(FILE_PREFIX)?
        .strip_suffix(FILE_SUFFIX)?;
    if stem.len() < 15 {
        return None;
    }
    let stamp_str = &stem[stem.len() - 15..];
    NaiveDateTime::parse_from_str(stamp_str, TIMESTAMP_FORMAT).ok()
}

pub fn select_backups_to_prune(
    names: &[String],
    connection_id: &str,
    database: Option<&str>,
    retention: usize,
) -> Vec<String> {
    if retention == 0 {
        return Vec::new();
    }
    let prefix = plan_file_prefix(connection_id, database);
    let mut matching: Vec<(&String, NaiveDateTime)> = names
        .iter()
        .filter(|n| n.starts_with(&prefix) && n.ends_with(FILE_SUFFIX))
        .filter_map(|n| parse_backup_timestamp(n).map(|ts| (n, ts)))
        .collect();

    matching.sort_by_key(|(_, ts)| *ts);

    if matching.len() <= retention {
        return Vec::new();
    }

    let excess = matching.len() - retention;
    matching[..excess].iter().map(|(n, _)| (*n).clone()).collect()
}

pub fn parse_time_hh_mm(s: &str) -> Option<(u32, u32)> {
    let mut parts = s.split(':');
    let h: u32 = parts.next()?.parse().ok()?;
    let m: u32 = parts.next()?.parse().ok()?;
    if h < 24 && m < 60 {
        Some((h, m))
    } else {
        None
    }
}

/// Evaluates plan scheduling in either the local OS timezone or an IANA named timezone.
#[derive(Debug, Clone, Copy)]
pub enum PlanTimezone {
    Local,
    Named(Tz),
}

impl PlanTimezone {
    pub fn parse(tz_str: &str) -> Self {
        if tz_str.eq_ignore_ascii_case("local") || tz_str.trim().is_empty() {
            PlanTimezone::Local
        } else {
            match Tz::from_str(tz_str.trim()) {
                Ok(tz) => PlanTimezone::Named(tz),
                Err(_) => {
                    log::warn!("Invalid timezone '{tz_str}', falling back to local system timezone");
                    PlanTimezone::Local
                }
            }
        }
    }

    pub fn current_date(&self, now_utc: DateTime<Utc>) -> NaiveDate {
        match self {
            PlanTimezone::Local => now_utc.with_timezone(&chrono::Local).date_naive(),
            PlanTimezone::Named(tz) => now_utc.with_timezone(tz).date_naive(),
        }
    }

    pub fn date_of(&self, dt_utc: DateTime<Utc>) -> NaiveDate {
        match self {
            PlanTimezone::Local => dt_utc.with_timezone(&chrono::Local).date_naive(),
            PlanTimezone::Named(tz) => dt_utc.with_timezone(tz).date_naive(),
        }
    }

    pub fn target_utc(&self, date: NaiveDate, hour: u32, minute: u32) -> Option<DateTime<Utc>> {
        let naive = date.and_hms_opt(hour, minute, 0)?;
        match self {
            PlanTimezone::Local => match chrono::Local.from_local_datetime(&naive) {
                chrono::LocalResult::Single(dt) => Some(dt.with_timezone(&Utc)),
                chrono::LocalResult::Ambiguous(earliest, _) => Some(earliest.with_timezone(&Utc)),
                chrono::LocalResult::None => chrono::Local
                    .from_local_datetime(&(naive + Duration::hours(1)))
                    .single()
                    .map(|dt| dt.with_timezone(&Utc)),
            },
            PlanTimezone::Named(tz) => match tz.from_local_datetime(&naive) {
                chrono::LocalResult::Single(dt) => Some(dt.with_timezone(&Utc)),
                chrono::LocalResult::Ambiguous(earliest, _) => Some(earliest.with_timezone(&Utc)),
                chrono::LocalResult::None => tz
                    .from_local_datetime(&(naive + Duration::hours(1)))
                    .single()
                    .map(|dt| dt.with_timezone(&Utc)),
            },
        }
    }
}

pub fn resolve_tz(tz_str: &str) -> Tz {
    if tz_str.eq_ignore_ascii_case("local") || tz_str.trim().is_empty() {
        Tz::UTC
    } else {
        Tz::from_str(tz_str).unwrap_or(Tz::UTC)
    }
}

/// Checks if a daily backup is currently due.
/// A backup is due when:
/// 1. The current time is at or past today's target time in the plan's timezone, AND
/// 2. No successful backup has already run today in that timezone.
pub fn is_backup_due(
    now_utc: DateTime<Utc>,
    time_str: &str,
    timezone_str: &str,
    last_successful_run_at: Option<DateTime<Utc>>,
) -> bool {
    let ptz = PlanTimezone::parse(timezone_str);
    let (target_h, target_m) = parse_time_hh_mm(time_str).unwrap_or((2, 0));
    let today_date = ptz.current_date(now_utc);
    let Some(today_target_utc) = ptz.target_utc(today_date, target_h, target_m) else {
        return false;
    };

    if now_utc < today_target_utc {
        return false;
    }

    if let Some(last_success) = last_successful_run_at {
        if ptz.date_of(last_success) == today_date {
            return false;
        }
    }

    true
}

/// Computes the next scheduled run instant in UTC for display and status reporting.
pub fn compute_next_run_utc(
    now_utc: DateTime<Utc>,
    time_str: &str,
    timezone_str: &str,
    last_successful_run_at: Option<DateTime<Utc>>,
) -> DateTime<Utc> {
    let ptz = PlanTimezone::parse(timezone_str);
    let (target_h, target_m) = parse_time_hh_mm(time_str).unwrap_or((2, 0));
    let today_date = ptz.current_date(now_utc);
    let today_target_utc = ptz
        .target_utc(today_date, target_h, target_m)
        .unwrap_or(now_utc);

    let already_ran_today = match last_successful_run_at {
        Some(last_success) => ptz.date_of(last_success) == today_date,
        None => false,
    };

    if !already_ran_today && now_utc < today_target_utc {
        today_target_utc
    } else {
        let tomorrow_date = today_date + Duration::days(1);
        ptz.target_utc(tomorrow_date, target_h, target_m)
            .unwrap_or_else(|| today_target_utc + Duration::days(1))
    }
}

fn list_directory_files(dir: &Path) -> Vec<String> {
    fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter_map(|e| e.file_name().into_string().ok())
                .collect()
        })
        .unwrap_or_default()
}

/// Finds the newest existing backup on disk matching the plan's prefix.
pub fn find_newest_backup(dest_dir: &Path, connection_id: &str, database: Option<&str>) -> Option<(String, NaiveDateTime)> {
    let prefix = plan_file_prefix(connection_id, database);
    let files = list_directory_files(dest_dir);
    let mut matching: Vec<(String, NaiveDateTime)> = files
        .into_iter()
        .filter(|n| n.starts_with(&prefix) && n.ends_with(FILE_SUFFIX))
        .filter_map(|n| parse_backup_timestamp(&n).map(|ts| (n, ts)))
        .collect();

    matching.sort_by_key(|(_, ts)| *ts);
    matching.pop()
}

// ---------- Execution ----------

pub async fn run_database_backup<R: Runtime>(
    app: AppHandle<R>,
    trigger: &str,
) -> Result<String, String> {
    // Concurrency guard: Ensure a plan cannot run concurrently with itself
    if RUNTIME_STATE.is_running.swap(true, Ordering::SeqCst) {
        return Err("A database backup is already in progress".into());
    }

    struct Guard;
    impl Drop for Guard {
        fn drop(&mut self) {
            RUNTIME_STATE.is_running.store(false, Ordering::SeqCst);
        }
    }
    let _guard = Guard;

    // Reset cancellation state before new run
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
    if !dest_dir.exists() {
        fs::create_dir_all(&dest_dir)
            .map_err(|e| format!("Failed to create destination directory: {e}"))?;
    }

    // Unambiguous UTC timestamp across DST folds
    let now_utc = Utc::now();
    let file_name = backup_file_name(&plan.connection_id, plan.database.as_deref(), now_utc.naive_utc());
    let target_file_path = dest_dir.join(&file_name);
    let target_file_str = target_file_path.display().to_string();

    let cancellation_state = app.state::<DumpCancellationState>();
    let slot_key = db_backup_slot_key(&plan.connection_id);

    let options = DumpOptions {
        structure: plan.include_structure,
        data: plan.include_data,
        tables: plan.tables.clone(),
    };

    log::info!(
        "Starting scheduled database backup ({trigger}) for connection '{}' to '{}'",
        plan.connection_id,
        target_file_str
    );

    let dump_result = dump_database_with_handles(
        &app,
        &cancellation_state.handles,
        slot_key,
        plan.connection_id.clone(),
        target_file_str.clone(),
        options,
        plan.schema.clone(),
        plan.database.clone(),
    )
    .await;

    let now_iso = Utc::now().to_rfc3339();

    match dump_result {
        Ok(()) => {
            // Retention pruning: only happens after a successful dump.
            // Failed runs do NOT prune the last good one.
            let retention = if plan.retention > 0 { plan.retention as usize } else { 7 };
            let existing_files = list_directory_files(&dest_dir);
            let to_prune = select_backups_to_prune(
                &existing_files,
                &plan.connection_id,
                plan.database.as_deref(),
                retention,
            );

            for old_file in to_prune {
                let old_path = dest_dir.join(&old_file);
                if let Err(e) = fs::remove_file(&old_path) {
                    log::warn!("Failed to rotate old database backup '{old_file}': {e}");
                } else {
                    log::info!("Pruned old database backup '{old_file}'");
                }
            }

            *RUNTIME_STATE.last_run_at.lock().unwrap() = Some(now_iso.clone());
            *RUNTIME_STATE.last_successful_run_at.lock().unwrap() = Some(now_iso);
            *RUNTIME_STATE.last_outcome.lock().unwrap() = Some("success".to_string());
            *RUNTIME_STATE.last_error.lock().unwrap() = None;
            *RUNTIME_STATE.last_backup_file.lock().unwrap() = Some(target_file_str.clone());
            *RUNTIME_STATE.last_failure_attempt_at.lock().unwrap() = None;

            log::info!("Database backup completed successfully: {target_file_str}");
            Ok(target_file_str)
        }
        Err(err) => {
            // Clean up partial or empty file if it exists so disk is not corrupted
            if target_file_path.exists() {
                let _ = fs::remove_file(&target_file_path);
            }

            let was_cancelled = RUNTIME_STATE.was_cancelled.load(Ordering::SeqCst) || err == "Dump cancelled";
            let outcome = if was_cancelled {
                "cancelled"
            } else {
                "error"
            };

            *RUNTIME_STATE.last_run_at.lock().unwrap() = Some(now_iso);
            // Notice: last_successful_run_at is NOT touched on failure so the previous successful run is retained
            *RUNTIME_STATE.last_outcome.lock().unwrap() = Some(outcome.to_string());
            *RUNTIME_STATE.last_error.lock().unwrap() = Some(err.clone());
            *RUNTIME_STATE.last_failure_attempt_at.lock().unwrap() = Some(Utc::now());

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

            if !plan.enabled || plan.connection_id.trim().is_empty() || plan.destination_directory.trim().is_empty() {
                continue;
            }

            let now_utc = Utc::now();

            // Populate last_successful_run_at from disk if not yet loaded in memory
            let last_success_utc = {
                let mut guard = RUNTIME_STATE.last_successful_run_at.lock().unwrap();
                if guard.is_none() {
                    let dest_path = Path::new(&plan.destination_directory);
                    if let Some((file_name, ts)) = find_newest_backup(dest_path, &plan.connection_id, plan.database.as_deref()) {
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

            // Don't hammer the database if an attempt failed recently (back off for 15 minutes)
            let recently_failed = RUNTIME_STATE
                .last_failure_attempt_at
                .lock()
                .unwrap()
                .map(|t| now_utc.signed_duration_since(t) < Duration::minutes(15))
                .unwrap_or(false);

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
            if let Some((file_name, ts)) = find_newest_backup(dest_path, &p.connection_id, p.database.as_deref()) {
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
        let next_utc = compute_next_run_utc(now_utc, &p.time, &p.timezone, last_success_utc);
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
    RUNTIME_STATE.was_cancelled.store(true, Ordering::SeqCst);
    let slot_key = db_backup_slot_key(&connection_id);
    let entries = {
        let mut handles = state.handles.lock().unwrap();
        handles.remove(&slot_key).unwrap_or_default()
    };
    if entries.is_empty() {
        return Err("No active database backup process found to cancel".into());
    }
    for handle in entries {
        handle.abort();
    }
    // Note: Do NOT reset RUNTIME_STATE.is_running here. The RAII Guard inside
    // run_database_backup will automatically clear is_running when the aborted task cleans up.
    Ok(())
}
