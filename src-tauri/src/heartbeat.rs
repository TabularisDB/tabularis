//! Approval-host heartbeat used by the MCP subprocess to detect whether a
//! Tabularis desktop or web runtime is currently running.
//!
//! The approval host refreshes `<config_dir>/tabularis.alive` every `TICK_INTERVAL`.
//! The MCP subprocess calls `is_alive()` before queueing approval requests
//! so that — when the approval host is closed — write/DDL queries fail fast with a
//! clear error instead of hanging until `mcp_approval_timeout_seconds`
//! (default 120s) elapses.
//!
//! Hosts share this file, so shutdown stops refreshing without deleting it.
//! Stale-by-mtime detection handles the last host exiting or crashing.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use crate::paths::get_app_config_dir;

const FILE_NAME: &str = "tabularis.alive";

/// How often the approval host refreshes the heartbeat file.
pub const TICK_INTERVAL: Duration = Duration::from_secs(5);

/// Heartbeats older than this are considered stale (3 missed ticks).
pub const STALE_AFTER: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Heartbeat {
    pub pid: u32,
    pub updated_at: String,
}

pub fn heartbeat_path_in(base: &Path) -> PathBuf {
    base.join(FILE_NAME)
}

pub fn write_now_in(base: &Path) -> Result<(), String> {
    if !base.exists() {
        fs::create_dir_all(base).map_err(|e| e.to_string())?;
    }
    let beat = Heartbeat {
        pid: std::process::id(),
        updated_at: crate::ai_activity::now_iso8601(),
    };
    let content = serde_json::to_string(&beat).map_err(|e| e.to_string())?;
    fs::write(heartbeat_path_in(base), content).map_err(|e| e.to_string())
}

pub fn clear_in(base: &Path) -> Result<(), String> {
    let path = heartbeat_path_in(base);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Returns `true` if the heartbeat file exists and was modified within
/// `max_age`. Filesystem errors are treated as "not alive" — fail-closed.
pub fn is_alive_in_with_age(base: &Path, max_age: Duration) -> bool {
    let path = heartbeat_path_in(base);
    let metadata = match fs::metadata(&path) {
        Ok(m) => m,
        Err(_) => return false,
    };
    let modified = match metadata.modified() {
        Ok(m) => m,
        Err(_) => return false,
    };
    match SystemTime::now().duration_since(modified) {
        Ok(age) => age <= max_age,
        // mtime is in the future (clock skew): trust the file.
        Err(_) => true,
    }
}

pub fn is_alive_in(base: &Path) -> bool {
    is_alive_in_with_age(base, STALE_AFTER)
}

// ---------------------------------------------------------------------------
// Default-dir wrappers (used at runtime)
// ---------------------------------------------------------------------------

pub fn write_now() -> Result<(), String> {
    write_now_in(&get_app_config_dir())
}

pub fn clear() -> Result<(), String> {
    clear_in(&get_app_config_dir())
}

pub fn is_alive() -> bool {
    is_alive_in(&get_app_config_dir())
}

/// Owns the approval host ticker; dropping it stops refreshing the shared file.
#[must_use = "Keep the heartbeat task alive for the lifetime of the approval host"]
pub struct HeartbeatTask(crate::async_rt::JoinHandle<()>);

impl HeartbeatTask {
    pub fn stop(&self) {
        // Another host may still be running, even when this process wrote last.
        self.0.abort();
    }
}

impl Drop for HeartbeatTask {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Writes immediately, then refreshes until the owning runtime stops the task.
pub fn spawn_in(base: PathBuf) -> HeartbeatTask {
    if let Err(error) = write_now_in(&base) {
        log::warn!("Failed to write initial heartbeat: {}", error);
    }
    let task = crate::async_rt::spawn(async move {
        let mut ticker = tokio::time::interval(TICK_INTERVAL);
        ticker.tick().await;
        loop {
            ticker.tick().await;
            if let Err(error) = write_now_in(&base) {
                log::warn!("Heartbeat refresh failed: {}", error);
            }
        }
    });
    HeartbeatTask(task)
}

pub fn spawn() -> HeartbeatTask {
    spawn_in(get_app_config_dir())
}
