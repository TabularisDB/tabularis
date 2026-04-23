//! Pure formatters for SQL Server temporal types.
//!
//! All functions here take a `chrono` value and return a `String`. They do
//! **not** touch tiberius — the row-level extraction lives in
//! [`super::extract_value`], which calls into these helpers after pulling the
//! right chrono type out of the row.
//!
//! Format choices mirror the existing Tabularis drivers (MySQL / PostgreSQL)
//! so the UI doesn't have to switch on the source driver:
//!
//! | SQL Server type   | chrono type                    | Output format                     |
//! |-------------------|--------------------------------|-----------------------------------|
//! | `date`            | `NaiveDate`                    | `YYYY-MM-DD`                      |
//! | `time`            | `NaiveTime`                    | `HH:MM:SS` or `HH:MM:SS.fff`      |
//! | `datetime`        | `NaiveDateTime`                | `YYYY-MM-DD HH:MM:SS`             |
//! | `datetime2`       | `NaiveDateTime`                | `YYYY-MM-DD HH:MM:SS` or `.fff`   |
//! | `smalldatetime`   | `NaiveDateTime`                | `YYYY-MM-DD HH:MM:SS`             |
//! | `datetimeoffset`  | `DateTime<FixedOffset>`        | RFC3339 (`YYYY-MM-DDTHH:MM:SS+00:00`) |

use chrono::{DateTime, FixedOffset, NaiveDate, NaiveDateTime, NaiveTime, Timelike};

pub fn format_date(d: &NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

/// Format a `NaiveTime`. Includes a fractional-second suffix (up to 7 digits,
/// SQL Server's resolution for `time(7)`) only when it is non-zero, so
/// `time(0)` columns don't grow an unnecessary `.0000000`.
pub fn format_time(t: &NaiveTime) -> String {
    if t.nanosecond() == 0 {
        t.format("%H:%M:%S").to_string()
    } else {
        let full = t.format("%H:%M:%S%.f").to_string();
        trim_fractional_trailing_zeros(&full)
    }
}

/// Format a `NaiveDateTime`. Same fractional-second policy as [`format_time`].
pub fn format_datetime(dt: &NaiveDateTime) -> String {
    if dt.nanosecond() == 0 {
        dt.format("%Y-%m-%d %H:%M:%S").to_string()
    } else {
        let full = dt.format("%Y-%m-%d %H:%M:%S%.f").to_string();
        trim_fractional_trailing_zeros(&full)
    }
}

/// Format a `DateTime<FixedOffset>` as RFC3339 with fractional seconds when
/// present. `datetimeoffset` is the only SQL Server temporal type that
/// carries a zone; we keep the zone explicit so round-tripping is safe.
pub fn format_datetime_offset(dt: &DateTime<FixedOffset>) -> String {
    // chrono's `to_rfc3339` keeps fractional seconds if present, and always
    // emits the zone. Both desirable.
    dt.to_rfc3339()
}

/// Remove trailing `0` characters from the fractional-seconds portion of a
/// timestamp string, and drop the `.` entirely if no fraction remains.
///
/// `"12:34:56.5000000"` -> `"12:34:56.5"`, `"12:34:56.0000000"` -> `"12:34:56"`.
fn trim_fractional_trailing_zeros(s: &str) -> String {
    // Find the last '.' after the last ':' (or start) to localise the fraction.
    let Some(dot_idx) = s.rfind('.') else {
        return s.to_string();
    };
    // Ensure the `.` belongs to the fractional-seconds tail (no TZ or space after).
    let frac = &s[dot_idx + 1..];
    if !frac.chars().all(|c| c.is_ascii_digit()) {
        return s.to_string();
    }
    let trimmed = frac.trim_end_matches('0');
    if trimmed.is_empty() {
        s[..dot_idx].to_string()
    } else {
        format!("{}.{}", &s[..dot_idx], trimmed)
    }
}

#[cfg(test)]
mod tests {
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
}
