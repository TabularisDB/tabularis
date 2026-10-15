use super::binary::is_binary_string_type;
use super::geometry::is_geometry_type;
use super::resolve_effective_type;
use super::temporal::{format_mysql_datetime, normalize_mysql_datetime_string};
use chrono::NaiveDate;

#[test]
fn resolve_effective_type_prefers_known_type() {
    assert_eq!(resolve_effective_type("varchar", Some("json")), "JSON");
}

#[test]
fn resolve_effective_type_falls_back_to_column_type() {
    assert_eq!(resolve_effective_type("varchar", None), "VARCHAR");
}

#[test]
fn normalize_mysql_datetime_string_with_fractional_seconds() {
    assert_eq!(
        normalize_mysql_datetime_string("2026-04-15T12:34:56.789"),
        Some("2026-04-15 12:34:56.789".to_string())
    );
}

#[test]
fn normalize_mysql_datetime_string_without_fractional_seconds() {
    assert_eq!(
        normalize_mysql_datetime_string("2026-04-15T12:34:56"),
        Some("2026-04-15 12:34:56".to_string())
    );
}

#[test]
fn format_mysql_datetime_keeps_fractional_seconds() {
    let value = NaiveDate::from_ymd_opt(2026, 3, 1)
        .unwrap()
        .and_hms_milli_opt(10, 0, 0, 500)
        .unwrap();
    assert_eq!(format_mysql_datetime(&value), "2026-03-01 10:00:00.500");

    let value = NaiveDate::from_ymd_opt(2026, 3, 1)
        .unwrap()
        .and_hms_micro_opt(10, 0, 0, 123_456)
        .unwrap();
    assert_eq!(format_mysql_datetime(&value), "2026-03-01 10:00:00.123456");
}

#[test]
fn format_mysql_datetime_without_fractional_seconds() {
    let value = NaiveDate::from_ymd_opt(2026, 3, 1)
        .unwrap()
        .and_hms_opt(10, 0, 0)
        .unwrap();
    assert_eq!(format_mysql_datetime(&value), "2026-03-01 10:00:00");
}

#[test]
fn normalize_mysql_datetime_string_returns_none_for_non_iso_input() {
    assert_eq!(normalize_mysql_datetime_string("2026/04/15 12:34:56"), None);
}

#[test]
fn detects_binary_string_types() {
    assert!(is_binary_string_type("VARBINARY"));
    assert!(is_binary_string_type("BINARY"));
    assert!(!is_binary_string_type("LONGBLOB"));
}

#[test]
fn detects_geometry_types() {
    assert!(is_geometry_type("GEOMETRY"));
    assert!(is_geometry_type("POINT"));
    assert!(is_geometry_type("MULTIPOLYGON"));
    assert!(!is_geometry_type("VARCHAR"));
}
