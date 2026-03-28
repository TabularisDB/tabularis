use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use rust_decimal::Decimal;
use sqlx::Row;
use uuid::Uuid;

use crate::drivers::common::encode_blob;

/// Extract value from MySQL row - supports all MySQL types including unsigned integers and geometry
pub fn extract_value(
    row: &sqlx::mysql::MySqlRow,
    index: usize,
    known_type: Option<&str>,
) -> serde_json::Value {
    use sqlx::{Column, TypeInfo, ValueRef};

    // Get column info
    let col = row.columns().get(index);
    let col_name = col.map(|c| c.name()).unwrap_or("unknown");
    let col_type = col.map(|c| c.type_info().name()).unwrap_or("unknown");

    // Prefer the known type from information_schema (accurate) over sqlx's TypeInfo
    // which can misreport LONGTEXT as BLOB due to shared MySQL wire protocol type codes.
    let effective_type = known_type
        .map(|t| t.to_uppercase())
        .unwrap_or_else(|| col_type.to_uppercase());

    // Get the raw value to check if it's NULL
    let value_ref = row.try_get_raw(index).ok();
    if let Some(val_ref) = value_ref {
        if val_ref.is_null() {
            return serde_json::Value::Null;
        }
    }

    // DECIMAL/NUMERIC optimization
    if effective_type == "DECIMAL" || effective_type == "NEWDECIMAL" || effective_type == "NUMERIC" {
        if let Ok(v) = row.try_get::<Decimal, _>(index) {
            return serde_json::Value::String(v.to_string());
        }
        // Fallback to string if Decimal fails
        if let Ok(v) = row.try_get::<String, _>(index) {
            return serde_json::Value::String(v);
        }
    }

    // For TIMESTAMP/DATETIME, try all possible representations
    if effective_type == "TIMESTAMP" || effective_type == "DATETIME" {
        // Try chrono types
        match row.try_get::<NaiveDateTime, _>(index) {
            Ok(v) => {
                return serde_json::Value::String(v.format("%Y-%m-%d %H:%M:%S").to_string());
            }
            Err(e) => eprintln!("[DEBUG] ✗ {} as NaiveDateTime: {}", col_name, e),
        }

        match row.try_get::<DateTime<Utc>, _>(index) {
            Ok(v) => {
                return serde_json::Value::String(v.format("%Y-%m-%d %H:%M:%S").to_string());
            }
            Err(e) => eprintln!("[DEBUG] ✗ {} as DateTime<Utc>: {}", col_name, e),
        }

        // Try as string
        match row.try_get::<String, _>(index) {
            Ok(v) => {
                // Try to parse typical SQL string formats to clean them up if they look like ISO
                if let Ok(dt) = NaiveDateTime::parse_from_str(&v, "%Y-%m-%dT%H:%M:%S%.f") {
                    return serde_json::Value::String(dt.format("%Y-%m-%d %H:%M:%S").to_string());
                }
                if let Ok(dt) = NaiveDateTime::parse_from_str(&v, "%Y-%m-%dT%H:%M:%S") {
                    return serde_json::Value::String(dt.format("%Y-%m-%d %H:%M:%S").to_string());
                }
                return serde_json::Value::String(v);
            }
            Err(e) => eprintln!("[DEBUG] ✗ {} as String: {}", col_name, e),
        }

        // Try as i64 (unix timestamp)
        match row.try_get::<i64, _>(index) {
            Ok(v) => {
                return serde_json::Value::from(v);
            }
            Err(e) => eprintln!("[DEBUG] ✗ {} as i64: {}", col_name, e),
        }
    }

    // For BLOB/BINARY types, encode via the shared helper so every driver
    // returns the canonical wire format ("BLOB:<size>:<mime>:<base64>").
    // Exception: VARBINARY/BINARY columns whose content is valid UTF-8 and
    // fits within 65 535 bytes are returned as plain strings so that small
    // fixed-size values (e.g. UUIDs stored as VARBINARY(36)) remain readable.
    // This threshold mirrors BLOB_TEXT_LENGTH_THRESHOLD on the frontend.
    if effective_type.contains("BLOB") || effective_type.contains("BINARY") {
        match row.try_get::<Vec<u8>, _>(index) {
            Ok(v) => {
                let is_variable_or_fixed_binary =
                    effective_type.contains("VARBINARY") || effective_type == "BINARY";
                if is_variable_or_fixed_binary && v.len() <= 65_535 {
                    if let Ok(s) = String::from_utf8(v.clone()) {
                        return serde_json::Value::String(s);
                    }
                }
                // Heuristic: when no known_type is provided, sqlx may misreport
                // TEXT types (LONGTEXT, MEDIUMTEXT, etc.) as BLOB because the MySQL
                // wire protocol shares type codes. If the data is valid UTF-8, treat
                // it as text rather than encoding as BLOB wire format.
                if known_type.is_none() {
                    if let Ok(s) = String::from_utf8(v.clone()) {
                        return serde_json::Value::String(s);
                    }
                }
                return serde_json::Value::String(encode_blob(&v));
            }
            Err(e) => eprintln!("[DEBUG] ✗ {} as Vec<u8>: {}", col_name, e),
        }

        // Fallback: some MySQL drivers may return text-based binary data as String
        match row.try_get::<String, _>(index) {
            Ok(v) => {
                return serde_json::Value::String(encode_blob(v.as_bytes()));
            }
            Err(e) => eprintln!("[DEBUG] ✗ {} as String: {}", col_name, e),
        }
    }

    // For TEXT types (TINYTEXT, TEXT, MEDIUMTEXT, LONGTEXT), try string first
    if effective_type.contains("TEXT") {
        match row.try_get::<String, _>(index) {
            Ok(v) => {
                return serde_json::Value::String(v);
            }
            Err(e) => eprintln!("[DEBUG] ✗ {} as String: {}", col_name, e),
        }

        // Fallback to Vec<u8> for non-UTF8 text
        match row.try_get::<Vec<u8>, _>(index) {
            Ok(v) => {
                // Try to convert to UTF-8 string first
                if let Ok(s) = String::from_utf8(v.clone()) {
                    return serde_json::Value::String(s);
                }
                // If not valid UTF-8, encode as base64
                return serde_json::Value::String(base64::Engine::encode(
                    &base64::engine::general_purpose::STANDARD,
                    v,
                ));
            }
            Err(e) => eprintln!("[DEBUG] ✗ {} as Vec<u8>: {}", col_name, e),
        }
    }

    // For JSON type, decode as serde_json::Value (requires sqlx "json" feature)
    if effective_type == "JSON" {
        if let Ok(v) = row.try_get::<serde_json::Value, _>(index) {
            return v;
        }
        // Fallback: try raw bytes and parse as JSON string
        if let Ok(raw_value) = row.try_get_raw(index) {
            use sqlx::ValueRef;
            if !raw_value.is_null() {
                if let Ok(bytes) = <Vec<u8> as sqlx::Decode<sqlx::MySql>>::decode(raw_value) {
                    if let Ok(s) = String::from_utf8(bytes) {
                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&s) {
                            return parsed;
                        }
                        return serde_json::Value::String(s);
                    }
                }
            }
        }
    }

    // For GEOMETRY types (GEOMETRY, POINT, LINESTRING, POLYGON, etc.), extract as WKB binary and encode
    if effective_type == "GEOMETRY"
        || effective_type.contains("POINT")
        || effective_type.contains("LINESTRING")
        || effective_type.contains("POLYGON")
        || effective_type.contains("COLLECTION")
    {
        // Use try_get_raw() to get the raw bytes since sqlx doesn't allow Vec<u8> for GEOMETRY
        match row.try_get_raw(index) {
            Ok(raw_value) => {
                use sqlx::ValueRef;
                if !raw_value.is_null() {
                    // Decode the raw value to bytes
                    match <Vec<u8> as sqlx::Decode<sqlx::MySql>>::decode(raw_value) {
                        Ok(v) => {
                            // Return WKB data as hexadecimal string (standard format for geometry display)
                            let hex_string =
                                v.iter().map(|b| format!("{:02X}", b)).collect::<String>();
                            return serde_json::Value::String(format!("0x{}", hex_string));
                        }
                        Err(e) => eprintln!(
                            "[WARNING] Failed to decode geometry bytes for '{}': {}",
                            col_name, e
                        ),
                    }
                }
            }
            Err(e) => eprintln!(
                "[WARNING] Failed to get raw geometry value for '{}': {}",
                col_name, e
            ),
        }
    }

    // DateTime types (for other date columns)
    if let Ok(v) = row.try_get::<NaiveDateTime, _>(index) {
        return serde_json::Value::String(v.format("%Y-%m-%d %H:%M:%S").to_string());
    }
    if let Ok(v) = row.try_get::<NaiveDate, _>(index) {
        return serde_json::Value::String(v.to_string());
    }
    if let Ok(v) = row.try_get::<NaiveTime, _>(index) {
        return serde_json::Value::String(v.to_string());
    }

    // Unsigned integers (MySQL specific)
    if let Ok(v) = row.try_get::<u64, _>(index) {
        return serde_json::Value::from(v);
    }
    if let Ok(v) = row.try_get::<u32, _>(index) {
        return serde_json::Value::from(v);
    }
    if let Ok(v) = row.try_get::<u16, _>(index) {
        return serde_json::Value::from(v);
    }
    if let Ok(v) = row.try_get::<u8, _>(index) {
        return serde_json::Value::from(v);
    }

    // Signed integers
    if let Ok(v) = row.try_get::<i64, _>(index) {
        return serde_json::Value::from(v);
    }
    if let Ok(v) = row.try_get::<i32, _>(index) {
        return serde_json::Value::from(v);
    }
    if let Ok(v) = row.try_get::<i16, _>(index) {
        return serde_json::Value::from(v);
    }
    if let Ok(v) = row.try_get::<i8, _>(index) {
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

    // Fallback
    let type_info = row.column(index).type_info();
    eprintln!(
        "[WARNING] Column '{}' [{}] type '{}' (TypeInfo: {:?}) could not be extracted. Raw value available: {:?}",
        col_name, index, col_type, type_info, row.try_get_raw(index).is_ok()
    );
    serde_json::Value::Null
}
