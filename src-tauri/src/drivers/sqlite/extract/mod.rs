mod blob;
mod scalar;

#[cfg(test)]
mod tests;

use sqlx::Row;

/// Extract value from SQLite row
pub fn extract_value(
    row: &sqlx::sqlite::SqliteRow,
    index: usize,
    _known_type: Option<&str>,
) -> serde_json::Value {
    use sqlx::ValueRef;

    // Check for NULL first
    if let Ok(val_ref) = row.try_get_raw(index) {
        if val_ref.is_null() {
            return serde_json::Value::Null;
        }
    }

    if let Some(value) = scalar::extract_text_value(row, index) {
        return value;
    }

    if let Some(value) = scalar::extract_integer_value(row, index) {
        return value;
    }

    if let Some(value) = scalar::extract_float_value(row, index) {
        return value;
    }

    if let Some(value) = scalar::extract_bool_value(row, index) {
        return value;
    }

    if let Some(value) = blob::extract_blob_value(row, index) {
        return value;
    }

    serde_json::Value::Null
}
