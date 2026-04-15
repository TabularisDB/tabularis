use sqlx::Row;

pub(super) fn extract_geometry_value(
    row: &sqlx::mysql::MySqlRow,
    index: usize,
    effective_type: &str,
) -> Option<serde_json::Value> {
    if !is_geometry_type(effective_type) {
        return None;
    }

    if let Ok(raw_value) = row.try_get_raw(index) {
        use sqlx::ValueRef;

        if !raw_value.is_null() {
            if let Ok(value) = <Vec<u8> as sqlx::Decode<sqlx::MySql>>::decode(raw_value) {
                let hex = value
                    .iter()
                    .map(|byte| format!("{byte:02X}"))
                    .collect::<String>();
                return Some(serde_json::Value::String(format!("0x{hex}")));
            }
        }
    }

    None
}

pub(super) fn is_geometry_type(effective_type: &str) -> bool {
    effective_type == "GEOMETRY"
        || effective_type.contains("POINT")
        || effective_type.contains("LINESTRING")
        || effective_type.contains("POLYGON")
        || effective_type.contains("COLLECTION")
}
