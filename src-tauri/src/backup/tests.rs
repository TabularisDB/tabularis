//! Unit tests for the pure helpers of the automatic backup module: file
//! naming, timestamp parsing, rotation selection and due-time computation.
//! Keychain, filesystem and scheduler behaviour are exercised manually.

use super::*;
use chrono::NaiveDate;

fn ts(y: i32, m: u32, d: u32, h: u32, min: u32) -> NaiveDateTime {
    NaiveDate::from_ymd_opt(y, m, d)
        .unwrap()
        .and_hms_opt(h, min, 0)
        .unwrap()
}

#[test]
fn file_name_round_trips_through_parse() {
    let now = ts(2026, 7, 13, 18, 30);
    let name = backup_file_name(now);
    assert_eq!(name, "tabularis-backup-20260713-183000.json");
    assert_eq!(parse_backup_timestamp(&name), Some(now));
}

#[test]
fn parse_rejects_foreign_files() {
    assert_eq!(parse_backup_timestamp("notes.txt"), None);
    assert_eq!(parse_backup_timestamp("tabularis-backup-garbage.json"), None);
    assert_eq!(parse_backup_timestamp("tabularis-connections.json"), None);
}

#[test]
fn prune_keeps_the_newest_files_and_ignores_foreign_ones() {
    let names: Vec<String> = [
        "tabularis-backup-20260710-120000.json",
        "tabularis-backup-20260712-120000.json",
        "tabularis-backup-20260711-120000.json",
        "unrelated.json",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    let pruned = select_backups_to_prune(&names, 2);
    assert_eq!(pruned, vec!["tabularis-backup-20260710-120000.json"]);
}

#[test]
fn prune_returns_nothing_when_under_retention() {
    let names = vec!["tabularis-backup-20260710-120000.json".to_string()];
    assert!(select_backups_to_prune(&names, 2).is_empty());
}

#[test]
fn prune_with_zero_retention_deletes_nothing() {
    // Retention 0 would be a misconfiguration; deleting every backup right
    // after writing one is never what the user wants.
    let names = vec![
        "tabularis-backup-20260710-120000.json".to_string(),
        "tabularis-backup-20260711-120000.json".to_string(),
    ];
    assert!(select_backups_to_prune(&names, 0).is_empty());
}

#[test]
fn webdav_listing_extracts_backup_names_only() {
    let xml = r#"<?xml version="1.0"?>
        <D:multistatus xmlns:D="DAV:">
          <D:response><D:href>/dav/backups/</D:href></D:response>
          <D:response><D:href>/dav/backups/tabularis-backup-20260713-120000.json</D:href></D:response>
          <D:response><D:href>/dav/backups/notes.txt</D:href></D:response>
          <D:response><D:href>/dav/backups/tabularis-backup-20260712-090000.json</D:href></D:response>
        </D:multistatus>"#;
    let names = parse_webdav_listing(xml);
    assert_eq!(
        names,
        vec![
            "tabularis-backup-20260713-120000.json",
            "tabularis-backup-20260712-090000.json",
        ]
    );
}

#[test]
fn webdav_listing_tolerates_garbage() {
    assert!(parse_webdav_listing("not xml at all").is_empty());
    assert!(parse_webdav_listing("<empty/>").is_empty());
}

#[test]
fn backup_is_due_without_previous_backup() {
    assert!(is_backup_due(None, ts(2026, 7, 13, 12, 0), 1440));
}

#[test]
fn backup_is_due_after_the_interval() {
    let newest = ts(2026, 7, 12, 11, 0);
    assert!(is_backup_due(Some(newest), ts(2026, 7, 13, 12, 0), 1440));
}

#[test]
fn backup_is_not_due_within_the_interval() {
    let newest = ts(2026, 7, 13, 6, 0);
    assert!(!is_backup_due(Some(newest), ts(2026, 7, 13, 12, 0), 1440));
}

#[test]
fn short_debug_intervals_are_checked_every_minute() {
    assert_eq!(scheduler_tick_secs(1), 60);
    assert_eq!(scheduler_tick_secs(2), 60);
}

#[test]
fn tick_scales_with_the_interval_up_to_a_cap() {
    // 60 min interval → check every 15 min.
    assert_eq!(scheduler_tick_secs(60), 900);
    // A day never checks more rarely than the 15-minute cap.
    assert_eq!(scheduler_tick_secs(1440), 900);
}
