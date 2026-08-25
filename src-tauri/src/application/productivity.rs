use crate::config::AppConfig;
use chrono::Utc;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use uuid::Uuid;

const DEFAULT_MAX_HISTORY_ENTRIES: u32 = 500;
const SAVED_QUERIES_DIR: &str = "saved_queries";
const SAVED_QUERIES_META_FILE: &str = "meta.json";
const QUERY_HISTORY_DIR: &str = "query_history";

static PRODUCTIVITY_STORAGE_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SavedQueryMeta {
    pub id: String,
    pub name: String,
    pub filename: String,
    pub connection_id: String,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SavedQuery {
    pub id: String,
    pub name: String,
    pub sql: String,
    pub connection_id: String,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

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

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct QueryHistoryResponse {
    pub entries: Vec<QueryHistoryEntry>,
    pub recovered_backup_path: Option<String>,
}

#[derive(Debug)]
pub enum ProductivityCommand {
    GetSavedQueries {
        connection_id: String,
    },
    SaveQuery {
        connection_id: String,
        name: String,
        sql: String,
        database: Option<String>,
    },
    UpdateSavedQuery {
        connection_id: Option<String>,
        id: String,
        name: String,
        sql: String,
        database: Option<String>,
    },
    DeleteSavedQuery {
        connection_id: Option<String>,
        id: String,
    },
    GetQueryHistory {
        connection_id: String,
    },
    AddQueryHistoryEntry {
        connection_id: String,
        sql: String,
        executed_at: String,
        execution_time_ms: Option<f64>,
        status: String,
        rows_affected: Option<i64>,
        error: Option<String>,
        database: Option<String>,
    },
    DeleteQueryHistoryEntry {
        connection_id: String,
        id: String,
    },
    ClearQueryHistory {
        connection_id: String,
    },
}

pub async fn execute(config_dir: &Path, command: ProductivityCommand) -> Result<Value, String> {
    let _guard = PRODUCTIVITY_STORAGE_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());

    match command {
        ProductivityCommand::GetSavedQueries { connection_id } => {
            json(get_saved_queries(config_dir, &connection_id)?)
        }
        ProductivityCommand::SaveQuery {
            connection_id,
            name,
            sql,
            database,
        } => json(save_query(config_dir, connection_id, name, sql, database)?),
        ProductivityCommand::UpdateSavedQuery {
            connection_id,
            id,
            name,
            sql,
            database,
        } => json(update_saved_query(
            config_dir,
            connection_id.as_deref(),
            &id,
            name,
            sql,
            database,
        )?),
        ProductivityCommand::DeleteSavedQuery { connection_id, id } => {
            delete_saved_query(config_dir, connection_id.as_deref(), &id)?;
            Ok(Value::Null)
        }
        ProductivityCommand::GetQueryHistory { connection_id } => {
            json(get_query_history(config_dir, &connection_id)?)
        }
        ProductivityCommand::AddQueryHistoryEntry {
            connection_id,
            sql,
            executed_at,
            execution_time_ms,
            status,
            rows_affected,
            error,
            database,
        } => json(add_query_history_entry(
            config_dir,
            &connection_id,
            sql,
            executed_at,
            execution_time_ms,
            status,
            rows_affected,
            error,
            database,
        )?),
        ProductivityCommand::DeleteQueryHistoryEntry { connection_id, id } => {
            delete_query_history_entry(config_dir, &connection_id, &id)?;
            Ok(Value::Null)
        }
        ProductivityCommand::ClearQueryHistory { connection_id } => {
            clear_query_history(config_dir, &connection_id)?;
            Ok(Value::Null)
        }
    }
}

pub fn backfill_saved_query_metadata(
    meta_list: &mut [SavedQueryMeta],
    connection_id: &str,
    database: &str,
) -> usize {
    let mut updated = 0;
    for meta in meta_list {
        if meta.connection_id == connection_id && meta.database.is_none() {
            meta.database = Some(database.to_string());
            updated += 1;
        }
    }
    updated
}

pub fn backfill_history_entries(entries: &mut [QueryHistoryEntry], database: &str) -> usize {
    let mut updated = 0;
    for entry in entries {
        if entry.database.is_none() {
            entry.database = Some(database.to_string());
            updated += 1;
        }
    }
    updated
}

pub fn backfill_saved_queries_for_connection(
    config_dir: &Path,
    connection_id: &str,
    database: &str,
) -> Result<usize, String> {
    let _guard = PRODUCTIVITY_STORAGE_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let mut meta = read_saved_query_meta(config_dir)?;
    let updated = backfill_saved_query_metadata(&mut meta, connection_id, database);
    if updated > 0 {
        write_saved_query_meta(config_dir, &meta)?;
    }
    Ok(updated)
}

pub fn backfill_query_history_for_connection(
    config_dir: &Path,
    connection_id: &str,
    database: &str,
) -> Result<usize, String> {
    let _guard = PRODUCTIVITY_STORAGE_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let mut entries = read_query_history(config_dir, connection_id)?;
    let updated = backfill_history_entries(&mut entries, database);
    if updated > 0 {
        write_query_history(config_dir, connection_id, &entries)?;
    }
    Ok(updated)
}

pub fn remove_query_history_for_connection(
    config_dir: &Path,
    connection_id: &str,
) -> Result<(), String> {
    let _guard = PRODUCTIVITY_STORAGE_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    clear_query_history(config_dir, connection_id)
}

fn get_saved_queries(config_dir: &Path, connection_id: &str) -> Result<Vec<SavedQuery>, String> {
    let meta = read_saved_query_meta(config_dir)?;
    let directory = saved_queries_dir(config_dir)?;
    meta.into_iter()
        .filter(|item| item.connection_id == connection_id)
        .map(|item| {
            validate_storage_filename(&item.filename)?;
            let path = directory.join(&item.filename);
            let sql = if path.exists() {
                fs::read_to_string(path).unwrap_or_default()
            } else {
                String::new()
            };
            Ok(SavedQuery {
                id: item.id,
                name: item.name,
                sql,
                connection_id: item.connection_id,
                database: item.database,
                created_at: item.created_at,
                updated_at: item.updated_at,
            })
        })
        .collect()
}

fn save_query(
    config_dir: &Path,
    connection_id: String,
    name: String,
    sql: String,
    database: Option<String>,
) -> Result<SavedQuery, String> {
    let mut meta = read_saved_query_meta(config_dir)?;
    let directory = saved_queries_dir(config_dir)?;
    let id = Uuid::new_v4().to_string();
    let filename = format!("{id}.sql");
    let path = directory.join(&filename);
    atomic_write(&path, sql.as_bytes())?;

    let now = Utc::now().to_rfc3339();
    meta.push(SavedQueryMeta {
        id: id.clone(),
        name: name.clone(),
        filename,
        connection_id: connection_id.clone(),
        database: database.clone(),
        created_at: Some(now.clone()),
        updated_at: Some(now.clone()),
    });
    if let Err(error) = write_saved_query_meta(config_dir, &meta) {
        let _ = fs::remove_file(path);
        return Err(error);
    }

    Ok(SavedQuery {
        id,
        name,
        sql,
        connection_id,
        database,
        created_at: Some(now.clone()),
        updated_at: Some(now),
    })
}

fn update_saved_query(
    config_dir: &Path,
    connection_id: Option<&str>,
    id: &str,
    name: String,
    sql: String,
    database: Option<String>,
) -> Result<SavedQuery, String> {
    let mut meta = read_saved_query_meta(config_dir)?;
    let index = find_saved_query(&meta, connection_id, id)?;
    validate_storage_filename(&meta[index].filename)?;
    let path = saved_queries_dir(config_dir)?.join(&meta[index].filename);
    atomic_write(&path, sql.as_bytes())?;

    let now = Utc::now().to_rfc3339();
    meta[index].name = name.clone();
    meta[index].database = database.clone();
    meta[index].updated_at = Some(now.clone());
    write_saved_query_meta(config_dir, &meta)?;

    Ok(SavedQuery {
        id: meta[index].id.clone(),
        name,
        sql,
        connection_id: meta[index].connection_id.clone(),
        database,
        created_at: meta[index].created_at.clone(),
        updated_at: Some(now),
    })
}

fn delete_saved_query(
    config_dir: &Path,
    connection_id: Option<&str>,
    id: &str,
) -> Result<(), String> {
    let mut meta = read_saved_query_meta(config_dir)?;
    let index = find_saved_query(&meta, connection_id, id)?;
    let removed = meta.remove(index);
    validate_storage_filename(&removed.filename)?;
    write_saved_query_meta(config_dir, &meta)?;
    let path = saved_queries_dir(config_dir)?.join(removed.filename);
    if path.exists() {
        let _ = fs::remove_file(path);
    }
    Ok(())
}

fn find_saved_query(
    meta: &[SavedQueryMeta],
    connection_id: Option<&str>,
    id: &str,
) -> Result<usize, String> {
    meta.iter()
        .position(|item| {
            item.id == id
                && connection_id
                    .map(|expected| item.connection_id == expected)
                    .unwrap_or(true)
        })
        .ok_or_else(|| "Query not found".to_string())
}

fn get_query_history(
    config_dir: &Path,
    connection_id: &str,
) -> Result<QueryHistoryResponse, String> {
    let (entries, backup) = read_query_history_with_recovery(config_dir, connection_id)?;
    Ok(QueryHistoryResponse {
        entries,
        recovered_backup_path: backup.map(|path| path.to_string_lossy().into_owned()),
    })
}

#[allow(clippy::too_many_arguments)]
fn add_query_history_entry(
    config_dir: &Path,
    connection_id: &str,
    sql: String,
    executed_at: String,
    execution_time_ms: Option<f64>,
    status: String,
    rows_affected: Option<i64>,
    error: Option<String>,
    database: Option<String>,
) -> Result<QueryHistoryEntry, String> {
    let mut entries = read_query_history(config_dir, connection_id)?;
    let max_entries = load_history_limit(config_dir);

    if let Some(first) = entries.first_mut() {
        if first.sql == sql && first.database == database {
            first.executed_at = executed_at;
            first.execution_time_ms = execution_time_ms;
            first.status = status;
            first.rows_affected = rows_affected;
            first.error = error;
            let updated = first.clone();
            write_query_history(config_dir, connection_id, &entries)?;
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
    entries.insert(0, entry.clone());
    entries.truncate(max_entries);
    write_query_history(config_dir, connection_id, &entries)?;
    Ok(entry)
}

fn delete_query_history_entry(
    config_dir: &Path,
    connection_id: &str,
    id: &str,
) -> Result<(), String> {
    let mut entries = read_query_history(config_dir, connection_id)?;
    let original_len = entries.len();
    entries.retain(|entry| entry.id != id);
    if entries.len() == original_len {
        return Err("History entry not found".to_string());
    }
    write_query_history(config_dir, connection_id, &entries)
}

fn clear_query_history(config_dir: &Path, connection_id: &str) -> Result<(), String> {
    let path = query_history_path(config_dir, connection_id)?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn read_saved_query_meta(config_dir: &Path) -> Result<Vec<SavedQueryMeta>, String> {
    let path = saved_query_meta_path(config_dir)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&content).map_err(|error| error.to_string())
}

fn write_saved_query_meta(config_dir: &Path, meta: &[SavedQueryMeta]) -> Result<(), String> {
    let path = saved_query_meta_path(config_dir)?;
    let content = serde_json::to_vec_pretty(meta).map_err(|error| error.to_string())?;
    atomic_write(&path, &content)
}

fn read_query_history(
    config_dir: &Path,
    connection_id: &str,
) -> Result<Vec<QueryHistoryEntry>, String> {
    read_query_history_with_recovery(config_dir, connection_id).map(|(entries, _)| entries)
}

fn read_query_history_with_recovery(
    config_dir: &Path,
    connection_id: &str,
) -> Result<(Vec<QueryHistoryEntry>, Option<PathBuf>), String> {
    let path = query_history_path(config_dir, connection_id)?;
    if !path.exists() {
        return Ok((Vec::new(), None));
    }
    let content = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    match serde_json::from_str(&content) {
        Ok(entries) => Ok((entries, None)),
        Err(parse_error) => {
            let backup = backup_corrupt_file(&path).map_err(|error| {
                format!(
                    "Query history JSON parse failed and backup also failed: {error} (parse error: {parse_error})"
                )
            })?;
            log::warn!(
                "Query history file for connection '{}' was corrupt ({}); moved to {}",
                connection_id,
                parse_error,
                backup.display()
            );
            Ok((Vec::new(), Some(backup)))
        }
    }
}

fn write_query_history(
    config_dir: &Path,
    connection_id: &str,
    entries: &[QueryHistoryEntry],
) -> Result<(), String> {
    let path = query_history_path(config_dir, connection_id)?;
    let content = serde_json::to_vec_pretty(entries).map_err(|error| error.to_string())?;
    atomic_write(&path, &content)
}

fn saved_queries_dir(config_dir: &Path) -> Result<PathBuf, String> {
    let path = config_dir.join(SAVED_QUERIES_DIR);
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path)
}

fn saved_query_meta_path(config_dir: &Path) -> Result<PathBuf, String> {
    Ok(saved_queries_dir(config_dir)?.join(SAVED_QUERIES_META_FILE))
}

fn query_history_path(config_dir: &Path, connection_id: &str) -> Result<PathBuf, String> {
    validate_storage_key(connection_id)?;
    let directory = config_dir.join(QUERY_HISTORY_DIR);
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join(format!("{connection_id}.json")))
}

fn validate_storage_key(value: &str) -> Result<(), String> {
    let mut components = Path::new(value).components();
    let is_single_normal =
        matches!(components.next(), Some(Component::Normal(_))) && components.next().is_none();
    if value.is_empty()
        || value == "."
        || value == ".."
        || value.contains('/')
        || value.contains('\\')
        || !is_single_normal
    {
        return Err("Invalid connection identifier".to_string());
    }
    Ok(())
}

fn validate_storage_filename(value: &str) -> Result<(), String> {
    validate_storage_key(value).map_err(|_| "Invalid saved query filename".to_string())
}

fn load_history_limit(config_dir: &Path) -> usize {
    let config = fs::read_to_string(config_dir.join("config.json"))
        .ok()
        .and_then(|content| serde_json::from_str::<AppConfig>(&content).ok())
        .unwrap_or_default();
    config
        .query_history_max_entries
        .unwrap_or(DEFAULT_MAX_HISTORY_ENTRIES) as usize
}

pub(crate) fn backup_corrupt_file(path: &Path) -> Result<PathBuf, String> {
    let timestamp = Utc::now().format("%Y-%m-%dT%H-%M-%S%3f");
    let base = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("history.json");
    let mut backup = path.with_file_name(format!("{base}.corrupt-{timestamp}"));
    if backup.exists() {
        backup = path.with_file_name(format!(
            "{base}.corrupt-{timestamp}-{}",
            Uuid::new_v4().simple()
        ));
    }
    fs::rename(path, &backup).map_err(|error| error.to_string())?;
    Ok(backup)
}

pub(crate) fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let directory = path
        .parent()
        .ok_or_else(|| "storage path has no parent".to_string())?;
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("data.json");
    let temporary = directory.join(format!(".{file_name}.tmp.{}", Uuid::new_v4().simple()));
    if let Err(error) = fs::write(&temporary, bytes) {
        let _ = fs::remove_file(&temporary);
        return Err(error.to_string());
    }
    if let Err(error) = fs::rename(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(error.to_string());
    }
    Ok(())
}

fn json<T: Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|error| error.to_string())
}
