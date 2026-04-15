use super::binary::is_binary_string_type;
use super::geometry::is_geometry_type;
use super::resolve_effective_type;
use super::temporal::normalize_mysql_datetime_string;

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
        Some("2026-04-15 12:34:56".to_string())
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
