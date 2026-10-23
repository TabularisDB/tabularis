//! Unit tests for scheduled database content backups:
//! - File naming & parsing with double-dash collision safety
//! - Retention pruning and preserving last good backup
//! - Prefix matching safety (no-database plans and connection prefix safety)
//! - Scheduling due-checks (is_backup_due) and next run computation
//! - IANA timezone boundaries, DST gaps/folds & local timezone resolution
//! - Retry delay after a failed attempt and the reported next run
//! - Non-concurrency through the real run guard
//! - Cancellation and unavailable credentials through a full backup attempt

use super::*;
use crate::commands::AbortHandleMap;
use crate::dump_commands::{abort_slot, await_cancellable_dump};
use chrono::{Datelike, Duration, NaiveDate, NaiveDateTime, TimeZone, Timelike, Utc};
use std::sync::Arc;
use tokio::sync::oneshot;

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
    assert_eq!(
        name,
        "tabularis-db-backup-conn1--prod_db--20261019-143000.sql"
    );

    let parsed = parse_backup_timestamp(&name);
    assert_eq!(parsed, Some(now));

    // Also verify no-database plan naming
    let no_db_name = backup_file_name("conn1", None, now);
    assert_eq!(
        no_db_name,
        "tabularis-db-backup-conn1--_all_--20261019-143000.sql"
    );
    assert_eq!(parse_backup_timestamp(&no_db_name), Some(now));
}

#[test]
fn parse_rejects_foreign_files() {
    assert_eq!(
        parse_backup_timestamp("tabularis-backup-20261019-120000.json"),
        None
    );
    assert_eq!(parse_backup_timestamp("notes.txt"), None);
    assert_eq!(parse_backup_timestamp("corrupt.sql"), None);
    assert_eq!(
        parse_backup_timestamp("tabularis-db-backup-short.sql"),
        None
    );
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
    assert_eq!(
        pruned,
        vec!["tabularis-db-backup-c1--_all_--20261015-120000.sql"]
    );
    // Must NOT have pruned c1-mydb or c1_staging!
    assert!(!pruned.contains(&"tabularis-db-backup-c1--mydb--20261015-120000.sql".to_string()));
    assert!(
        !pruned.contains(&"tabularis-db-backup-c1_staging--_all_--20261015-120000.sql".to_string())
    );
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
fn dst_gap_moves_the_run_one_hour_later() {
    // 2026-03-08: New York clocks jump 02:00 EST -> 03:00 EDT, 02:30 does not exist.
    let tz = "America/New_York";
    let before = Utc.with_ymd_and_hms(2026, 3, 8, 6, 0, 0).unwrap(); // 01:00 EST
    let next = compute_next_run_utc(before, "02:30", tz, None);
    // 03:30 EDT == 07:30 UTC
    assert_eq!(next, Utc.with_ymd_and_hms(2026, 3, 8, 7, 30, 0).unwrap());

    assert!(!is_backup_due(
        next - Duration::minutes(1),
        "02:30",
        tz,
        None
    ));
    assert!(is_backup_due(next, "02:30", tz, None));
}

#[test]
fn dst_fold_runs_once_at_the_first_occurrence() {
    // 2026-11-01: New York clocks fall back 02:00 EDT -> 01:00 EST, 01:30 happens twice.
    let tz = "America/New_York";
    let first = Utc.with_ymd_and_hms(2026, 11, 1, 5, 30, 0).unwrap(); // 01:30 EDT
    let second = Utc.with_ymd_and_hms(2026, 11, 1, 6, 30, 0).unwrap(); // 01:30 EST

    let before = Utc.with_ymd_and_hms(2026, 11, 1, 4, 0, 0).unwrap();
    assert_eq!(compute_next_run_utc(before, "01:30", tz, None), first);
    assert!(is_backup_due(first, "01:30", tz, None));

    // After running at the first 01:30 it is not due again at the second one,
    // and the next run is the following day (EST, UTC-5).
    assert!(!is_backup_due(second, "01:30", tz, Some(first)));
    assert_eq!(
        compute_next_run_utc(second, "01:30", tz, Some(first)),
        Utc.with_ymd_and_hms(2026, 11, 2, 6, 30, 0).unwrap()
    );
}

#[test]
fn schedule_day_follows_the_plan_timezone_not_utc() {
    // 08:00 in Tokyo (UTC+9) is 23:00 UTC on the previous calendar day.
    let tz = "Asia/Tokyo";
    let now = Utc.with_ymd_and_hms(2026, 10, 19, 23, 5, 0).unwrap(); // 2026-10-20 08:05 JST
    assert!(is_backup_due(now, "08:00", tz, None));

    // A success at 08:01 JST on the 20th (still the 19th in UTC) counts as today.
    let ran = Utc.with_ymd_and_hms(2026, 10, 19, 23, 1, 0).unwrap();
    assert!(!is_backup_due(now, "08:00", tz, Some(ran)));

    // A success on the 19th in Tokyo does not.
    let ran_yesterday = Utc.with_ymd_and_hms(2026, 10, 18, 23, 1, 0).unwrap();
    assert!(is_backup_due(now, "08:00", tz, Some(ran_yesterday)));
}

#[test]
fn next_attempt_reports_retry_delay_and_immediate_runs() {
    let tz = "UTC";
    let now = Utc.with_ymd_and_hms(2026, 10, 19, 14, 20, 0).unwrap();
    let yesterday = Utc.with_ymd_and_hms(2026, 10, 18, 14, 0, 0).unwrap();

    // Due and nothing failed: the scheduler starts it on its next tick.
    assert_eq!(
        next_attempt_utc(now, "14:00", tz, Some(yesterday), None),
        now
    );

    // Due but failed 5 minutes ago: retried once the delay has passed.
    let failed = now - Duration::minutes(5);
    assert!(is_retry_blocked(now, Some(failed)));
    assert_eq!(
        next_attempt_utc(now, "14:00", tz, Some(yesterday), Some(failed)),
        failed + RETRY_AFTER_FAILURE
    );

    // An old failure no longer delays it.
    let old_failure = now - Duration::hours(1);
    assert!(!is_retry_blocked(now, Some(old_failure)));
    assert_eq!(
        next_attempt_utc(now, "14:00", tz, Some(yesterday), Some(old_failure)),
        now
    );

    // Already succeeded today: next run is tomorrow regardless of failures.
    let today = Utc.with_ymd_and_hms(2026, 10, 19, 14, 1, 0).unwrap();
    assert_eq!(
        next_attempt_utc(now, "14:00", tz, Some(today), Some(failed)),
        Utc.with_ymd_and_hms(2026, 10, 20, 14, 0, 0).unwrap()
    );
}

// ---------- Run guard ----------

#[test]
fn run_guard_admits_one_holder_across_threads() {
    let flag = Arc::new(AtomicBool::new(false));
    let barrier = Arc::new(std::sync::Barrier::new(8));
    let acquired: Vec<bool> = (0..8)
        .map(|_| {
            let flag = flag.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                // Hold the guard until every thread has tried.
                let guard = RunGuard::acquire(&flag);
                barrier.wait();
                guard.is_some()
            })
        })
        .collect::<Vec<_>>()
        .into_iter()
        .map(|h| h.join().unwrap())
        .collect();

    assert_eq!(acquired.iter().filter(|a| **a).count(), 1);
    assert!(!flag.load(Ordering::SeqCst), "guard drop releases the flag");
}

#[tokio::test]
async fn run_exclusive_rejects_a_second_run_until_the_first_finishes() {
    let flag = AtomicBool::new(false);
    let (release, wait) = oneshot::channel::<()>();

    let first = run_exclusive(&flag, || async move {
        wait.await.unwrap();
        Ok::<_, String>("first")
    });
    tokio::pin!(first);

    // Drive the first run until it is parked inside the guard.
    assert!(futures::poll!(first.as_mut()).is_pending());
    assert!(flag.load(Ordering::SeqCst));

    let second = run_exclusive(&flag, || async { Ok::<_, String>("second") }).await;
    assert_eq!(second, Err(ALREADY_RUNNING.to_string()));

    release.send(()).unwrap();
    assert_eq!(first.await, Ok("first"));

    let third = run_exclusive(&flag, || async { Ok::<_, String>("third") }).await;
    assert_eq!(third, Ok("third"));
}

#[tokio::test]
async fn run_exclusive_releases_the_flag_when_the_run_is_dropped() {
    let flag = AtomicBool::new(false);
    {
        let run = run_exclusive(&flag, std::future::pending::<Result<(), String>>);
        tokio::pin!(run);
        assert!(futures::poll!(run.as_mut()).is_pending());
        assert!(flag.load(Ordering::SeqCst));
    }
    assert!(!flag.load(Ordering::SeqCst));
}

// ---------- Full backup attempts ----------

fn plan_for(dir: &Path, retention: u32) -> DatabaseBackupPlan {
    DatabaseBackupPlan {
        enabled: true,
        connection_id: "conn".into(),
        database: Some("prod".into()),
        schema: None,
        time: "02:00".into(),
        timezone: "UTC".into(),
        destination_directory: dir.display().to_string(),
        retention,
        include_structure: true,
        include_data: true,
        tables: None,
    }
}

/// Two earlier good backups of the plan, oldest first.
fn seed_good_backups(dir: &Path) -> Vec<String> {
    let names: Vec<String> = [ts(2026, 10, 17, 2, 0), ts(2026, 10, 18, 2, 0)]
        .into_iter()
        .map(|t| backup_file_name("conn", Some("prod"), t))
        .collect();
    for n in &names {
        fs::write(dir.join(n), "-- good backup").unwrap();
    }
    names
}

fn sorted_files(dir: &Path) -> Vec<String> {
    let mut files = list_directory_files(dir);
    files.sort();
    files
}

#[tokio::test]
async fn successful_run_writes_the_backup_and_prunes_beyond_retention() {
    let dir = tempfile::tempdir().unwrap();
    let old = seed_good_backups(dir.path());
    let now = Utc.with_ymd_and_hms(2026, 10, 19, 2, 0, 0).unwrap();

    let report = execute_backup(
        dir.path(),
        &plan_for(dir.path(), 2),
        now,
        &AtomicBool::new(false),
        |target| async move { fs::write(target, "-- new").map_err(|e| e.to_string()) },
    )
    .await;

    assert_eq!(report.outcome, BackupOutcome::Success);
    let new_name = backup_file_name("conn", Some("prod"), now.naive_utc());
    assert_eq!(
        report.file,
        Some(dir.path().join(&new_name).display().to_string())
    );
    assert_eq!(report.pruned, vec![old[0].clone()]);
    assert_eq!(sorted_files(dir.path()), vec![old[1].clone(), new_name]);
}

#[tokio::test]
async fn cancelled_run_removes_the_partial_file_and_keeps_good_backups() {
    let dir = tempfile::tempdir().unwrap();
    let good = seed_good_backups(dir.path());
    let handles: Arc<std::sync::Mutex<AbortHandleMap>> = Arc::default();
    let slot = crate::dump_commands::db_backup_slot_key("conn");
    let (started_tx, started_rx) = oneshot::channel::<()>();

    // The same cancellation path as a real backup: the dump runs as a task
    // registered under the backup slot, and cancelling aborts that slot.
    let plan = plan_for(dir.path(), 1);
    let not_requested = AtomicBool::new(false);
    let run = execute_backup(
        dir.path(),
        &plan,
        Utc.with_ymd_and_hms(2026, 10, 19, 2, 0, 0).unwrap(),
        &not_requested,
        |target| {
            let task = tokio::spawn(async move {
                fs::write(&target, "-- Tabularis Dump\n-- partial").map_err(|e| e.to_string())?;
                started_tx.send(()).unwrap();
                std::future::pending::<()>().await;
                Ok(())
            });
            await_cancellable_dump(&handles, slot.clone(), task, None)
        },
    );
    let cancel = async {
        started_rx.await.unwrap();
        assert!(abort_slot(&handles, &slot));
    };
    let (report, ()) = tokio::join!(run, cancel);

    assert_eq!(report.outcome, BackupOutcome::Cancelled);
    assert_eq!(report.error.as_deref(), Some(DUMP_CANCELLED));
    assert!(report.pruned.is_empty());
    assert_eq!(
        sorted_files(dir.path()),
        good,
        "partial file removed, retention untouched"
    );
    assert!(handles.lock().unwrap().is_empty(), "slot unregistered");
    assert!(!abort_slot(&handles, &slot), "nothing left to cancel");
}

#[tokio::test]
async fn cancel_request_classifies_a_dump_error_as_cancelled() {
    let dir = tempfile::tempdir().unwrap();
    let report = execute_backup(
        dir.path(),
        &plan_for(dir.path(), 7),
        Utc::now(),
        &AtomicBool::new(true),
        |_| async { Err("connection reset by peer".to_string()) },
    )
    .await;
    assert_eq!(report.outcome, BackupOutcome::Cancelled);
}

#[tokio::test]
async fn unavailable_credentials_fail_without_touching_good_backups() {
    let dir = tempfile::tempdir().unwrap();
    let good = seed_good_backups(dir.path());
    // An SSH-tunnelled connection whose SSH credentials are gone.
    let params = crate::models::ConnectionParams {
        driver: "postgres".into(),
        host: Some("db.internal".into()),
        ssh_enabled: Some(true),
        ssh_host: Some("bastion.example".into()),
        ssh_user: None,
        ..Default::default()
    };

    // The dump resolves credentials first, exactly like `dump_database_with_handles`.
    let report = execute_backup(
        dir.path(),
        &plan_for(dir.path(), 1),
        Utc.with_ymd_and_hms(2026, 10, 19, 2, 0, 0).unwrap(),
        &AtomicBool::new(false),
        |target| async move {
            crate::commands::resolve_connection_params_with_id(&params, "conn")?;
            fs::write(target, "-- unreachable").map_err(|e| e.to_string())
        },
    )
    .await;

    assert_eq!(report.outcome, BackupOutcome::Error);
    assert_eq!(report.error.as_deref(), Some("Missing SSH User"));
    assert!(report.file.is_none());
    assert!(
        report.pruned.is_empty(),
        "retention 1 must not prune after a failure"
    );
    assert_eq!(sorted_files(dir.path()), good);
}

#[tokio::test]
async fn error_mentioning_cancel_is_not_a_cancellation() {
    let dir = tempfile::tempdir().unwrap();
    let report = execute_backup(
        dir.path(),
        &plan_for(dir.path(), 7),
        Utc::now(),
        &AtomicBool::new(false),
        |_| async { Err("statement cancelled by the server".to_string()) },
    )
    .await;
    assert_eq!(report.outcome, BackupOutcome::Error);
}

// ---------- Cancellation and per-plan state ----------

#[test]
fn cancelling_after_the_daily_time_settles_the_slot_until_tomorrow() {
    let tz = "UTC";
    let cancelled = Utc.with_ymd_and_hms(2026, 10, 19, 2, 5, 0).unwrap();
    let settled = slot_settled_at("02:00", tz, None, Some(cancelled));
    assert_eq!(settled, Some(cancelled));

    // No restart later today, even though nothing succeeded.
    let later_today = Utc.with_ymd_and_hms(2026, 10, 19, 2, 30, 0).unwrap();
    assert!(!is_backup_due(later_today, "02:00", tz, settled));
    assert_eq!(
        next_attempt_utc(later_today, "02:00", tz, settled, None),
        Utc.with_ymd_and_hms(2026, 10, 20, 2, 0, 0).unwrap()
    );

    // The next daily slot runs as usual.
    let tomorrow = Utc.with_ymd_and_hms(2026, 10, 20, 2, 0, 30).unwrap();
    assert!(is_backup_due(tomorrow, "02:00", tz, settled));
}

#[test]
fn cancelling_before_the_daily_time_leaves_the_slot_open() {
    let tz = "UTC";
    // An early manual run, cancelled before 02:00.
    let cancelled = Utc.with_ymd_and_hms(2026, 10, 19, 1, 30, 0).unwrap();
    assert_eq!(slot_settled_at("02:00", tz, None, Some(cancelled)), None);

    let at_slot = Utc.with_ymd_and_hms(2026, 10, 19, 2, 0, 30).unwrap();
    let settled = slot_settled_at("02:00", tz, None, Some(cancelled));
    assert!(is_backup_due(at_slot, "02:00", tz, settled));
}

#[test]
fn slot_settled_at_takes_the_later_of_success_and_cancellation() {
    let tz = "UTC";
    let success = Utc.with_ymd_and_hms(2026, 10, 18, 2, 1, 0).unwrap();
    let cancelled = Utc.with_ymd_and_hms(2026, 10, 19, 2, 5, 0).unwrap();
    assert_eq!(
        slot_settled_at("02:00", tz, Some(success), Some(cancelled)),
        Some(cancelled)
    );
    assert_eq!(
        slot_settled_at("02:00", tz, Some(success), None),
        Some(success)
    );
}

#[test]
fn record_report_keeps_cancellations_out_of_the_retry_delay() {
    // A key no other test uses, since the runtime state is shared.
    let key = "record-report-test\nprod\n/backups";
    let report = |outcome| BackupRunReport {
        outcome,
        file: None,
        error: Some("x".into()),
        pruned: Vec::new(),
    };
    let at = Utc.with_ymd_and_hms(2026, 10, 19, 2, 5, 0).unwrap();

    record_report(key, &report(BackupOutcome::Cancelled), at);
    assert_eq!(
        entry_for(&RUNTIME_STATE.last_cancelled_at.lock().unwrap(), key),
        Some(at)
    );
    assert_eq!(
        entry_for(&RUNTIME_STATE.last_failure_attempt_at.lock().unwrap(), key),
        None,
        "a cancellation does not schedule a retry"
    );

    let failed_at = at + Duration::minutes(1);
    record_report(key, &report(BackupOutcome::Error), failed_at);
    assert_eq!(
        entry_for(&RUNTIME_STATE.last_failure_attempt_at.lock().unwrap(), key),
        Some(failed_at)
    );
}

#[test]
fn runs_recorded_for_another_plan_do_not_count() {
    let dir = tempfile::tempdir().unwrap();
    let plan = plan_for(dir.path(), 7);
    let at = Utc.with_ymd_and_hms(2026, 10, 19, 2, 1, 0).unwrap();
    let recorded = Some((plan_key(&plan), at));
    assert_eq!(entry_for(&recorded, &plan_key(&plan)), Some(at));

    let other_connection = DatabaseBackupPlan {
        connection_id: "other".into(),
        ..plan.clone()
    };
    let other_database = DatabaseBackupPlan {
        database: Some("staging".into()),
        ..plan.clone()
    };
    let other_destination = DatabaseBackupPlan {
        destination_directory: "/elsewhere".into(),
        ..plan.clone()
    };
    for other in [&other_connection, &other_database, &other_destination] {
        assert_ne!(plan_key(other), plan_key(&plan));
        assert_eq!(entry_for(&recorded, &plan_key(other)), None);
    }
}

#[test]
fn last_success_follows_the_plan_destination_on_disk() {
    let with_backups = tempfile::tempdir().unwrap();
    let empty = tempfile::tempdir().unwrap();
    let good = seed_good_backups(with_backups.path());

    let plan = plan_for(with_backups.path(), 7);
    let (at, file) = last_success_for(&plan, None).expect("newest backup on disk");
    assert_eq!(at, Utc.with_ymd_and_hms(2026, 10, 18, 2, 0, 0).unwrap());
    assert_eq!(
        file,
        with_backups.path().join(&good[1]).display().to_string()
    );

    // Pointing the plan at another folder drops the old folder's backups.
    assert_eq!(last_success_for(&plan_for(empty.path(), 7), None), None);

    // A newer run recorded in this session wins over the files on disk.
    let newer = (
        Utc.with_ymd_and_hms(2026, 10, 19, 2, 1, 0).unwrap(),
        "recorded.sql".to_string(),
    );
    assert_eq!(last_success_for(&plan, Some(newer.clone())), Some(newer));
}

#[tokio::test]
async fn a_cancel_before_the_dump_is_registered_still_stops_it() {
    let handles: Arc<std::sync::Mutex<AbortHandleMap>> = Arc::default();
    let slot = crate::dump_commands::db_backup_slot_key("conn");
    // The cancel arrived while the dump was still being set up, so there was
    // nothing to abort yet and only the flag is set.
    let cancel_requested = AtomicBool::new(true);
    assert!(!abort_slot(&handles, &slot));

    let task = tokio::spawn(std::future::pending::<Result<(), String>>());
    let result =
        await_cancellable_dump(&handles, slot.clone(), task, Some(&cancel_requested)).await;

    assert_eq!(result, Err(DUMP_CANCELLED.to_string()));
    assert!(handles.lock().unwrap().is_empty(), "slot unregistered");
}

#[tokio::test]
async fn unfinished_backups_are_never_discovered_and_are_removed_on_future_drop() {
    let dir = tempfile::tempdir().unwrap();
    let plan = plan_for(dir.path(), 7);
    let cancel = AtomicBool::new(false);
    let now = Utc.with_ymd_and_hms(2026, 10, 22, 3, 0, 0).unwrap();
    let mut attempt = Box::pin(execute_backup(dir.path(), &plan, now, &cancel, |target| async move {
        std::fs::write(target, "-- incomplete dump").unwrap();
        std::future::pending::<Result<(), String>>().await
    }));
    assert!(futures::poll!(&mut attempt).is_pending());
    assert!(last_success_for(&plan, None).is_none());
    drop(attempt);
    assert!(list_directory_files(dir.path()).is_empty());
}
