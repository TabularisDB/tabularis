//! Storage for local schema notes (see [`crate::schema_notes`]).
//!
//! One sidecar file per saved connection under `schema_notes/` in the config
//! directory. Every change rereads the file and replaces it atomically; a file
//! that cannot be read or parsed is reported and never overwritten.

use super::productivity::{atomic_write, validate_storage_key};
use crate::schema_notes::{self, SchemaNoteTarget, StoredSchemaNotes};
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const SCHEMA_NOTES_DIR: &str = "schema_notes";

/// Serializes read-change-write cycles, so two overlapping saves in this
/// process (two windows, or two web tabs) cannot drop each other's change.
static UPDATE_LOCK: Mutex<()> = Mutex::new(());

pub fn notes_path(config_dir: &Path, connection_id: &str) -> Result<PathBuf, String> {
    validate_storage_key(connection_id)?;
    Ok(config_dir
        .join(SCHEMA_NOTES_DIR)
        .join(format!("{connection_id}.json")))
}

pub fn load(config_dir: &Path, connection_id: &str) -> Result<StoredSchemaNotes, String> {
    let path = notes_path(config_dir, connection_id)?;
    let contents = match fs::read_to_string(&path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            return Ok(StoredSchemaNotes::default())
        }
        Err(error) => return Err(unreadable(&path, &error.to_string())),
    };
    schema_notes::parse_document(&contents).map_err(|error| unreadable(&path, &error))
}

fn unreadable(path: &Path, error: &str) -> String {
    format!(
        "The schema notes file {} could not be read and was left unchanged: {error}",
        path.display()
    )
}

/// Reread, change and atomically replace the file. Nothing is written when
/// the current file is unreadable or the change is rejected.
fn update(
    config_dir: &Path,
    connection_id: &str,
    change: impl FnOnce(&mut StoredSchemaNotes) -> Result<(), String>,
) -> Result<StoredSchemaNotes, String> {
    let _guard = UPDATE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut stored = load(config_dir, connection_id)?;
    change(&mut stored)?;
    let path = notes_path(config_dir, connection_id)?;
    let contents = schema_notes::serialize_stored(&stored)?;
    atomic_write(&path, contents.as_bytes())
        .map_err(|error| format!("Could not save schema notes to {}: {error}", path.display()))?;
    Ok(stored)
}

/// `target: None` edits the connection-wide (project) note.
pub fn set_note(
    config_dir: &Path,
    connection_id: &str,
    target: Option<SchemaNoteTarget>,
    domain: Option<String>,
    note: String,
) -> Result<StoredSchemaNotes, String> {
    update(config_dir, connection_id, |stored| match target {
        Some(target) => schema_notes::upsert_note(&mut stored.notes, target, domain, note),
        None => schema_notes::set_project_note(&mut stored.notes, note),
    })
}

pub fn set_ai_context(
    config_dir: &Path,
    connection_id: &str,
    enabled: bool,
) -> Result<StoredSchemaNotes, String> {
    update(config_dir, connection_id, |stored| {
        stored.include_in_ai_context = enabled;
        Ok(())
    })
}

/// Merge a sidecar document into the connection's notes. The import never
/// changes whether notes go to the AI.
pub fn import(
    config_dir: &Path,
    connection_id: &str,
    contents: &str,
) -> Result<StoredSchemaNotes, String> {
    let imported = schema_notes::parse_document(contents)?;
    update(config_dir, connection_id, |stored| {
        schema_notes::merge_import(&mut stored.notes, imported.notes).map(|_| ())
    })
}

pub fn export(config_dir: &Path, connection_id: &str) -> Result<String, String> {
    schema_notes::serialize_export(&load(config_dir, connection_id)?.notes)
}

/// Notes to append to an AI schema context, or `None` when the user has not
/// enabled them for this connection. An unreadable file only drops the notes:
/// it must not block the AI request.
pub fn prompt_section(
    config_dir: &Path,
    connection_id: &str,
    tables: &[String],
    database: Option<&str>,
    schema: Option<&str>,
) -> Option<String> {
    let stored = match load(config_dir, connection_id) {
        Ok(stored) => stored,
        Err(error) => {
            log::warn!("Schema notes left out of AI context: {error}");
            return None;
        }
    };
    if !stored.include_in_ai_context {
        return None;
    }
    let section = schema_notes::format_for_prompt(&stored.notes, tables, database, schema);
    (!section.is_empty()).then_some(section)
}

#[cfg(test)]
#[path = "schema_notes_tests.rs"]
mod tests;
