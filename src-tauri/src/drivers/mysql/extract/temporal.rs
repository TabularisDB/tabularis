use chrono::{DateTime, NaiveDateTime, Utc};
use sqlx::mysql::types::MySqlTime;
use sqlx::Row;

/// A `TIME` that is no time of day (negative, or 24 hours and over), written
/// the way MySQL writes it. `None` for a time of day, which the caller
/// formats through `chrono` as before.
///
/// `chrono::NaiveTime` cannot hold such a value: read through it, the text
/// protocol fails to parse one and the binary protocol drops its sign.
pub(super) fn extract_out_of_day_time(
    row: &sqlx::mysql::MySqlRow,
    index: usize,
) -> Option<serde_json::Value> {
    let time = row.try_get::<MySqlTime, _>(index).ok()?;
    if time.is_valid_time_of_day() {
        return None;
    }
    Some(serde_json::Value::String(format_mysql_time(&time)))
}

/// `[-]HH:MM:SS[.ffffff]`, with as many hour digits as the value needs.
pub(super) fn format_mysql_time(time: &MySqlTime) -> String {
    let sign = if time.sign().is_negative() { "-" } else { "" };
    let mut text = format!(
        "{sign}{:02}:{:02}:{:02}",
        time.hours(),
        time.minutes(),
        time.seconds()
    );
    if time.microseconds() != 0 {
        text.push_str(&format!(".{:06}", time.microseconds()));
    }
    text
}

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
