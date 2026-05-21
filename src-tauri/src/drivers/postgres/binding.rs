use super::helpers::{
    escape_identifier, extract_base_type, is_raw_sql_function, is_wkt_geometry,
    json_array_to_pg_literal, try_parse_pg_array,
};
use crate::drivers::common::parse_unsafe_bigint_string;
use tokio_postgres::types::ToSql;

pub(super) type PgParam = Box<dyn ToSql + Send + Sync>;

pub(super) struct BoundValue {
    pub sql: String,
    pub param: Option<PgParam>,
}

pub(super) struct PgValueOptions<'a> {
    pub column_type: Option<&'a str>,
    pub max_blob_size: u64,
    pub allow_default: bool,
}

/// Build a parameterized "<pk_col> = $N" predicate plus the boxed parameter for the
/// given JSON pk_val. Numeric values are cast through bigint/double precision so the
/// bind succeeds against int2/int4/int8/real columns; UUID strings are bound as the
/// `Uuid` type so PostgreSQL receives the matching OID.
pub(super) fn build_pk_predicate(
    pk_col: &str,
    pk_val: serde_json::Value,
    placeholder_idx: usize,
) -> Result<(String, PgParam), String> {
    let col = format!("\"{}\"", escape_identifier(pk_col));
    match pk_val {
        serde_json::Value::Number(n) => {
            let bound = bind_pg_number(&n, placeholder_idx)?;
            let param = bound
                .param
                .ok_or_else(|| "Internal PostgreSQL numeric binding error".to_string())?;
            Ok((format!("{} = {}", col, bound.sql), param))
        }
        serde_json::Value::String(s) => {
            if let Ok(uuid) = s.parse::<uuid::Uuid>() {
                Ok((format!("{} = ${}", col, placeholder_idx), Box::new(uuid)))
            } else if let Some(n) = parse_unsafe_bigint_string(&s) {
                // Bigint PK values outside JS safe range arrive from the UI as
                // strings. Cast through bigint so the equality test against an
                // int8 column does not trip a PostgreSQL type mismatch.
                Ok((
                    format!("{} = CAST(${} AS bigint)", col, placeholder_idx),
                    Box::new(n),
                ))
            } else {
                Ok((format!("{} = ${}", col, placeholder_idx), Box::new(s)))
            }
        }
        _ => Err("Unsupported PK type".into()),
    }
}

pub(super) fn bind_pg_value(
    value: serde_json::Value,
    placeholder_idx: usize,
    options: PgValueOptions<'_>,
) -> Result<BoundValue, String> {
    // Bind serde_json::Value directly for json/jsonb — serialize-and-cast trips an OID mismatch.
    if let Some(ct) = options.column_type {
        let normalized = extract_base_type(ct);
        if matches!(normalized.as_str(), "JSON" | "JSONB") {
            match &value {
                serde_json::Value::String(_) | serde_json::Value::Null => {}
                _ => {
                    return Ok(BoundValue {
                        sql: format!("${}", placeholder_idx),
                        param: Some(Box::new(value)),
                    });
                }
            }
        }
    }

    match value {
        serde_json::Value::Number(n) => bind_pg_number(&n, placeholder_idx),
        serde_json::Value::String(s) => bind_pg_string(&s, placeholder_idx, options),
        serde_json::Value::Bool(b) => Ok(BoundValue {
            sql: format!("${}", placeholder_idx),
            param: Some(Box::new(b)),
        }),
        serde_json::Value::Null => Ok(BoundValue {
            sql: "NULL".to_string(),
            param: None,
        }),
        serde_json::Value::Array(arr) => Ok(BoundValue {
            sql: json_array_to_pg_literal(&arr)?,
            param: None,
        }),
        serde_json::Value::Object(_) => {
            Err("Cannot bind a JSON object to a non-JSON column".into())
        }
    }
}

/// SQL fragment + boxed parameter for a JSON Number bound to PostgreSQL.
///
/// tokio-postgres binds Rust `i64` as INT8 and `f64` as FLOAT8, and rejects the
/// bind when the column is INT2/INT4/REAL with "error serializing parameter X".
/// Wrapping the placeholder in `CAST($N AS bigint)` / `CAST($N AS double precision)`
/// lets PostgreSQL convert to the actual column width via its assignment / implicit
/// comparison casts.
pub(super) fn bind_pg_number(
    n: &serde_json::Number,
    placeholder_idx: usize,
) -> Result<BoundValue, String> {
    if let Some(v) = n.as_i64() {
        Ok(BoundValue {
            sql: format!("CAST(${} AS bigint)", placeholder_idx),
            param: Some(Box::new(v)),
        })
    } else if let Some(v) = n.as_f64() {
        Ok(BoundValue {
            sql: format!("CAST(${} AS double precision)", placeholder_idx),
            param: Some(Box::new(v)),
        })
    } else {
        Err(format!("Unsupported numeric value: {}", n))
    }
}

/// Coerce a string value into a Rust `bool` for PostgreSQL `boolean` columns.
///
/// `tokio-postgres` rejects a string bound to a `bool` column with
/// "error serializing parameter X". The data grid editor sends every cell as
/// a JSON string, so a "true"/"false" string never reaches `bind_pg_value`'s
/// `Bool` arm. This helper mirrors the literal forms PostgreSQL accepts for
/// `boolean` (case-insensitive, surrounding whitespace tolerated).
///
/// Returns `None` if the column is not boolean, so callers can fall through
/// to the next coercion path.
pub(super) fn bind_pg_boolean_string(
    s: &str,
    column_type: &str,
    placeholder_idx: usize,
) -> Option<Result<BoundValue, String>> {
    let normalized = extract_base_type(column_type).to_lowercase();
    if !matches!(normalized.as_str(), "boolean" | "bool") {
        return None;
    }

    let parsed = match s.trim().to_lowercase().as_str() {
        "true" | "t" | "yes" | "y" | "on" | "1" => Some(true),
        "false" | "f" | "no" | "n" | "off" | "0" => Some(false),
        _ => None,
    };

    Some(parsed.map_or_else(
        || {
            Err(format!(
                "Cannot convert value {:?} to PostgreSQL boolean column type {}",
                s, column_type
            ))
        },
        |b| {
            Ok(BoundValue {
                sql: format!("${}", placeholder_idx),
                param: Some(Box::new(b) as PgParam),
            })
        },
    ))
}

pub(super) fn bind_pg_numeric_string(
    s: &str,
    column_type: &str,
    placeholder_idx: usize,
) -> Option<Result<BoundValue, String>> {
    let trimmed = s.trim();
    let normalized = extract_base_type(column_type).to_lowercase();

    if matches!(
        normalized.as_str(),
        "smallint" | "integer" | "bigint" | "int2" | "int4" | "int8" | "serial" | "bigserial"
    ) {
        return Some(trimmed.parse::<i64>().map_or_else(
            |e| {
                Err(format!(
                    "Cannot convert value {:?} to PostgreSQL numeric column type {}: {}",
                    s, column_type, e
                ))
            },
            |v| {
                Ok(BoundValue {
                    sql: format!("CAST(${} AS bigint)", placeholder_idx),
                    param: Some(Box::new(v) as PgParam),
                })
            },
        ));
    }

    if matches!(normalized.as_str(), "numeric" | "decimal") {
        return Some(trimmed.parse::<rust_decimal::Decimal>().map_or_else(
            |e| {
                Err(format!(
                    "Cannot convert value {:?} to PostgreSQL numeric column type {}: {}",
                    s, column_type, e
                ))
            },
            |v| {
                Ok(BoundValue {
                    sql: format!("CAST(${} AS numeric)", placeholder_idx),
                    param: Some(Box::new(v) as PgParam),
                })
            },
        ));
    }

    if matches!(
        normalized.as_str(),
        "real" | "double precision" | "float4" | "float8"
    ) {
        return Some(trimmed.parse::<f64>().map_or_else(
            |e| {
                Err(format!(
                    "Cannot convert value {:?} to PostgreSQL numeric column type {}: {}",
                    s, column_type, e
                ))
            },
            |v| {
                Ok(BoundValue {
                    sql: format!("CAST(${} AS double precision)", placeholder_idx),
                    param: Some(Box::new(v) as PgParam),
                })
            },
        ));
    }

    None
}

fn bind_pg_string(
    s: &str,
    placeholder_idx: usize,
    options: PgValueOptions<'_>,
) -> Result<BoundValue, String> {
    if options.allow_default && s == "__USE_DEFAULT__" {
        return Ok(BoundValue {
            sql: "DEFAULT".to_string(),
            param: None,
        });
    }

    if let Some(bytes) = crate::drivers::common::decode_blob_wire_format(s, options.max_blob_size) {
        return Ok(BoundValue {
            sql: format!("${}", placeholder_idx),
            param: Some(Box::new(bytes)),
        });
    }

    if let Some(binding) = options
        .column_type
        .and_then(|data_type| bind_pg_boolean_string(s, data_type, placeholder_idx))
    {
        return binding;
    }

    if let Some(binding) = options
        .column_type
        .and_then(|data_type| bind_pg_numeric_string(s, data_type, placeholder_idx))
    {
        return binding;
    }

    if is_raw_sql_function(s) {
        return Ok(BoundValue {
            sql: s.to_string(),
            param: None,
        });
    }

    if is_wkt_geometry(s) {
        return Ok(BoundValue {
            sql: format!("ST_GeomFromText(${})", placeholder_idx),
            param: Some(Box::new(s.to_string())),
        });
    }

    if s.parse::<uuid::Uuid>().is_ok() {
        return Ok(BoundValue {
            sql: format!("CAST(${} AS uuid)", placeholder_idx),
            param: Some(Box::new(s.to_string())),
        });
    }

    if let Some(pg_arr) = try_parse_pg_array(s) {
        return Ok(BoundValue {
            sql: pg_arr?,
            param: None,
        });
    }

    Ok(BoundValue {
        sql: format!("${}", placeholder_idx),
        param: Some(Box::new(s.to_string())),
    })
}
