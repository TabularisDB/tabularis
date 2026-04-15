use sqlx::Row;

pub(super) fn extract_text_value(
    row: &sqlx::sqlite::SqliteRow,
    index: usize,
) -> Option<serde_json::Value> {
    row.try_get::<String, _>(index)
        .ok()
        .map(serde_json::Value::from)
}

pub(super) fn extract_integer_value(
    row: &sqlx::sqlite::SqliteRow,
    index: usize,
) -> Option<serde_json::Value> {
    if let Ok(value) = row.try_get::<i64, _>(index) {
        return Some(serde_json::Value::from(value));
    }

    row.try_get::<i32, _>(index)
        .ok()
        .map(serde_json::Value::from)
}

pub(super) fn extract_float_value(
    row: &sqlx::sqlite::SqliteRow,
    index: usize,
) -> Option<serde_json::Value> {
    row.try_get::<f64, _>(index).ok().map(|value| {
        serde_json::Number::from_f64(value)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null)
    })
}

pub(super) fn extract_bool_value(
    row: &sqlx::sqlite::SqliteRow,
    index: usize,
) -> Option<serde_json::Value> {
    row.try_get::<bool, _>(index)
        .ok()
        .map(serde_json::Value::from)
}
