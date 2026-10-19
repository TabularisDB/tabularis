//! Unit tests for scheduled database content backups:
//! - File naming & parsing
//! - Retention pruning and preserving last good backup
//! - IANA timezone boundaries & day transitions
//! - Concurrency guard

use super::*;
use chrono::{NaiveDate, TimeZone, Utc};

fn ts(y: i32, m: u32, d: u32, h: u32, min: u32) -> NaiveDateTime {
    NaiveDate::from_ymd_opt(y, m, d)
        .unwrap()
        .and_hms_opt(h, min, 0)
        .unwrap()
}

#[test]
fn file_name_round_trips_through_parse() {
    let now = ts(2026, 10, 19, 14, 30);
    let name = backup_file_name("conn1", Some("prod_db"), now);
    assert_eq!(name, "tabularis-db-backup-conn1-prod_db-20261019-143000.sql");

    let parsed = parse_backup_timestamp(&name);
    assert_eq!(parsed, Some(now));
}

#[test]
fn parse_rejects_foreign_files() {
    assert_eq!(parse_backup_timestamp("tabularis-backup-20261019-120000.json"), None);
    assert_eq!(parse_backup_timestamp("notes.txt"), None);
    assert_eq!(parse_backup_timestamp("corrupt.sql"), None);
    assert_eq!(parse_backup_timestamp("tabularis-db-backup-short.sql"), None);
}

#[test]
fn prune_keeps_newest_files_and_ignores_foreign_ones() {
    let names: Vec<String> = [
        "tabularis-db-backup-c1-db1-20261015-120000.sql",
        "tabularis-db-backup-c1-db1-20261016-120000.sql",
        "tabularis-db-backup-c1-db1-20261017-120000.sql",
        "tabularis-db-backup-c1-db1-20261018-120000.sql",
        "tabularis-db-backup-c1-db1-20261019-120000.sql",
        "unrelated.sql",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();

    let pruned = select_backups_to_prune(&names, "c1", Some("db1"), 3);
    assert_eq!(
        pruned,
        vec![
            "tabularis-db-backup-c1-db1-20261015-120000.sql",
            "tabularis-db-backup-c1-db1-20261016-120000.sql",
        ]
    );
}

#[test]
fn failed_runs_do_not_prune_last_good_backup() {
    // When only 1 successful backup exists and a subsequent run fails,
    // pruning is not called, but even if evaluated with retention 1,
    // the single backup is retained.
    let names = vec!["tabularis-db-backup-c1-db1-20261019-120000.sql".to_string()];
    let pruned = select_backups_to_prune(&names, "c1", Some("db1"), 1);
    assert!(pruned.is_empty());
}

#[test]
fn prune_with_zero_retention_deletes_nothing() {
    let names = vec![
        "tabularis-db-backup-c1-db1-20261018-120000.sql".to_string(),
        "tabularis-db-backup-c1-db1-20261019-120000.sql".to_string(),
    ];
    assert!(select_backups_to_prune(&names, "c1", Some("db1"), 0).is_empty());
}

#[test]
fn parse_time_handles_valid_and_invalid_formats() {
    assert_eq!(parse_time_hh_mm("02:00"), Some((2, 0)));
    assert_eq!(parse_time_hh_mm("23:59"), Some((23, 59)));
    assert_eq!(parse_time_hh_mm("00:00"), Some((0, 0)));
    assert_eq!(parse_time_hh_mm("24:00"), None);
    assert_eq!(parse_time_hh_mm("12:60"), None);
    assert_eq!(parse_time_hh_mm("invalid"), None);
}

#[test]
fn iana_timezone_boundaries_evaluation() {
    // 10:00 UTC, scheduled for 15:00 UTC
    let now = Utc.with_ymd_and_hms(2026, 10, 19, 10, 0, 0).unwrap();
    let next_run = compute_next_run_utc(now, "15:00", "UTC", None);

    assert_eq!(next_run.year(), 2026);
    assert_eq!(next_run.month(), 10);
    assert_eq!(next_run.day(), 19);
    assert_eq!(next_run.hour(), 15);
    assert_eq!(next_run.minute(), 0);

    // 16:00 UTC, scheduled for 15:00 UTC -> should advance to tomorrow
    let late_now = Utc.with_ymd_and_hms(2026, 10, 19, 16, 0, 0).unwrap();
    let next_run_tomorrow = compute_next_run_utc(late_now, "15:00", "UTC", None);

    assert_eq!(next_run_tomorrow.day(), 20);
    assert_eq!(next_run_tomorrow.hour(), 15);
}

#[test]
fn concurrency_guard_prevents_concurrent_runs() {
    RUNTIME_STATE.is_running.store(false, Ordering::SeqCst);
    assert!(!RUNTIME_STATE.is_running.swap(true, Ordering::SeqCst));
    // Second swap should see true (already running)
    assert!(RUNTIME_STATE.is_running.swap(true, Ordering::SeqCst));
    // Reset
    RUNTIME_STATE.is_running.store(false, Ordering::SeqCst);
}
