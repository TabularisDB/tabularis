//! Shared UI state store.
//!
//! Small interface preferences (sidebar widths, dismissed prompts, the last
//! release notes the user saw, ...) used to live in the webview's
//! `localStorage`. That storage is private to one browser origin, so the
//! desktop app and every browser that opens the Web UI kept their own copy.
//! This module keeps those values in a SQLite database next to the other
//! Tabularis data files instead, so every host sees the same state.
//!
//! The database lives in the active config directory, which follows the
//! custom storage location feature. It is opened in WAL mode with a busy
//! timeout because the desktop app and a `tabularis web` server may use it at
//! the same time.

use once_cell::sync::Lazy;
use serde_json::{Map, Value};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePool, SqlitePoolOptions};
use sqlx::Row;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;

/// File name of the shared database inside the config directory.
pub const DATABASE_FILE: &str = "tabularis.db";
/// Longest accepted key.
pub const MAX_KEY_LENGTH: usize = 128;
/// Largest accepted serialized JSON value.
pub const MAX_VALUE_BYTES: usize = 64 * 1024;
/// Most keys a single read may request.
pub const MAX_KEYS_PER_READ: usize = 256;
/// Schema version written to `PRAGMA user_version`.
pub const SCHEMA_VERSION: i64 = 1;

const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

static POOLS: Lazy<Mutex<HashMap<PathBuf, SqlitePool>>> = Lazy::new(|| Mutex::new(HashMap::new()));

/// Location of the shared database for a config directory.
pub fn database_path(config_dir: &Path) -> PathBuf {
    config_dir.join(DATABASE_FILE)
}

/// Keys are short identifiers such as `tabularis_sidebar_width` or
/// `tabularis:discord-callout-v2-dismissed`.
pub fn validate_key(key: &str) -> Result<(), String> {
    if key.is_empty() || key.len() > MAX_KEY_LENGTH {
        return Err(format!(
            "UI state keys must be between 1 and {MAX_KEY_LENGTH} characters"
        ));
    }
    if !key
        .bytes()
        .all(|byte| matches!(byte, b'a'..=b'z' | b'0'..=b'9' | b'_' | b'.' | b':' | b'-'))
    {
        return Err(format!("Invalid UI state key: {key}"));
    }
    Ok(())
}

/// Serializes a value and enforces the size cap.
pub fn encode_value(value: &Value) -> Result<String, String> {
    let encoded = serde_json::to_string(value).map_err(|error| error.to_string())?;
    if encoded.len() > MAX_VALUE_BYTES {
        return Err(format!(
            "UI state values must not exceed {MAX_VALUE_BYTES} bytes"
        ));
    }
    Ok(encoded)
}

fn validate_keys(keys: &[String]) -> Result<(), String> {
    if keys.len() > MAX_KEYS_PER_READ {
        return Err(format!(
            "At most {MAX_KEYS_PER_READ} UI state keys can be read at once"
        ));
    }
    keys.iter().try_for_each(|key| validate_key(key))
}

async fn pool(database: &Path) -> Result<SqlitePool, String> {
    let mut pools = POOLS.lock().await;
    if let Some(pool) = pools.get(database) {
        return Ok(pool.clone());
    }
    if let Some(parent) = database.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let options = SqliteConnectOptions::new()
        .filename(database)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(BUSY_TIMEOUT);
    let pool = SqlitePoolOptions::new()
        .max_connections(2)
        .connect_with(options)
        .await
        .map_err(|error| format!("Failed to open the UI state database: {error}"))?;
    migrate(&pool).await?;
    pools.insert(database.to_path_buf(), pool.clone());
    Ok(pool)
}

async fn migrate(pool: &SqlitePool) -> Result<(), String> {
    let version: i64 = sqlx::query_scalar("PRAGMA user_version")
        .fetch_one(pool)
        .await
        .map_err(|error| error.to_string())?;
    if version > SCHEMA_VERSION {
        return Err(format!(
            "The UI state database was created by a newer Tabularis (schema {version})"
        ));
    }
    if version < 1 {
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS ui_state (
                key TEXT PRIMARY KEY NOT NULL,
                value TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            )",
        )
        .execute(pool)
        .await
        .map_err(|error| error.to_string())?;
    }
    if version != SCHEMA_VERSION {
        sqlx::query(&format!("PRAGMA user_version = {SCHEMA_VERSION}"))
            .execute(pool)
            .await
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or_default()
}

/// Reads every stored entry, or only `keys` when given. Missing keys are
/// omitted from the result; rows that no longer parse as JSON are skipped.
pub async fn get_entries(
    database: &Path,
    keys: Option<&[String]>,
) -> Result<Map<String, Value>, String> {
    if let Some(keys) = keys {
        validate_keys(keys)?;
    }
    let pool = pool(database).await?;
    let rows = sqlx::query("SELECT key, value FROM ui_state ORDER BY key")
        .fetch_all(&pool)
        .await
        .map_err(|error| error.to_string())?;
    let mut entries = Map::new();
    for row in rows {
        let key: String = row.try_get("key").map_err(|error| error.to_string())?;
        if keys.is_some_and(|keys| !keys.contains(&key)) {
            continue;
        }
        let raw: String = row.try_get("value").map_err(|error| error.to_string())?;
        match serde_json::from_str(&raw) {
            Ok(value) => {
                entries.insert(key, value);
            }
            Err(error) => log::warn!("Ignoring unreadable UI state entry {key}: {error}"),
        }
    }
    Ok(entries)
}

/// Inserts or replaces one entry.
pub async fn set_entry(database: &Path, key: &str, value: &Value) -> Result<(), String> {
    validate_key(key)?;
    let encoded = encode_value(value)?;
    let pool = pool(database).await?;
    sqlx::query(
        "INSERT INTO ui_state (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(key)
    .bind(encoded)
    .bind(now_millis())
    .execute(&pool)
    .await
    .map_err(|error| error.to_string())?;
    Ok(())
}

/// Removes one entry. Returns whether it existed.
pub async fn delete_entry(database: &Path, key: &str) -> Result<bool, String> {
    validate_key(key)?;
    let pool = pool(database).await?;
    let result = sqlx::query("DELETE FROM ui_state WHERE key = ?1")
        .bind(key)
        .execute(&pool)
        .await
        .map_err(|error| error.to_string())?;
    Ok(result.rows_affected() > 0)
}

/// Closes and forgets a cached pool, so tests can remove temporary folders.
pub async fn close(database: &Path) {
    if let Some(pool) = POOLS.lock().await.remove(database) {
        pool.close().await;
    }
}
