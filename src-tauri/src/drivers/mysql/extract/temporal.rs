use chrono::{DateTime, NaiveDateTime, Utc};
use sqlx::Row;

pub(super) fn extract_temporal_value(
    row: &sqlx::mysql::MySqlRow,
    index: usize,
    effective_type: &str,
) -> Option<serde_json::Value> {
    if effective_type != "TIMESTAMP" && effective_type != "DATETIME" {
        return None;
    }

    if let Ok(value) = row.try_get::<NaiveDateTime, _>(index) {
        return Some(serde_json::Value::String(format_mysql_datetime(&value)));
    }

    if let Ok(value) = row.try_get::<DateTime<Utc>, _>(index) {
        return Some(serde_json::Value::String(format_mysql_datetime(
            &value.naive_utc(),
        )));
    }

    if let Ok(value) = row.try_get::<String, _>(index) {
        return Some(serde_json::Value::String(
            normalize_mysql_datetime_string(&value).unwrap_or(value),
        ));
    }

    if let Ok(value) = row.try_get::<i64, _>(index) {
        return Some(serde_json::Value::from(value));
    }

    None
}

pub(super) fn normalize_mysql_datetime_string(value: &str) -> Option<String> {
    if let Ok(dt) = NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S%.f") {
        return Some(format_mysql_datetime(&dt));
    }

    if let Ok(dt) = NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S") {
        return Some(format_mysql_datetime(&dt));
    }

    None
}

/// Formats a datetime as `YYYY-MM-DD HH:MM:SS`, followed by the fractional
/// seconds only when the value has them (`DATETIME(n)` / `TIMESTAMP(n)`).
pub(super) fn format_mysql_datetime(value: &NaiveDateTime) -> String {
    value.format("%Y-%m-%d %H:%M:%S%.f").to_string()
}
