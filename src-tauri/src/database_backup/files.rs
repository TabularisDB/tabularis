//! Backup file naming, discovery and retention for scheduled database backups.

use chrono::NaiveDateTime;
use std::fs;
use std::path::Path;

pub const FILE_PREFIX: &str = "tabularis-db-backup-";
pub const FILE_SUFFIX: &str = ".sql";
pub const TIMESTAMP_FORMAT: &str = "%Y%m%d-%H%M%S";

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

/// File name for a backup taken at `now_utc`. The timestamp is UTC so names
/// sort unambiguously across DST folds.
pub fn backup_file_name(
    connection_id: &str,
    database: Option<&str>,
    now_utc: NaiveDateTime,
) -> String {
    let prefix = plan_file_prefix(connection_id, database);
    format!(
        "{}{}{FILE_SUFFIX}",
        prefix,
        now_utc.format(TIMESTAMP_FORMAT)
    )
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

/// Backups of this plan, oldest first.
fn plan_backups(
    names: &[String],
    connection_id: &str,
    database: Option<&str>,
) -> Vec<(String, NaiveDateTime)> {
    let prefix = plan_file_prefix(connection_id, database);
    let mut matching: Vec<(String, NaiveDateTime)> = names
        .iter()
        .filter(|n| n.starts_with(&prefix) && n.ends_with(FILE_SUFFIX))
        .filter_map(|n| parse_backup_timestamp(n).map(|ts| (n.clone(), ts)))
        .collect();
    matching.sort_by_key(|(_, ts)| *ts);
    matching
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
    let matching = plan_backups(names, connection_id, database);
    let excess = matching.len().saturating_sub(retention);
    matching.into_iter().take(excess).map(|(n, _)| n).collect()
}

pub fn list_directory_files(dir: &Path) -> Vec<String> {
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
pub fn find_newest_backup(
    dest_dir: &Path,
    connection_id: &str,
    database: Option<&str>,
) -> Option<(String, NaiveDateTime)> {
    plan_backups(&list_directory_files(dest_dir), connection_id, database).pop()
}
