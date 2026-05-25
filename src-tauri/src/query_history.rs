use crate::config::load_config_internal;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Manager, Runtime, State};
use tokio::sync::Mutex;
use uuid::Uuid;

const DEFAULT_MAX_HISTORY_ENTRIES: u32 = 500;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct QueryHistoryEntry {
    pub id: String,
    pub sql: String,
    pub executed_at: String,
    pub execution_time_ms: Option<f64>,
    pub status: String,
    pub rows_affected: Option<i64>,
    pub error: Option<String>,
    #[serde(default)]
    pub database: Option<String>,
}

/// Response shape for `get_query_history`. `recovered_backup_path` is set
/// when the on-disk JSON could not be parsed and was renamed aside so the
/// app could start fresh; the UI surfaces a banner with the backup location
/// so the user can recover entries manually if needed.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct QueryHistoryResponse {
    pub entries: Vec<QueryHistoryEntry>,
    pub recovered_backup_path: Option<String>,
}

/// Serializes read-modify-write sequences against each connection's history
/// file so concurrent `addEntry` calls (e.g. one per statement in a
/// multi-statement batch) can't interleave and overwrite each other.
#[derive(Default)]
pub struct QueryHistoryState {
    locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

async fn acquire_lock(state: &QueryHistoryState, connection_id: &str) -> Arc<Mutex<()>> {
    let mut map = state.locks.lock().await;
    map.entry(connection_id.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

fn get_history_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let history_dir = config_dir.join("query_history");
    if !history_dir.exists() {
        fs::create_dir_all(&history_dir).map_err(|e| e.to_string())?;
    }
    Ok(history_dir)
}

fn get_history_path<R: Runtime>(
    app: &AppHandle<R>,
    connection_id: &str,
) -> Result<PathBuf, String> {
    let dir = get_history_dir(app)?;
    Ok(dir.join(format!("{}.json", connection_id)))
}

/// Read history, recovering from corruption by renaming the bad file aside.
///
/// Returns the parsed entries and, when recovery happened, the path of the
/// backup file. Callers that don't need to surface recovery info can use
/// the [`read_history`] wrapper.
fn read_history_with_recovery<R: Runtime>(
    app: &AppHandle<R>,
    connection_id: &str,
) -> Result<(Vec<QueryHistoryEntry>, Option<PathBuf>), String> {
    let path = get_history_path(app, connection_id)?;
    if !path.exists() {
        return Ok((Vec::new(), None));
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    match serde_json::from_str::<Vec<QueryHistoryEntry>>(&content) {
        Ok(entries) => Ok((entries, None)),
        Err(parse_err) => {
            let backup = backup_corrupt_file(&path).map_err(|e| {
                format!(
                    "Query history JSON parse failed and backup also failed: {} (parse error: {})",
                    e, parse_err
                )
            })?;
            log::warn!(
                "Query history file for connection '{}' was corrupt ({}); moved to {}",
                connection_id,
                parse_err,
                backup.display()
            );
            Ok((Vec::new(), Some(backup)))
        }
    }
}

fn read_history<R: Runtime>(
    app: &AppHandle<R>,
    connection_id: &str,
) -> Result<Vec<QueryHistoryEntry>, String> {
    read_history_with_recovery(app, connection_id).map(|(entries, _)| entries)
}

/// Rename a corrupt history file aside using a UTC timestamp suffix. If a
/// file already exists at the target backup path (unlikely but possible on
/// the same-millisecond retry) a short uuid suffix is appended.
pub(crate) fn backup_corrupt_file(path: &Path) -> Result<PathBuf, String> {
    let timestamp = chrono::Utc::now().format("%Y-%m-%dT%H-%M-%S%3f");
    let base = path.file_name().and_then(|n| n.to_str()).unwrap_or("history.json");
    let mut backup = path.with_file_name(format!("{}.corrupt-{}", base, timestamp));
    if backup.exists() {
        backup = path.with_file_name(format!(
            "{}.corrupt-{}-{}",
            base,
            timestamp,
            Uuid::new_v4().simple()
        ));
    }
    fs::rename(path, &backup).map_err(|e| e.to_string())?;
    Ok(backup)
}

/// Atomic write: serialise to a per-write temp file in the same directory,
/// then `rename` onto the target. `rename` within a filesystem is atomic on
/// POSIX/APFS, so a concurrent or crashed write can never leave the target
/// file half-written (which is the failure mode that produced the original
/// "extra data after array" corruption).
fn write_history<R: Runtime>(
    app: &AppHandle<R>,
    connection_id: &str,
    entries: &[QueryHistoryEntry],
) -> Result<(), String> {
    let path = get_history_path(app, connection_id)?;
    let content = serde_json::to_string_pretty(entries).map_err(|e| e.to_string())?;
    atomic_write(&path, content.as_bytes())
}

pub(crate) fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let dir = path.parent().ok_or_else(|| "history path has no parent".to_string())?;
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("history.json");
    let tmp = dir.join(format!(".{}.tmp.{}", file_name, Uuid::new_v4().simple()));
    if let Err(e) = fs::write(&tmp, bytes) {
        let _ = fs::remove_file(&tmp);
        return Err(e.to_string());
    }
    if let Err(e) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(e.to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn get_query_history<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, QueryHistoryState>,
    connection_id: String,
) -> Result<QueryHistoryResponse, String> {
    let lock = acquire_lock(&state, &connection_id).await;
    let _guard = lock.lock().await;
    let (entries, backup) = read_history_with_recovery(&app, &connection_id)?;
    Ok(QueryHistoryResponse {
        entries,
        recovered_backup_path: backup.map(|p| p.to_string_lossy().into_owned()),
    })
}

#[tauri::command]
pub async fn add_query_history_entry<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, QueryHistoryState>,
    connection_id: String,
    sql: String,
    executed_at: String,
    execution_time_ms: Option<f64>,
    status: String,
    rows_affected: Option<i64>,
    error: Option<String>,
    database: Option<String>,
) -> Result<QueryHistoryEntry, String> {
    let lock = acquire_lock(&state, &connection_id).await;
    let _guard = lock.lock().await;

    let mut entries = read_history(&app, &connection_id)?;

    let config = load_config_internal(&app);
    let max_entries = config
        .query_history_max_entries
        .unwrap_or(DEFAULT_MAX_HISTORY_ENTRIES) as usize;

    // Deduplicate: if the most recent entry has the same SQL and database, update it instead
    if let Some(first) = entries.first_mut() {
        if first.sql == sql && first.database == database {
            first.executed_at = executed_at.clone();
            first.execution_time_ms = execution_time_ms;
            first.status = status.clone();
            first.rows_affected = rows_affected;
            first.error = error.clone();
            let updated = first.clone();
            write_history(&app, &connection_id, &entries)?;
            return Ok(updated);
        }
    }

    let entry = QueryHistoryEntry {
        id: Uuid::new_v4().to_string(),
        sql,
        executed_at,
        execution_time_ms,
        status,
        rows_affected,
        error,
        database,
    };

    // Insert at the beginning (newest first)
    entries.insert(0, entry.clone());

    // Evict oldest entries if over the limit
    if entries.len() > max_entries {
        entries.truncate(max_entries);
    }

    write_history(&app, &connection_id, &entries)?;
    Ok(entry)
}

#[tauri::command]
pub async fn delete_query_history_entry<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, QueryHistoryState>,
    connection_id: String,
    id: String,
) -> Result<(), String> {
    let lock = acquire_lock(&state, &connection_id).await;
    let _guard = lock.lock().await;

    let mut entries = read_history(&app, &connection_id)?;
    let original_len = entries.len();
    entries.retain(|e| e.id != id);

    if entries.len() == original_len {
        return Err("History entry not found".to_string());
    }

    write_history(&app, &connection_id, &entries)
}

#[tauri::command]
pub async fn clear_query_history<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, QueryHistoryState>,
    connection_id: String,
) -> Result<(), String> {
    let lock = acquire_lock(&state, &connection_id).await;
    let _guard = lock.lock().await;

    let path = get_history_path(&app, &connection_id)?;
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Set `database = Some(database)` on any history entry whose `database` is currently
/// `None`. Returns the count of entries updated.
pub fn backfill_missing_database(entries: &mut [QueryHistoryEntry], database: &str) -> usize {
    let mut updated = 0usize;
    for entry in entries.iter_mut() {
        if entry.database.is_none() {
            entry.database = Some(database.to_string());
            updated += 1;
        }
    }
    updated
}

/// Backfill `database` on history entries for a connection where it is currently `None`.
/// Used when a connection transitions from single-db to multi-db: existing entries
/// without an explicit database get associated with the original single database.
///
/// Acquires the per-connection [`QueryHistoryState`] lock so concurrent
/// `add_query_history_entry` calls can't race the read-modify-write sequence
/// and lose entries.
pub async fn backfill_missing_database_for_connection<R: Runtime>(
    app: &AppHandle<R>,
    connection_id: &str,
    database: &str,
) -> Result<usize, String> {
    let state = app.state::<QueryHistoryState>();
    let lock = acquire_lock(&state, connection_id).await;
    let _guard = lock.lock().await;

    let mut entries = read_history(app, connection_id)?;
    let updated = backfill_missing_database(&mut entries, database);
    if updated > 0 {
        write_history(app, connection_id, &entries)?;
    }
    Ok(updated)
}

/// Remove history file for a connection (called during connection deletion).
///
/// Acquires the per-connection [`QueryHistoryState`] lock so an in-flight
/// `add_query_history_entry` (started before the connection was deleted) can't
/// recreate the file after we remove it.
pub async fn remove_history_for_connection<R: Runtime>(
    app: &AppHandle<R>,
    connection_id: &str,
) -> Result<(), String> {
    let state = app.state::<QueryHistoryState>();
    let lock = acquire_lock(&state, connection_id).await;
    let _guard = lock.lock().await;

    let path = get_history_path(app, connection_id)?;
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

