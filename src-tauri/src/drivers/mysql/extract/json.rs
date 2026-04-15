use sqlx::Row;

pub(super) fn extract_json_value(
    row: &sqlx::mysql::MySqlRow,
    index: usize,
    effective_type: &str,
) -> Option<serde_json::Value> {
    if effective_type != "JSON" {
        return None;
    }

    if let Ok(value) = row.try_get::<serde_json::Value, _>(index) {
        return Some(value);
    }

    if let Ok(raw_value) = row.try_get_raw(index) {
        use sqlx::ValueRef;

        if !raw_value.is_null() {
            if let Ok(bytes) = <Vec<u8> as sqlx::Decode<sqlx::MySql>>::decode(raw_value) {
                if let Ok(text) = String::from_utf8(bytes) {
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) {
                        return Some(parsed);
                    }
                    return Some(serde_json::Value::String(text));
                }
            }
        }
    }

    None
}
