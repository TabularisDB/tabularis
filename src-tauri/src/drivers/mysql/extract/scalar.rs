use chrono::{NaiveDate, NaiveDateTime, NaiveTime};
use rust_decimal::Decimal;
use sqlx::Row;
use uuid::Uuid;

use super::temporal::format_mysql_datetime;
use crate::drivers::common::{encode_blob, float4_to_json_f64, i64_to_json, u64_to_json};

pub(super) fn extract_decimal_value(
    row: &sqlx::mysql::MySqlRow,
    index: usize,
    effective_type: &str,
) -> Option<serde_json::Value> {
    if effective_type != "DECIMAL" && effective_type != "NEWDECIMAL" && effective_type != "NUMERIC"
    {
        return None;
    }

    if let Ok(value) = row.try_get::<Decimal, _>(index) {
        return Some(serde_json::Value::String(value.to_string()));
    }

    if let Ok(value) = row.try_get::<String, _>(index) {
        return Some(serde_json::Value::String(value));
    }

    None
}

pub(super) fn extract_fallback_value(
    row: &sqlx::mysql::MySqlRow,
    index: usize,
    effective_type: &str,
) -> Option<serde_json::Value> {
    if effective_type == "FLOAT" {
        if let Ok(value) = row.try_get::<f32, _>(index) {
            return Some(serde_json::Value::from(float4_to_json_f64(value)));
        }
    }

    if let Ok(value) = row.try_get::<NaiveDateTime, _>(index) {
        return Some(serde_json::Value::String(format_mysql_datetime(&value)));
    }
    if let Ok(value) = row.try_get::<NaiveDate, _>(index) {
        return Some(serde_json::Value::String(value.to_string()));
    }
    if let Ok(value) = row.try_get::<NaiveTime, _>(index) {
        return Some(serde_json::Value::String(value.to_string()));
    }

    if let Ok(value) = row.try_get::<u64, _>(index) {
        return Some(u64_to_json(value));
    }
    if let Ok(value) = row.try_get::<u32, _>(index) {
        return Some(serde_json::Value::from(value));
    }
    if let Ok(value) = row.try_get::<u16, _>(index) {
        return Some(serde_json::Value::from(value));
    }
    if let Ok(value) = row.try_get::<u8, _>(index) {
        return Some(serde_json::Value::from(value));
    }
    if let Ok(value) = row.try_get::<i64, _>(index) {
        return Some(i64_to_json(value));
    }
    if let Ok(value) = row.try_get::<i32, _>(index) {
        return Some(serde_json::Value::from(value));
    }
    if let Ok(value) = row.try_get::<i16, _>(index) {
        return Some(serde_json::Value::from(value));
    }
    if let Ok(value) = row.try_get::<i8, _>(index) {
        return Some(serde_json::Value::from(value));
    }
    if let Ok(value) = row.try_get::<Decimal, _>(index) {
        return Some(serde_json::Value::String(value.to_string()));
    }
    if let Ok(value) = row.try_get::<f64, _>(index) {
        return Some(
            serde_json::Number::from_f64(value)
                .map(serde_json::Value::Number)
                .unwrap_or(serde_json::Value::Null),
        );
    }
    if let Ok(value) = row.try_get::<f32, _>(index) {
        return Some(
            serde_json::Number::from_f64(value as f64)
                .map(serde_json::Value::Number)
                .unwrap_or(serde_json::Value::Null),
        );
    }
    if let Ok(value) = row.try_get::<bool, _>(index) {
        return Some(serde_json::Value::from(value));
    }
    if let Ok(value) = row.try_get::<String, _>(index) {
        return Some(serde_json::Value::from(value));
    }
    if let Ok(value) = row.try_get::<Uuid, _>(index) {
        return Some(serde_json::Value::String(value.to_string()));
    }
    if let Ok(value) = row.try_get::<Vec<u8>, _>(index) {
        return Some(serde_json::Value::String(encode_blob(&value)));
    }

    None
}
