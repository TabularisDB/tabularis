#[cfg(test)]
mod tests {
    use crate::query_history::{
        atomic_write, backfill_missing_database, backup_corrupt_file, QueryHistoryEntry,
    };
    use std::fs;
    use tempfile::tempdir;

    fn make_entry(id: &str, database: Option<&str>) -> QueryHistoryEntry {
        QueryHistoryEntry {
            id: id.into(),
            sql: "SELECT 1".into(),
            executed_at: "2024-01-01T00:00:00Z".into(),
            execution_time_ms: None,
            status: "success".into(),
            rows_affected: None,
            error: None,
            database: database.map(|s| s.into()),
        }
    }

    #[test]
    fn backfills_only_entries_with_none_database() {
        let mut entries = vec![
            make_entry("1", None),
            make_entry("2", Some("existing")),
            make_entry("3", None),
        ];
        let updated = backfill_missing_database(&mut entries, "app");
        assert_eq!(updated, 2);
        assert_eq!(entries[0].database.as_deref(), Some("app"));
        assert_eq!(entries[1].database.as_deref(), Some("existing"));
        assert_eq!(entries[2].database.as_deref(), Some("app"));
    }

    #[test]
    fn returns_zero_when_nothing_to_backfill() {
        let mut entries = vec![make_entry("1", Some("app")), make_entry("2", Some("app"))];
        let updated = backfill_missing_database(&mut entries, "other");
        assert_eq!(updated, 0);
        assert_eq!(entries[0].database.as_deref(), Some("app"));
        assert_eq!(entries[1].database.as_deref(), Some("app"));
    }

    #[test]
    fn handles_empty_list() {
        let mut entries: Vec<QueryHistoryEntry> = Vec::new();
        let updated = backfill_missing_database(&mut entries, "app");
        assert_eq!(updated, 0);
        assert!(entries.is_empty());
    }

    #[test]
    fn does_not_overwrite_empty_string_database() {
        let mut entries = vec![make_entry("1", Some(""))];
        let updated = backfill_missing_database(&mut entries, "app");
        assert_eq!(updated, 0);
        assert_eq!(entries[0].database.as_deref(), Some(""));
    }

    #[test]
    fn atomic_write_truncates_prior_longer_content() {
        // Reproduces the failure mode that produced the corrupt file in
        // production: a longer write followed by a shorter one must end up
        // with the shorter content only — no trailing bytes from the prior
        // write leaking past the new end-of-file.
        let dir = tempdir().unwrap();
        let path = dir.path().join("history.json");

        let longer = b"[\"AAAAAAAAAAAAAAAAAAAA\",\"BBBBBBBBBBBBBBBBBBBB\"]";
        atomic_write(&path, longer).unwrap();
        assert_eq!(fs::read(&path).unwrap(), longer);

        let shorter = b"[\"only\"]";
        atomic_write(&path, shorter).unwrap();
        assert_eq!(fs::read(&path).unwrap(), shorter);
    }

    #[test]
    fn atomic_write_leaves_no_tmp_files_on_success() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("history.json");
        atomic_write(&path, b"[]").unwrap();

        let leftovers: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|n| n != "history.json")
            .collect();
        assert!(
            leftovers.is_empty(),
            "expected only the target file, found: {:?}",
            leftovers
        );
    }

    #[test]
    fn backup_corrupt_file_renames_with_timestamp_suffix() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("history.json");
        fs::write(&path, b"]not valid json[").unwrap();

        let backup = backup_corrupt_file(&path).unwrap();
        assert!(!path.exists(), "original should be moved aside");
        assert!(backup.exists(), "backup should exist at returned path");
        let name = backup.file_name().unwrap().to_string_lossy().into_owned();
        assert!(
            name.starts_with("history.json.corrupt-"),
            "unexpected backup name: {}",
            name
        );
        assert_eq!(fs::read(&backup).unwrap(), b"]not valid json[");
    }
}
