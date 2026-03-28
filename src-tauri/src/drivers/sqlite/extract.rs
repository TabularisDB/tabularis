use sqlx::Row;

use crate::drivers::common::encode_blob;

/// Extract value from SQLite row
pub fn extract_value(row: &sqlx::sqlite::SqliteRow, index: usize, _known_type: Option<&str>) -> serde_json::Value {
    use sqlx::ValueRef;

    // Check for NULL first
    if let Ok(val_ref) = row.try_get_raw(index) {
        if val_ref.is_null() {
            return serde_json::Value::Null;
        }
    }

    // String first (SQLite stores dates as text)
    if let Ok(v) = row.try_get::<String, _>(index) {
        return serde_json::Value::from(v);
    }

    // Integers
    if let Ok(v) = row.try_get::<i64, _>(index) {
        return serde_json::Value::from(v);
    }
    if let Ok(v) = row.try_get::<i32, _>(index) {
        return serde_json::Value::from(v);
    }

    // Floating point
    if let Ok(v) = row.try_get::<f64, _>(index) {
        return serde_json::Number::from_f64(v)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null);
    }

    // Boolean
    if let Ok(v) = row.try_get::<bool, _>(index) {
        return serde_json::Value::from(v);
    }

    // Binary data
    if let Ok(v) = row.try_get::<Vec<u8>, _>(index) {
        return serde_json::Value::String(encode_blob(&v));
    }

    serde_json::Value::Null
}
