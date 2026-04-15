mod binary;
mod geometry;
mod json;
mod scalar;
mod temporal;

#[cfg(test)]
mod tests;

use sqlx::Row;

pub fn extract_value(
    row: &sqlx::mysql::MySqlRow,
    index: usize,
    known_type: Option<&str>,
) -> serde_json::Value {
    use sqlx::{Column, TypeInfo, ValueRef};

    let col = row.columns().get(index);
    let col_name = col.map(|c| c.name()).unwrap_or("unknown");
    let col_type = col.map(|c| c.type_info().name()).unwrap_or("unknown");
    let effective_type = resolve_effective_type(col_type, known_type);

    if let Some(value_ref) = row.try_get_raw(index).ok() {
        if value_ref.is_null() {
            return serde_json::Value::Null;
        }
    }

    if let Some(value) = scalar::extract_decimal_value(row, index, &effective_type) {
        return value;
    }

    if let Some(value) = temporal::extract_temporal_value(row, index, &effective_type) {
        return value;
    }

    if let Some(value) =
        binary::extract_binary_or_blob_value(row, index, &effective_type, known_type)
    {
        return value;
    }

    if let Some(value) = binary::extract_text_value(row, index, &effective_type) {
        return value;
    }

    if let Some(value) = json::extract_json_value(row, index, &effective_type) {
        return value;
    }

    if let Some(value) = geometry::extract_geometry_value(row, index, &effective_type) {
        return value;
    }

    if let Some(value) = scalar::extract_fallback_value(row, index) {
        return value;
    }

    eprintln!(
        "[WARNING] Column '{}' [{}] type '{}' could not be extracted",
        col_name, index, col_type
    );
    serde_json::Value::Null
}

pub(super) fn resolve_effective_type(col_type: &str, known_type: Option<&str>) -> String {
    known_type
        .map(|value| value.to_uppercase())
        .unwrap_or_else(|| col_type.to_uppercase())
}
