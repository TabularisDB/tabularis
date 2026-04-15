use sqlx::Row;

use crate::drivers::common::encode_blob;

pub(super) fn extract_blob_value(
    row: &sqlx::sqlite::SqliteRow,
    index: usize,
) -> Option<serde_json::Value> {
    row.try_get::<Vec<u8>, _>(index)
        .ok()
        .map(|value| serde_json::Value::String(encode_blob(&value)))
}
