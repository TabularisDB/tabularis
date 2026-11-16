use super::model::*;
use crate::models::TableColumn;

const POSTGRES: &str = "postgres";
const SQLITE: &str = "sqlite";

pub fn dialect_for_driver(driver: &str) -> Option<TransferDialect> {
    match driver {
        POSTGRES => Some(TransferDialect::Postgres),
        SQLITE => Some(TransferDialect::Sqlite),
        _ => None,
    }
}

pub fn capabilities() -> TableTransferCapabilities {
    let pair = |target: &str| TransferPair {
        source: POSTGRES.to_string(),
        target: target.to_string(),
    };
    TableTransferCapabilities {
        pairs: vec![pair(POSTGRES), pair(SQLITE)],
        write_modes: vec!["append".to_string()],
        conflict_modes: vec!["fail".to_string(), "skip".to_string()],
        max_batch_rows: MAX_BATCH_ROWS,
        default_batch_rows: DEFAULT_BATCH_ROWS,
    }
}

pub fn ensure_supported_pair(source: &str, target: &str) -> Result<(), String> {
    let supported = capabilities()
        .pairs
        .iter()
        .any(|pair| pair.source == source && pair.target == target);
    if supported {
        Ok(())
    } else {
        Err(format!(
            "Table transfer from the {source} driver to the {target} driver is not supported"
        ))
    }
}

pub fn classify_source(column: &TableColumn) -> Option<SourceKind> {
    Some(match column.data_type.to_ascii_lowercase().as_str() {
        "boolean" => SourceKind::Bool,
        "smallint" | "integer" | "bigint" => SourceKind::Int,
        "real" | "double precision" => SourceKind::Float,
        "numeric" => SourceKind::Decimal,
        "text" | "character varying" | "character" => SourceKind::Text,
        "uuid" => SourceKind::Uuid,
        "json" | "jsonb" => SourceKind::Json,
        "date" => SourceKind::Date,
        "time without time zone" => SourceKind::Time,
        "timestamp without time zone" => SourceKind::Timestamp,
        "timestamp with time zone" => SourceKind::TimestampTz,
        "bytea" => SourceKind::Bytes,
        _ => return None,
    })
}

/// Fractional-second precision declared in `timestamp(3) without time zone`.
fn declared_precision(column: &TableColumn) -> Option<u32> {
    let full = column.full_type.as_deref()?;
    let inner = full.split_once('(')?.1.split_once(')')?.0;
    inner.trim().parse().ok()
}

pub fn classify_pg_target(column: &TableColumn) -> Option<PgTarget> {
    Some(match column.data_type.to_ascii_lowercase().as_str() {
        "boolean" => PgTarget::Bool,
        "smallint" => PgTarget::Int(16),
        "integer" => PgTarget::Int(32),
        "bigint" => PgTarget::Int(64),
        "real" => PgTarget::Float(32),
        "double precision" => PgTarget::Float(64),
        "numeric" => {
            if column.numeric_scale.is_some_and(|scale| scale < 0) {
                return None;
            }
            PgTarget::Decimal {
                precision: column.numeric_precision.and_then(|v| u32::try_from(v).ok()),
                scale: column.numeric_scale.and_then(|v| u32::try_from(v).ok()),
            }
        }
        "text" => PgTarget::Text { max_len: None },
        "character varying" => PgTarget::Text {
            max_len: column.character_maximum_length,
        },
        "uuid" => PgTarget::Uuid,
        "json" => PgTarget::Json,
        "jsonb" => PgTarget::Jsonb,
        "date" => PgTarget::Date,
        "time without time zone" => PgTarget::Time {
            precision: declared_precision(column),
        },
        "timestamp without time zone" => PgTarget::Timestamp {
            precision: declared_precision(column),
        },
        "timestamp with time zone" => PgTarget::TimestampTz {
            precision: declared_precision(column),
        },
        "bytea" => PgTarget::Bytea,
        _ => return None,
    })
}

pub fn classify_sqlite_target(declared: &str, strict: bool) -> SqliteTarget {
    let t = declared.trim().to_ascii_uppercase();
    let has = |needles: &[&str]| needles.iter().any(|n| t.contains(n));
    if t.is_empty() || (t == "ANY" && strict) {
        SqliteTarget::Untyped
    } else if has(&["BOOL"]) {
        SqliteTarget::Bool
    } else if has(&["DATE", "TIME"]) {
        SqliteTarget::Temporal
    } else if has(&["JSON"]) {
        SqliteTarget::Json
    } else if has(&["INT"]) {
        SqliteTarget::Integer
    } else if has(&["CHAR", "CLOB", "TEXT"]) {
        SqliteTarget::Text
    } else if has(&["BLOB"]) {
        SqliteTarget::Blob
    } else if has(&["REAL", "FLOA", "DOUB"]) {
        SqliteTarget::Real
    } else {
        SqliteTarget::Numeric
    }
}

pub fn classify_target(
    dialect: TransferDialect,
    column: &TableColumn,
    target_strict: bool,
) -> Option<TargetType> {
    match dialect {
        TransferDialect::Postgres => classify_pg_target(column).map(TargetType::Pg),
        TransferDialect::Sqlite => Some(TargetType::Sqlite(classify_sqlite_target(
            &column.data_type,
            target_strict,
        ))),
    }
}

fn out_for(kind: SourceKind) -> OutKind {
    match kind {
        SourceKind::Bool => OutKind::Bool,
        SourceKind::Int => OutKind::Int,
        SourceKind::Float => OutKind::Float,
        SourceKind::Bytes => OutKind::Bytes,
        _ => OutKind::Text,
    }
}

fn conv(op: Op, out: OutKind, rule: ConversionRule) -> Result<Conversion, &'static str> {
    Ok(Conversion { op, out, rule })
}

const INCOMPATIBLE: &str = "incompatibleTypes";

/// Decides whether `source` may be written into `target`, and how. Anything
/// that would need an implicit, information-losing coercion is refused.
pub fn plan_conversion(source: SourceKind, target: &TargetType) -> Result<Conversion, &'static str> {
    use ConversionRule::{Checked, Exact};
    use SourceKind as S;
    match target {
        TargetType::Pg(t) => match (source, t) {
            (S::Bool, PgTarget::Bool) => conv(Op::Copy, OutKind::Bool, Exact),
            (S::Int, PgTarget::Int(64)) => conv(Op::Copy, OutKind::Int, Exact),
            (S::Int, PgTarget::Int(bits)) => {
                let max = (1i64 << (bits - 1)) - 1;
                conv(Op::IntRange { min: -max - 1, max }, OutKind::Int, Checked)
            }
            (S::Int, PgTarget::Float(bits)) => {
                let max_exact = if *bits == 32 { 1 << 24 } else { 1 << 53 };
                conv(Op::IntToFloat { max_exact }, OutKind::Float, Checked)
            }
            (S::Int, PgTarget::Decimal { precision, scale }) => conv(
                Op::IntToDecimal { precision: *precision, scale: *scale },
                OutKind::Text,
                Checked,
            ),
            (S::Float, PgTarget::Float(bits)) => conv(
                Op::FloatCheck { bits: *bits, allow_non_finite: true },
                OutKind::Float,
                if *bits == 64 { Exact } else { Checked },
            ),
            (S::Decimal, PgTarget::Decimal { precision, scale }) => conv(
                Op::DecimalFit { precision: *precision, scale: *scale },
                OutKind::Text,
                if precision.is_none() { Exact } else { Checked },
            ),
            (S::Decimal, PgTarget::Int(bits)) => {
                let max = if *bits == 64 { i64::MAX } else { (1i64 << (bits - 1)) - 1 };
                conv(Op::DecimalToInt { min: -max - 1, max }, OutKind::Int, Checked)
            }
            (S::Decimal, PgTarget::Float(bits)) => conv(
                Op::DecimalToFloat { bits: *bits, allow_non_finite: true },
                OutKind::Float,
                Checked,
            ),
            (S::Text, PgTarget::Text { max_len: None }) => conv(Op::Copy, OutKind::Text, Exact),
            (S::Text, PgTarget::Text { max_len: Some(max) }) => {
                conv(Op::TextMaxLen { max: *max }, OutKind::Text, Checked)
            }
            (S::Uuid, PgTarget::Uuid)
            | (S::Json, PgTarget::Json | PgTarget::Jsonb)
            | (S::Date, PgTarget::Date) => conv(Op::Copy, OutKind::Text, Exact),
            (S::Time, PgTarget::Time { precision })
            | (S::Timestamp, PgTarget::Timestamp { precision })
            | (S::TimestampTz, PgTarget::TimestampTz { precision }) => match precision {
                Some(p) if *p < 6 => conv(Op::Temporal { precision: *p }, OutKind::Text, Checked),
                _ => conv(Op::Copy, OutKind::Text, Exact),
            },
            (S::Bytes, PgTarget::Bytea) => conv(Op::Copy, OutKind::Bytes, Exact),
            _ => Err(INCOMPATIBLE),
        },
        TargetType::Sqlite(t) => {
            use SqliteTarget as T;
            let any = matches!(t, T::Untyped);
            let text = out_for(source) == OutKind::Text;
            match (source, t) {
                (S::Bool, T::Bool | T::Integer | T::Numeric | T::Untyped) => {
                    conv(Op::BoolToInt, OutKind::Int, Exact)
                }
                (S::Int, T::Integer | T::Numeric | T::Untyped) => {
                    conv(Op::Copy, OutKind::Int, Exact)
                }
                (S::Int, T::Real) => conv(
                    Op::IntToFloat { max_exact: 1 << 53 },
                    OutKind::Float,
                    Checked,
                ),
                (S::Float, T::Real | T::Numeric | T::Untyped) => conv(
                    Op::FloatCheck { bits: 64, allow_non_finite: false },
                    OutKind::Float,
                    Checked,
                ),
                (S::Decimal, T::Text | T::Untyped) => conv(Op::Copy, OutKind::Text, Exact),
                (S::Decimal, T::Integer) => conv(
                    Op::DecimalToInt { min: i64::MIN, max: i64::MAX },
                    OutKind::Int,
                    Checked,
                ),
                (S::Decimal, T::Real) => conv(
                    Op::DecimalToFloat { bits: 64, allow_non_finite: false },
                    OutKind::Float,
                    Checked,
                ),
                (S::Decimal, T::Numeric) => conv(Op::DecimalToNumeric, OutKind::Text, Checked),
                (S::Json, T::Json) => conv(Op::JsonNotNumeric, OutKind::Text, Checked),
                (S::Date | S::Time | S::Timestamp | S::TimestampTz, T::Temporal) => {
                    conv(Op::Copy, OutKind::Text, Exact)
                }
                (S::Bytes, T::Blob | T::Untyped) => conv(Op::Copy, OutKind::Bytes, Exact),
                (_, T::Text) if text && source != S::Decimal => conv(Op::Copy, OutKind::Text, Exact),
                (_, _) if any && text => conv(Op::Copy, OutKind::Text, Exact),
                _ => Err(INCOMPATIBLE),
            }
        }
    }
}
