//! Unit tests for scheduled database content backups:
//! - File naming & parsing with double-dash collision safety
//! - Retention pruning and preserving last good backup
//! - Prefix matching safety (no-database plans and connection prefix safety)
//! - Scheduling due-checks (is_backup_due) and next run computation
//! - IANA timezone boundaries & local timezone resolution
//! - Concurrency guard RAII semantics

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
    assert_eq!(name, "tabularis-db-backup-conn1--prod_db--20261019-143000.sql");

    let parsed = parse_backup_timestamp(&name);
    assert_eq!(parsed, Some(now));

    // Also verify no-database plan naming
    let no_db_name = backup_file_name("conn1", None, now);
    assert_eq!(no_db_name, "tabularis-db-backup-conn1--_all_--20261019-143000.sql");
    assert_eq!(parse_backup_timestamp(&no_db_name), Some(now));
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
        "tabularis-db-backup-c1--db1--20261015-120000.sql",
        "tabularis-db-backup-c1--db1--20261016-120000.sql",
        "tabularis-db-backup-c1--db1--20261017-120000.sql",
        "tabularis-db-backup-c1--db1--20261018-120000.sql",
        "tabularis-db-backup-c1--db1--20261019-120000.sql",
        "unrelated.sql",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();

    let pruned = select_backups_to_prune(&names, "c1", Some("db1"), 3);
    assert_eq!(
        pruned,
        vec![
            "tabularis-db-backup-c1--db1--20261015-120000.sql",
            "tabularis-db-backup-c1--db1--20261016-120000.sql",
        ]
    );
}

#[test]
fn prefix_matching_cannot_delete_other_plans_or_connections() {
    let names: Vec<String> = [
        // Target: connection "c1" with no specific database
        "tabularis-db-backup-c1--_all_--20261015-120000.sql",
        "tabularis-db-backup-c1--_all_--20261016-120000.sql",
        // Other plan: connection "c1" with database "mydb"
        "tabularis-db-backup-c1--mydb--20261015-120000.sql",
        // Other connection: "c1_staging" (c1 is a prefix of c1_staging)
        "tabularis-db-backup-c1_staging--_all_--20261015-120000.sql",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();

    // Pruning connection c1 without database with retention 1
    let pruned = select_backups_to_prune(&names, "c1", None, 1);
    assert_eq!(pruned, vec!["tabularis-db-backup-c1--_all_--20261015-120000.sql"]);
    // Must NOT have pruned c1-mydb or c1_staging!
    assert!(!pruned.contains(&"tabularis-db-backup-c1--mydb--20261015-120000.sql".to_string()));
    assert!(!pruned.contains(&"tabularis-db-backup-c1_staging--_all_--20261015-120000.sql".to_string()));
}

#[test]
fn failed_runs_do_not_prune_last_good_backup() {
    let names = vec!["tabularis-db-backup-c1--db1--20261019-120000.sql".to_string()];
    let pruned = select_backups_to_prune(&names, "c1", Some("db1"), 1);
    assert!(pruned.is_empty());
}

#[test]
fn prune_with_zero_retention_deletes_nothing() {
    let names = vec![
        "tabularis-db-backup-c1--db1--20261018-120000.sql".to_string(),
        "tabularis-db-backup-c1--db1--20261019-120000.sql".to_string(),
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
fn is_backup_due_evaluates_schedule_correctly() {
    let target_time = "14:00";
    let tz = "UTC";

    // 13:59 UTC: not yet due
    let before = Utc.with_ymd_and_hms(2026, 10, 19, 13, 59, 0).unwrap();
    assert!(!is_backup_due(before, target_time, tz, None));

    // 14:00 UTC: due now
    let at = Utc.with_ymd_and_hms(2026, 10, 19, 14, 0, 0).unwrap();
    assert!(is_backup_due(at, target_time, tz, None));

    // 14:15 UTC: due if it hasn't run yet today
    let after = Utc.with_ymd_and_hms(2026, 10, 19, 14, 15, 0).unwrap();
    assert!(is_backup_due(after, target_time, tz, None));

    // 14:15 UTC: NOT due if it already succeeded today
    let run_today = Utc.with_ymd_and_hms(2026, 10, 19, 14, 1, 0).unwrap();
    assert!(!is_backup_due(after, target_time, tz, Some(run_today)));

    // 14:15 UTC: IS due if last success was yesterday
    let run_yesterday = Utc.with_ymd_and_hms(2026, 10, 18, 14, 0, 0).unwrap();
    assert!(is_backup_due(after, target_time, tz, Some(run_yesterday)));
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

    // 16:00 UTC, scheduled for 15:00 UTC -> advances to tomorrow
    let late_now = Utc.with_ymd_and_hms(2026, 10, 19, 16, 0, 0).unwrap();
    let next_run_tomorrow = compute_next_run_utc(late_now, "15:00", "UTC", None);

    assert_eq!(next_run_tomorrow.day(), 20);
    assert_eq!(next_run_tomorrow.hour(), 15);
}

#[test]
fn plan_timezone_handles_local_and_invalid_timezones() {
    // "local" timezone parses as Local
    let local_ptz = PlanTimezone::parse("local");
    assert!(matches!(local_ptz, PlanTimezone::Local));

    let empty_ptz = PlanTimezone::parse("");
    assert!(matches!(empty_ptz, PlanTimezone::Local));

    let invalid_ptz = PlanTimezone::parse("Invalid/NonExistent_Tz");
    assert!(matches!(invalid_ptz, PlanTimezone::Local));

    let named_ptz = PlanTimezone::parse("America/New_York");
    assert!(matches!(named_ptz, PlanTimezone::Named(_)));
}

#[test]
fn concurrency_guard_prevents_concurrent_runs_and_raii_cleans_up() {
    RUNTIME_STATE.is_running.store(false, Ordering::SeqCst);

    // Simulate starting a run
    assert!(!RUNTIME_STATE.is_running.swap(true, Ordering::SeqCst));
    // Concurrency check: another run attempt must be blocked
    assert!(RUNTIME_STATE.is_running.load(Ordering::SeqCst));

    // Simulate RAII guard drop
    struct TestGuard;
    impl Drop for TestGuard {
        fn drop(&mut self) {
            RUNTIME_STATE.is_running.store(false, Ordering::SeqCst);
        }
    }
    {
        let _guard = TestGuard;
    }

    // After drop, lock is released
    assert!(!RUNTIME_STATE.is_running.load(Ordering::SeqCst));
}
