use sqlx::Row;

use crate::drivers::common::encode_blob;

pub(super) fn extract_binary_or_blob_value(
    row: &sqlx::mysql::MySqlRow,
    index: usize,
    effective_type: &str,
    known_type: Option<&str>,
) -> Option<serde_json::Value> {
    if !effective_type.contains("BLOB") && !effective_type.contains("BINARY") {
        return None;
    }

    if let Ok(value) = row.try_get::<Vec<u8>, _>(index) {
        if is_binary_string_type(effective_type) && value.len() <= 65_535 {
            if let Ok(text) = String::from_utf8(value.clone()) {
                return Some(serde_json::Value::String(text));
            }
        }
        if known_type.is_none() {
            if let Ok(text) = String::from_utf8(value.clone()) {
                return Some(serde_json::Value::String(text));
            }
        }
        return Some(serde_json::Value::String(encode_blob(&value)));
    }

    if let Ok(value) = row.try_get::<String, _>(index) {
        return Some(serde_json::Value::String(encode_blob(value.as_bytes())));
    }

    None
}

pub(super) fn extract_text_value(
    row: &sqlx::mysql::MySqlRow,
    index: usize,
    effective_type: &str,
) -> Option<serde_json::Value> {
    if !effective_type.contains("TEXT") {
        return None;
    }

    if let Ok(value) = row.try_get::<String, _>(index) {
        return Some(serde_json::Value::String(value));
    }

    if let Ok(value) = row.try_get::<Vec<u8>, _>(index) {
        if let Ok(text) = String::from_utf8(value.clone()) {
            return Some(serde_json::Value::String(text));
        }
        return Some(serde_json::Value::String(base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            value,
        )));
    }

    None
}

pub(super) fn is_binary_string_type(effective_type: &str) -> bool {
    effective_type.contains("VARBINARY") || effective_type == "BINARY"
}
