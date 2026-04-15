use chrono::{NaiveDate, NaiveDateTime, NaiveTime};
use rust_decimal::Decimal;
use sqlx::Row;
use uuid::Uuid;

use crate::drivers::common::encode_blob;

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
) -> Option<serde_json::Value> {
    if let Ok(value) = row.try_get::<NaiveDateTime, _>(index) {
        return Some(serde_json::Value::String(
            value.format("%Y-%m-%d %H:%M:%S").to_string(),
        ));
    }
    if let Ok(value) = row.try_get::<NaiveDate, _>(index) {
        return Some(serde_json::Value::String(value.to_string()));
    }
    if let Ok(value) = row.try_get::<NaiveTime, _>(index) {
        return Some(serde_json::Value::String(value.to_string()));
    }

    if let Ok(value) = row.try_get::<u64, _>(index) {
        return Some(serde_json::Value::from(value));
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
        return Some(serde_json::Value::from(value));
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
