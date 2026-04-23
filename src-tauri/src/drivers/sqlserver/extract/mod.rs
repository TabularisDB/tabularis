//! Row-level value extraction for SQL Server.
//!
//! The dispatcher inspects the column's `ColumnType` (provided by tiberius)
//! and calls `Row::try_get::<T, _>(idx)` with the right `T`. Conversions that
//! need string formatting (dates, decimals, UUIDs, binary) are delegated to
//! pure helpers in sibling modules so they stay unit-testable without a live
//! server.

pub mod temporal;

use chrono::{DateTime, FixedOffset, NaiveDate, NaiveDateTime, NaiveTime};
use rust_decimal::Decimal;
use serde_json::Value;
use tiberius::{numeric::Numeric, ColumnType, Row};
use uuid::Uuid;

/// Extract a single cell into the Tabularis wire-level `serde_json::Value`.
///
/// Returns `Value::Null` for:
/// - NULL SQL values
/// - columns whose `ColumnType` is `Null` (untyped)
/// - values that couldn't be decoded as any expected type
///
/// The function never panics; decoding errors log at debug level and fall
/// back to `Value::Null` so one malformed row doesn't break the whole query.
pub fn extract_value(row: &Row, idx: usize) -> Value {
    let Some(col) = row.columns().get(idx) else {
        return Value::Null;
    };
    let ct = col.column_type();

    match ct {
        ColumnType::Null => Value::Null,

        ColumnType::Bit | ColumnType::Bitn => read_bool(row, idx),

        ColumnType::Int1 => match row.try_get::<u8, _>(idx) {
            Ok(Some(v)) => Value::from(v),
            _ => Value::Null,
        },
        ColumnType::Int2 => match row.try_get::<i16, _>(idx) {
            Ok(Some(v)) => Value::from(v),
            _ => Value::Null,
        },
        ColumnType::Int4 => match row.try_get::<i32, _>(idx) {
            Ok(Some(v)) => Value::from(v),
            _ => Value::Null,
        },
        ColumnType::Int8 => match row.try_get::<i64, _>(idx) {
            Ok(Some(v)) => Value::from(v),
            _ => Value::Null,
        },
        ColumnType::Intn => read_intn(row, idx),

        ColumnType::Float4 => match row.try_get::<f32, _>(idx) {
            Ok(Some(v)) => f64_to_json(v as f64),
            _ => Value::Null,
        },
        ColumnType::Float8 | ColumnType::Floatn => match row.try_get::<f64, _>(idx) {
            Ok(Some(v)) => f64_to_json(v),
            _ => Value::Null,
        },

        ColumnType::Money | ColumnType::Money4 => read_numeric_as_string(row, idx),
        ColumnType::Decimaln | ColumnType::Numericn => read_numeric_as_string(row, idx),

        ColumnType::Guid => match row.try_get::<Uuid, _>(idx) {
            Ok(Some(u)) => Value::String(u.to_string()),
            _ => Value::Null,
        },

        // Temporal
        ColumnType::Datetime | ColumnType::Datetime4 | ColumnType::Datetimen => {
            match row.try_get::<NaiveDateTime, _>(idx) {
                Ok(Some(v)) => Value::String(temporal::format_datetime(&v)),
                _ => Value::Null,
            }
        }
        ColumnType::Datetime2 => match row.try_get::<NaiveDateTime, _>(idx) {
            Ok(Some(v)) => Value::String(temporal::format_datetime(&v)),
            _ => Value::Null,
        },
        ColumnType::DatetimeOffsetn => match row.try_get::<DateTime<FixedOffset>, _>(idx) {
            Ok(Some(v)) => Value::String(temporal::format_datetime_offset(&v)),
            _ => Value::Null,
        },
        ColumnType::Daten => match row.try_get::<NaiveDate, _>(idx) {
            Ok(Some(v)) => Value::String(temporal::format_date(&v)),
            _ => Value::Null,
        },
        ColumnType::Timen => match row.try_get::<NaiveTime, _>(idx) {
            Ok(Some(v)) => Value::String(temporal::format_time(&v)),
            _ => Value::Null,
        },

        // Strings
        ColumnType::Text
        | ColumnType::NText
        | ColumnType::BigVarChar
        | ColumnType::BigChar
        | ColumnType::NVarchar
        | ColumnType::NChar
        | ColumnType::Xml => read_string(row, idx),

        // Binary
        ColumnType::Image | ColumnType::BigBinary | ColumnType::BigVarBin => {
            read_binary_as_base64(row, idx)
        }

        // Fallbacks: SSVariant and UDT → best-effort string
        ColumnType::SSVariant | ColumnType::Udt => read_string(row, idx),
    }
}

// --- Primitive readers ---------------------------------------------------

fn read_bool(row: &Row, idx: usize) -> Value {
    match row.try_get::<bool, _>(idx) {
        Ok(Some(b)) => Value::Bool(b),
        _ => Value::Null,
    }
}

fn read_intn(row: &Row, idx: usize) -> Value {
    // tiberius returns the "natural" Rust integer width based on the column
    // length. Try widest to narrowest; the first successful decode wins.
    if let Ok(Some(v)) = row.try_get::<i64, _>(idx) {
        return Value::from(v);
    }
    if let Ok(Some(v)) = row.try_get::<i32, _>(idx) {
        return Value::from(v);
    }
    if let Ok(Some(v)) = row.try_get::<i16, _>(idx) {
        return Value::from(v);
    }
    if let Ok(Some(v)) = row.try_get::<u8, _>(idx) {
        return Value::from(v);
    }
    Value::Null
}

fn read_string(row: &Row, idx: usize) -> Value {
    match row.try_get::<&str, _>(idx) {
        Ok(Some(s)) => Value::String(s.to_string()),
        _ => Value::Null,
    }
}

fn read_numeric_as_string(row: &Row, idx: usize) -> Value {
    // Prefer `rust_decimal::Decimal` (exact) when the feature exposes it;
    // fall back to tiberius' own `Numeric` (lossless integer + scale) for
    // values outside rust_decimal's 96-bit range (NUMERIC(38, ...)).
    if let Ok(Some(d)) = row.try_get::<Decimal, _>(idx) {
        return Value::String(normalize_decimal_string(&d.to_string()));
    }
    if let Ok(Some(n)) = row.try_get::<Numeric, _>(idx) {
        return Value::String(normalize_decimal_string(&n.to_string()));
    }
    if let Ok(Some(f)) = row.try_get::<f64, _>(idx) {
        return f64_to_json(f);
    }
    Value::Null
}

fn read_binary_as_base64(row: &Row, idx: usize) -> Value {
    use base64::Engine as _;
    match row.try_get::<&[u8], _>(idx) {
        Ok(Some(bytes)) => Value::String(format!(
            "base64:{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        )),
        _ => Value::Null,
    }
}

// --- Pure helpers (testable) ---------------------------------------------

/// Convert a `f64` to a JSON number, falling back to string for non-finite
/// values (NaN / ±Inf are not valid JSON numbers).
pub fn f64_to_json(v: f64) -> Value {
    serde_json::Number::from_f64(v)
        .map(Value::Number)
        .unwrap_or_else(|| Value::String(v.to_string()))
}

/// Normalise a decimal string representation by trimming insignificant
/// trailing zeros after the decimal point. `"3.1400"` -> `"3.14"`,
/// `"10.0"` -> `"10"`. Leaves integers without a dot alone.
pub fn normalize_decimal_string(raw: &str) -> String {
    // Preserve sign + whole/fractional split.
    if !raw.contains('.') {
        return raw.to_string();
    }
    let trimmed = raw.trim_end_matches('0');
    let trimmed = trimmed.trim_end_matches('.');
    trimmed.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- f64_to_json ------------------------------------------------------

    #[test]
    fn f64_to_json_wraps_finite_numbers() {
        let v = f64_to_json(3.14);
        assert_eq!(v, Value::Number(serde_json::Number::from_f64(3.14).unwrap()));
        let v = f64_to_json(0.0);
        assert_eq!(v, Value::Number(serde_json::Number::from_f64(0.0).unwrap()));
        let v = f64_to_json(-1e10);
        assert_eq!(v, Value::Number(serde_json::Number::from_f64(-1e10).unwrap()));
    }

    #[test]
    fn f64_to_json_stringifies_nan_and_infinity() {
        assert_eq!(f64_to_json(f64::NAN), Value::String("NaN".into()));
        assert_eq!(f64_to_json(f64::INFINITY), Value::String("inf".into()));
        assert_eq!(
            f64_to_json(f64::NEG_INFINITY),
            Value::String("-inf".into())
        );
    }

    // --- normalize_decimal_string -----------------------------------------

    #[test]
    fn normalize_decimal_trims_trailing_zeros() {
        assert_eq!(normalize_decimal_string("3.1400"), "3.14");
        assert_eq!(normalize_decimal_string("3.100"), "3.1");
        assert_eq!(normalize_decimal_string("0.50"), "0.5");
    }

    #[test]
    fn normalize_decimal_drops_trailing_dot() {
        assert_eq!(normalize_decimal_string("10.0"), "10");
        assert_eq!(normalize_decimal_string("100.000"), "100");
        assert_eq!(normalize_decimal_string("-42.000"), "-42");
    }

    #[test]
    fn normalize_decimal_leaves_integers_alone() {
        assert_eq!(normalize_decimal_string("10"), "10");
        assert_eq!(normalize_decimal_string("-42"), "-42");
        assert_eq!(normalize_decimal_string("0"), "0");
    }

    #[test]
    fn normalize_decimal_preserves_significant_digits() {
        assert_eq!(normalize_decimal_string("3.14159"), "3.14159");
        assert_eq!(normalize_decimal_string("0.00001"), "0.00001");
        assert_eq!(normalize_decimal_string("1.23"), "1.23");
    }

    #[test]
    fn normalize_decimal_handles_zero_with_fraction() {
        assert_eq!(normalize_decimal_string("0.0"), "0");
        assert_eq!(normalize_decimal_string("0.000"), "0");
    }
}
