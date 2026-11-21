//! Storage for recorded saves.
//!
//! One file per saved connection under `save_history/` in the data directory.
//! The files hold row values, so they are written with owner-only permissions
//! (the temporary file is created `0600` and replaces the old one atomically),
//! never logged, bounded by the limits in [`super::model`] and removed with
//! their connection. A file that cannot be parsed is reported and left alone.

use super::model::SaveHistoryFile;
use super::model::SaveRecord;
use super::plan::prune;
use crate::application::productivity::validate_storage_key;
use chrono::Utc;
use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const DIRECTORY: &str = "save_history";

/// Serializes read-change-write cycles within the process.
static UPDATE_LOCK: Mutex<()> = Mutex::new(());

pub fn history_path(data_dir: &Path, connection_id: &str) -> Result<PathBuf, String> {
    validate_storage_key(connection_id)?;
    Ok(data_dir
        .join(DIRECTORY)
        .join(format!("{connection_id}.json")))
}

pub fn load(data_dir: &Path, connection_id: &str) -> Result<SaveHistoryFile, String> {
    let path = history_path(data_dir, connection_id)?;
    let contents = match fs::read_to_string(&path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(SaveHistoryFile::default()),
        Err(error) => return Err(unreadable(&path, &error.to_string())),
    };
    serde_json::from_str(&contents).map_err(|error| unreadable(&path, &error.to_string()))
}

fn unreadable(path: &Path, error: &str) -> String {
    format!(
        "The save history file {} could not be read and was left unchanged: {error}",
        path.display()
    )
}

fn write(path: &Path, file: &SaveHistoryFile) -> Result<(), String> {
    let directory = path
        .parent()
        .ok_or_else(|| "The save history path has no parent".to_string())?;
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let bytes = serde_json::to_vec(file).map_err(|error| error.to_string())?;
    // `NamedTempFile` is created with mode 0600 on Unix.
    let mut temporary =
        tempfile::NamedTempFile::new_in(directory).map_err(|error| error.to_string())?;
    temporary
        .write_all(&bytes)
        .map_err(|error| error.to_string())?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    temporary
        .persist(path)
        .map_err(|error| error.error.to_string())?;
    Ok(())
}

/// Reread, change, prune and atomically replace the file.
pub fn update<T>(
    data_dir: &Path,
    connection_id: &str,
    change: impl FnOnce(&mut SaveHistoryFile) -> Result<T, String>,
) -> Result<T, String> {
    let _guard = UPDATE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let path = history_path(data_dir, connection_id)?;
    let mut file = load(data_dir, connection_id)?;
    let result = change(&mut file)?;
    prune(&mut file, Utc::now());
    write(&path, &file)?;
    Ok(result)
}

pub fn is_enabled(data_dir: &Path, connection_id: &str) -> Result<bool, String> {
    Ok(load(data_dir, connection_id)?.enabled)
}

pub fn append(data_dir: &Path, connection_id: &str, record: SaveRecord) -> Result<(), String> {
    update(data_dir, connection_id, |file| {
        file.records.push(record);
        Ok(())
    })
}

/// Removes one record, or every record when `record_id` is `None`. Returns
/// how many were removed.
pub fn delete(
    data_dir: &Path,
    connection_id: &str,
    record_id: Option<&str>,
) -> Result<usize, String> {
    update(data_dir, connection_id, |file| {
        let before = file.records.len();
        match record_id {
            Some(id) => file.records.retain(|record| record.id != id),
            None => file.records.clear(),
        }
        Ok(before - file.records.len())
    })
}

pub fn remove_for_connection(data_dir: &Path, connection_id: &str) -> Result<(), String> {
    let _guard = UPDATE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let path = history_path(data_dir, connection_id)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "Could not remove the save history {}: {error}",
            path.display()
        )),
    }
}
