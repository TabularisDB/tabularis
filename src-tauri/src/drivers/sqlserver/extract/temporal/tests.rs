use super::*;

fn date(y: i32, m: u32, d: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(y, m, d).unwrap()
}

fn time(h: u32, m: u32, s: u32, nano: u32) -> NaiveTime {
    NaiveTime::from_hms_nano_opt(h, m, s, nano).unwrap()
}

fn dt(y: i32, mo: u32, d: u32, h: u32, mi: u32, s: u32, nano: u32) -> NaiveDateTime {
    date(y, mo, d).and_time(time(h, mi, s, nano))
}

// --- format_date ------------------------------------------------------

#[test]
fn date_formats_iso_8601() {
    assert_eq!(format_date(&date(2026, 4, 23)), "2026-04-23");
    assert_eq!(format_date(&date(1999, 1, 1)), "1999-01-01");
}

// --- format_time ------------------------------------------------------

#[test]
fn time_without_fraction_has_no_dot() {
    assert_eq!(format_time(&time(12, 34, 56, 0)), "12:34:56");
    assert_eq!(format_time(&time(0, 0, 0, 0)), "00:00:00");
}

#[test]
fn time_with_fraction_trims_trailing_zeros() {
    // 500 ms -> .5
    assert_eq!(format_time(&time(12, 34, 56, 500_000_000)), "12:34:56.5");
    // 123456700 ns -> .1234567 (full 7-digit precision, no trailing zero)
    assert_eq!(
        format_time(&time(12, 34, 56, 123_456_700)),
        "12:34:56.1234567"
    );
    // 100000000 ns = 0.1 s
    assert_eq!(format_time(&time(0, 0, 0, 100_000_000)), "00:00:00.1");
}

// --- format_datetime ---------------------------------------------------

#[test]
fn datetime_without_fraction_matches_mysql_format() {
    assert_eq!(
        format_datetime(&dt(2026, 4, 23, 15, 30, 45, 0)),
        "2026-04-23 15:30:45"
    );
}

#[test]
fn datetime_with_fraction_trims_trailing_zeros() {
    assert_eq!(
        format_datetime(&dt(2026, 4, 23, 15, 30, 45, 500_000_000)),
        "2026-04-23 15:30:45.5"
    );
    assert_eq!(
        format_datetime(&dt(2026, 4, 23, 15, 30, 45, 1_234_000)),
        "2026-04-23 15:30:45.001234"
    );
}

#[test]
fn datetime_epoch_value() {
    assert_eq!(
        format_datetime(&dt(1970, 1, 1, 0, 0, 0, 0)),
        "1970-01-01 00:00:00"
    );
}

// --- format_datetime_offset -------------------------------------------

#[test]
fn datetime_offset_emits_rfc3339_with_zone() {
    let offset = FixedOffset::east_opt(2 * 3600).unwrap();
    let dt = dt(2026, 4, 23, 15, 30, 45, 0)
        .and_local_timezone(offset)
        .unwrap();
    assert_eq!(format_datetime_offset(&dt), "2026-04-23T15:30:45+02:00");
}

#[test]
fn datetime_offset_utc_has_plus_zero() {
    let offset = FixedOffset::east_opt(0).unwrap();
    let dt = dt(2026, 4, 23, 0, 0, 0, 0)
        .and_local_timezone(offset)
        .unwrap();
    assert_eq!(format_datetime_offset(&dt), "2026-04-23T00:00:00+00:00");
}

#[test]
fn datetime_offset_preserves_fractional_seconds() {
    let offset = FixedOffset::east_opt(0).unwrap();
    let dt = dt(2026, 4, 23, 12, 0, 0, 500_000_000)
        .and_local_timezone(offset)
        .unwrap();
    assert!(format_datetime_offset(&dt).starts_with("2026-04-23T12:00:00.5"));
}

#[test]
fn datetime_offset_negative_zone() {
    let offset = FixedOffset::west_opt(5 * 3600).unwrap();
    let dt = dt(2026, 4, 23, 9, 0, 0, 0)
        .and_local_timezone(offset)
        .unwrap();
    assert_eq!(format_datetime_offset(&dt), "2026-04-23T09:00:00-05:00");
}

// --- trim_fractional_trailing_zeros ------------------------------------

#[test]
fn trim_fractional_removes_trailing_zeros() {
    assert_eq!(
        trim_fractional_trailing_zeros("12:34:56.5000000"),
        "12:34:56.5"
    );
    assert_eq!(trim_fractional_trailing_zeros("12:34:56.100"), "12:34:56.1");
    assert_eq!(
        trim_fractional_trailing_zeros("2026-04-23 00:00:00.12300"),
        "2026-04-23 00:00:00.123"
    );
}

#[test]
fn trim_fractional_drops_empty_fraction_and_dot() {
    assert_eq!(
        trim_fractional_trailing_zeros("12:34:56.0000000"),
        "12:34:56"
    );
    assert_eq!(trim_fractional_trailing_zeros("12:34:56.0"), "12:34:56");
}

#[test]
fn trim_fractional_leaves_non_fraction_strings_alone() {
    assert_eq!(trim_fractional_trailing_zeros("12:34:56"), "12:34:56");
    assert_eq!(trim_fractional_trailing_zeros(""), "");
    assert_eq!(trim_fractional_trailing_zeros("no.dot"), "no.dot");
}

#[test]
fn trim_fractional_refuses_to_touch_zones() {
    // The `.` inside an RFC3339 fractional followed by a TZ marker is
    // handled by format_datetime_offset via chrono, not via this helper
    // — so `trim_fractional_trailing_zeros` should leave strings with a
    // trailing zone intact (non-digit chars after the dot → no-op).
    assert_eq!(
        trim_fractional_trailing_zeros("12:34:56.100+02:00"),
        "12:34:56.100+02:00"
    );
}
