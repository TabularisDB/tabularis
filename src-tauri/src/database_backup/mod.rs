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
    last_run_at: Mutex<Option<String>>,
    last_outcome: Mutex<Option<String>>,
    last_error: Mutex<Option<String>>,
    last_backup_file: Mutex<Option<String>>,
}

static RUNTIME_STATE: Lazy<DatabaseBackupRuntimeState> = Lazy::new(|| DatabaseBackupRuntimeState {
    is_running: AtomicBool::new(false),
    last_run_at: Mutex::new(None),
    last_outcome: Mutex::new(None),
    last_error: Mutex::new(None),
    last_backup_file: Mutex::new(None),
});

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseBackupStatus {
    pub last_run_at: Option<String>,
    pub last_outcome: Option<String>,
    pub last_error: Option<String>,
    pub last_backup_file: Option<String>,
    pub next_run_at: Option<String>,
    pub is_running: bool,
}

// ---------- Pure helpers (tested in tests.rs) ----------

pub fn sanitize_component(s: &str) -> String {
    let sanitized: String = s
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
        .collect();
    let trimmed = sanitized.trim_matches('_');
    if trimmed.is_empty() {
        "default".to_string()
    } else {
        trimmed.to_string()
    }
}

pub fn plan_file_prefix(connection_id: &str, database: Option<&str>) -> String {
    let safe_conn = sanitize_component(connection_id);
    if let Some(db) = database.filter(|d| !d.is_empty()) {
        let safe_db = sanitize_component(db);
        format!("{FILE_PREFIX}{safe_conn}-{safe_db}-")
    } else {
        format!("{FILE_PREFIX}{safe_conn}-")
    }
}

pub fn backup_file_name(connection_id: &str, database: Option<&str>, now: NaiveDateTime) -> String {
    let prefix = plan_file_prefix(connection_id, database);
    format!("{}{}{FILE_SUFFIX}", prefix, now.format(TIMESTAMP_FORMAT))
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

pub fn resolve_tz(tz_str: &str) -> Tz {
    if tz_str.eq_ignore_ascii_case("local") || tz_str.trim().is_empty() {
        // Fall back to UTC for standard server-side evaluation when unspecified
        Tz::UTC
    } else {
        Tz::from_str(tz_str).unwrap_or(Tz::UTC)
    }
}

pub fn compute_next_run_utc(
    now_utc: DateTime<Utc>,
    time_str: &str,
    timezone_str: &str,
    last_run_at: Option<DateTime<Utc>>,
) -> DateTime<Utc> {
    let tz = resolve_tz(timezone_str);
    let now_tz = now_utc.with_timezone(&tz);

    let (target_hour, target_minute) = parse_time_hh_mm(time_str).unwrap_or((2, 0));

    let today_date = now_tz.date_naive();
    let today_target_naive = today_date.and_hms_opt(target_hour, target_minute, 0)
        .unwrap_or_else(|| today_date.and_hms_opt(0, 0, 0).unwrap());

    // Map naive date-time to timezone handling DST gaps and folds
    let today_target_tz = match tz.from_local_datetime(&today_target_naive) {
        chrono::LocalResult::Single(dt) => dt,
        chrono::LocalResult::Ambiguous(earliest, _) => earliest,
        chrono::LocalResult::None => {
            // Spring-forward gap: push ahead 1 hour
            tz.from_local_datetime(&(today_target_naive + Duration::hours(1)))
                .single()
                .unwrap_or(now_tz)
        }
    };
    let today_target_utc = today_target_tz.with_timezone(&Utc);

    let already_run_today = if let Some(last_run) = last_run_at {
        let last_tz = last_run.with_timezone(&tz);
        last_tz.date_naive() == today_date
    } else {
        false
    };

    if now_utc < today_target_utc && !already_run_today {
        today_target_utc
    } else {
        let tomorrow_date = today_date + Duration::days(1);
        let tomorrow_target_naive = tomorrow_date.and_hms_opt(target_hour, target_minute, 0)
            .unwrap_or_else(|| tomorrow_date.and_hms_opt(0, 0, 0).unwrap());
        let tomorrow_target_tz = match tz.from_local_datetime(&tomorrow_target_naive) {
            chrono::LocalResult::Single(dt) => dt,
            chrono::LocalResult::Ambiguous(earliest, _) => earliest,
            chrono::LocalResult::None => {
                tz.from_local_datetime(&(tomorrow_target_naive + Duration::hours(1)))
                    .single()
                    .unwrap_or_else(|| now_tz + Duration::days(1))
            }
        };
        tomorrow_target_tz.with_timezone(&Utc)
    }
}

pub fn is_backup_due(now_utc: DateTime<Utc>, next_run_utc: DateTime<Utc>) -> bool {
    now_utc >= next_run_utc
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

    let now_naive = chrono::Local::now().naive_local();
    let file_name = backup_file_name(&plan.connection_id, plan.database.as_deref(), now_naive);
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

            *RUNTIME_STATE.last_run_at.lock().unwrap() = Some(now_iso);
            *RUNTIME_STATE.last_outcome.lock().unwrap() = Some("success".to_string());
            *RUNTIME_STATE.last_error.lock().unwrap() = None;
            *RUNTIME_STATE.last_backup_file.lock().unwrap() = Some(target_file_str.clone());

            log::info!("Database backup completed successfully: {target_file_str}");
            Ok(target_file_str)
        }
        Err(err) => {
            // Clean up partial or empty file if it exists so disk is not corrupted
            if target_file_path.exists() {
                let _ = fs::remove_file(&target_file_path);
            }

            let outcome = if err.contains("cancelled") || err.contains("Cancelled") {
                "cancelled"
            } else {
                "error"
            };

            *RUNTIME_STATE.last_run_at.lock().unwrap() = Some(now_iso);
            *RUNTIME_STATE.last_outcome.lock().unwrap() = Some(outcome.to_string());
            *RUNTIME_STATE.last_error.lock().unwrap() = Some(err.clone());

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
            let last_run_utc = RUNTIME_STATE
                .last_run_at
                .lock()
                .unwrap()
                .as_deref()
                .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                .map(|dt| dt.with_timezone(&Utc));

            let next_run_utc = compute_next_run_utc(now_utc, &plan.time, &plan.timezone, last_run_utc);

            if is_backup_due(now_utc, next_run_utc) && !RUNTIME_STATE.is_running.load(Ordering::SeqCst) {
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
    let last_run_at = RUNTIME_STATE.last_run_at.lock().unwrap().clone();
    let last_outcome = RUNTIME_STATE.last_outcome.lock().unwrap().clone();
    let last_error = RUNTIME_STATE.last_error.lock().unwrap().clone();
    let last_backup_file = RUNTIME_STATE.last_backup_file.lock().unwrap().clone();
    let is_running = RUNTIME_STATE.is_running.load(Ordering::SeqCst);

    let next_run_at = if let Some(p) = plan.filter(|p| p.enabled && !p.connection_id.is_empty()) {
        let last_utc = last_run_at
            .as_deref()
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.with_timezone(&Utc));
        let next_utc = compute_next_run_utc(now_utc, &p.time, &p.timezone, last_utc);
        Some(next_utc.to_rfc3339())
    } else {
        None
    };

    Ok(DatabaseBackupStatus {
        last_run_at,
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
    RUNTIME_STATE.is_running.store(false, Ordering::SeqCst);
    Ok(())
}
