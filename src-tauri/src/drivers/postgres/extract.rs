use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use rust_decimal::Decimal;
use sqlx::Row;
use uuid::Uuid;

use crate::drivers::common::encode_blob;

/// Extract value from PostgreSQL row
pub fn extract_value(row: &sqlx::postgres::PgRow, index: usize, _known_type: Option<&str>) -> serde_json::Value {
    use sqlx::ValueRef;

    // Check for NULL first
    if let Ok(val_ref) = row.try_get_raw(index) {
        if val_ref.is_null() {
            return serde_json::Value::Null;
        }
    }

    // DateTime types FIRST
    if let Ok(v) = row.try_get::<DateTime<Utc>, _>(index) {
        return serde_json::Value::String(v.format("%Y-%m-%d %H:%M:%S").to_string());
    }
    if let Ok(v) = row.try_get::<NaiveDateTime, _>(index) {
        return serde_json::Value::String(v.format("%Y-%m-%d %H:%M:%S").to_string());
    }
    if let Ok(v) = row.try_get::<NaiveDate, _>(index) {
        return serde_json::Value::String(v.to_string());
    }
    if let Ok(v) = row.try_get::<NaiveTime, _>(index) {
        return serde_json::Value::String(v.to_string());
    }

    // Signed integers only
    if let Ok(v) = row.try_get::<i64, _>(index) {
        return serde_json::Value::from(v);
    }
    if let Ok(v) = row.try_get::<i32, _>(index) {
        return serde_json::Value::from(v);
    }
    if let Ok(v) = row.try_get::<i16, _>(index) {
        return serde_json::Value::from(v);
    }

    // Decimal
    if let Ok(v) = row.try_get::<Decimal, _>(index) {
        return serde_json::Value::String(v.to_string());
    }

    // Floating point
    if let Ok(v) = row.try_get::<f64, _>(index) {
        return serde_json::Number::from_f64(v)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null);
    }
    if let Ok(v) = row.try_get::<f32, _>(index) {
        return serde_json::Number::from_f64(v as f64)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null);
    }

    // Boolean
    if let Ok(v) = row.try_get::<bool, _>(index) {
        return serde_json::Value::from(v);
    }

    // String
    if let Ok(v) = row.try_get::<String, _>(index) {
        return serde_json::Value::from(v);
    }

    // UUID
    if let Ok(v) = row.try_get::<Uuid, _>(index) {
        return serde_json::Value::String(v.to_string());
    }

    // Binary data
    if let Ok(v) = row.try_get::<Vec<u8>, _>(index) {
        return serde_json::Value::String(encode_blob(&v));
    }

    // JSON
    if let Ok(v) = row.try_get::<serde_json::Value, _>(index) {
        return v;
    }

    // Array types
    if let Ok(v) = row.try_get::<Vec<i64>, _>(index) {
        return serde_json::Value::Array(v.into_iter().map(serde_json::Value::from).collect());
    }
    if let Ok(v) = row.try_get::<Vec<i32>, _>(index) {
        return serde_json::Value::Array(v.into_iter().map(serde_json::Value::from).collect());
    }
    if let Ok(v) = row.try_get::<Vec<i16>, _>(index) {
        return serde_json::Value::Array(v.into_iter().map(serde_json::Value::from).collect());
    }
    if let Ok(v) = row.try_get::<Vec<f64>, _>(index) {
        return serde_json::Value::Array(
            v.into_iter()
                .map(|f| {
                    serde_json::Number::from_f64(f)
                        .map(serde_json::Value::Number)
                        .unwrap_or(serde_json::Value::Null)
                })
                .collect(),
        );
    }
    if let Ok(v) = row.try_get::<Vec<f32>, _>(index) {
        return serde_json::Value::Array(
            v.into_iter()
                .map(|f| {
                    serde_json::Number::from_f64(f as f64)
                        .map(serde_json::Value::Number)
                        .unwrap_or(serde_json::Value::Null)
                })
                .collect(),
        );
    }
    if let Ok(v) = row.try_get::<Vec<Decimal>, _>(index) {
        return serde_json::Value::Array(
            v.into_iter()
                .map(|d| serde_json::Value::String(d.to_string()))
                .collect(),
        );
    }
    if let Ok(v) = row.try_get::<Vec<bool>, _>(index) {
        return serde_json::Value::Array(v.into_iter().map(serde_json::Value::from).collect());
    }
    if let Ok(v) = row.try_get::<Vec<String>, _>(index) {
        return serde_json::Value::Array(v.into_iter().map(serde_json::Value::from).collect());
    }
    if let Ok(v) = row.try_get::<Vec<DateTime<Utc>>, _>(index) {
        return serde_json::Value::Array(
            v.into_iter()
                .map(|dt| serde_json::Value::String(dt.format("%Y-%m-%d %H:%M:%S").to_string()))
                .collect(),
        );
    }
    if let Ok(v) = row.try_get::<Vec<NaiveDateTime>, _>(index) {
        return serde_json::Value::Array(
            v.into_iter()
                .map(|dt| serde_json::Value::String(dt.format("%Y-%m-%d %H:%M:%S").to_string()))
                .collect(),
        );
    }
    if let Ok(v) = row.try_get::<Vec<NaiveDate>, _>(index) {
        return serde_json::Value::Array(
            v.into_iter()
                .map(|d| serde_json::Value::String(d.to_string()))
                .collect(),
        );
    }
    if let Ok(v) = row.try_get::<Vec<NaiveTime>, _>(index) {
        return serde_json::Value::Array(
            v.into_iter()
                .map(|t| serde_json::Value::String(t.to_string()))
                .collect(),
        );
    }
    if let Ok(v) = row.try_get::<Vec<Uuid>, _>(index) {
        return serde_json::Value::Array(
            v.into_iter()
                .map(|u| serde_json::Value::String(u.to_string()))
                .collect(),
        );
    }

    serde_json::Value::Null
}
