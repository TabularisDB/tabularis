#[cfg(test)]
mod tests {
    use crate::query_history::{
        atomic_write, backfill_missing_database, backup_corrupt_file,
        compute_query_history_insights, normalize_sql_for_insights, QueryHistoryEntry,
        QueryHistoryInsightsRequest,
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

    #[test]
    fn normalizes_sql_with_dialect_aware_comments_literals_and_identifiers() {
        assert_eq!(
            normalize_sql_for_insights(
                "SELECT /* hint */ id, \"UserName\" FROM Users WHERE id = 42 AND status = 'active'; -- tail",
                Some("postgres")
            ),
            "SELECT id, \"UserName\" FROM users WHERE id = ? AND status = '?'"
        );
        // In MySQL, double-quoted literals are strings, while backticks quote identifiers.
        assert_eq!(
            normalize_sql_for_insights(
                "SELECT `UserName` FROM users WHERE status = \"active\" # comment",
                Some("mysql")
            ),
            "SELECT `UserName` FROM users WHERE status = '?'"
        );
        // Literal IN lists collapse without conflating subqueries or different operations.
        assert_eq!(
            normalize_sql_for_insights(
                "SELECT * FROM orders WHERE id IN (1, 2, 3, 4)",
                Some("sqlite")
            ),
            "SELECT * FROM orders WHERE id IN (?+)"
        );
        assert_ne!(
            normalize_sql_for_insights("SELECT * FROM orders WHERE id = 1", Some("postgres")),
            normalize_sql_for_insights("DELETE FROM orders WHERE id = 1", Some("postgres"))
        );
    }

    #[test]
    fn computes_insights_with_sample_thresholds_missing_durations_and_time_windows() {
        let entries = vec![
            // Current window (last 24h from 2026-08-22T12:00:00Z): 3 slow executions + 1 missing duration
            QueryHistoryEntry {
                id: "c1".into(),
                sql: "SELECT * FROM orders WHERE user_id = 10".into(),
                executed_at: "2026-08-22T10:00:00Z".into(),
                execution_time_ms: Some(120.0),
                status: "success".into(),
                rows_affected: Some(1),
                error: None,
                database: Some("app".into()),
            },
            QueryHistoryEntry {
                id: "c2".into(),
                sql: "SELECT * FROM orders WHERE user_id = 20".into(),
                executed_at: "2026-08-22T09:00:00Z".into(),
                execution_time_ms: Some(140.0),
                status: "success".into(),
                rows_affected: Some(1),
                error: None,
                database: Some("app".into()),
            },
            QueryHistoryEntry {
                id: "c3".into(),
                sql: "SELECT * FROM orders WHERE user_id = 30".into(),
                executed_at: "2026-08-22T08:00:00Z".into(),
                execution_time_ms: Some(130.0),
                status: "error".into(),
                rows_affected: None,
                error: Some("timeout".into()),
                database: Some("app".into()),
            },
            QueryHistoryEntry {
                id: "c4".into(),
                sql: "SELECT * FROM orders WHERE user_id = 40".into(),
                executed_at: "2026-08-22T07:00:00Z".into(),
                execution_time_ms: None,
                status: "success".into(),
                rows_affected: None,
                error: None,
                database: Some("app".into()),
            },
            // Prior window (24h–48h ago): 3 fast executions (avg 20ms)
            QueryHistoryEntry {
                id: "p1".into(),
                sql: "SELECT * FROM orders WHERE user_id = 1".into(),
                executed_at: "2026-08-20T18:00:00Z".into(),
                execution_time_ms: Some(20.0),
                status: "success".into(),
                rows_affected: Some(1),
                error: None,
                database: Some("app".into()),
            },
            QueryHistoryEntry {
                id: "p2".into(),
                sql: "SELECT * FROM orders WHERE user_id = 2".into(),
                executed_at: "2026-08-20T19:00:00Z".into(),
                execution_time_ms: Some(20.0),
                status: "success".into(),
                rows_affected: Some(1),
                error: None,
                database: Some("app".into()),
            },
            QueryHistoryEntry {
                id: "p3".into(),
                sql: "SELECT * FROM orders WHERE user_id = 3".into(),
                executed_at: "2026-08-20T20:00:00Z".into(),
                execution_time_ms: Some(20.0),
                status: "success".into(),
                rows_affected: Some(1),
                error: None,
                database: Some("app".into()),
            },
        ];

        let response = compute_query_history_insights(
            &entries,
            7,
            &QueryHistoryInsightsRequest {
                connection_id: "conn-1".into(),
                database: Some("db:app".into()),
                window_hours: Some(24),
                dialect: Some("postgres".into()),
                now: Some("2026-08-22T12:00:00Z".into()),
                max_groups: None,
                max_executions_per_group: None,
            },
        )
        .unwrap();

        assert_eq!(response.groups.len(), 1);
        let group = &response.groups[0];
        assert_eq!(group.fingerprint, "SELECT * FROM orders WHERE user_id = ?");
        assert_eq!(group.call_count, 4);
        assert_eq!(group.timed_sample_count, 3);
        assert_eq!(group.missing_duration_count, 1);
        assert_eq!(group.avg_duration_ms, Some(130.0));
        assert_eq!(group.prior_call_count, 3);
        assert_eq!(group.prior_timed_sample_count, 3);
        assert_eq!(group.prior_avg_duration_ms, Some(20.0));
        assert!(group.is_regressed);
        assert_eq!(group.regression_status, "regressed");
        assert_eq!(group.contributing_executions.len(), 4);
        assert!(response.coverage.retention_cap_reached);
    }
}
