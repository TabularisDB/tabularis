use serde::{Deserialize, Serialize};

pub const DEFAULT_BATCH_ROWS: usize = 500;
pub const MAX_BATCH_ROWS: usize = 5_000;

/// Source column families the transfer knows how to read exactly.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SourceKind {
    Bool,
    Int,
    Float,
    Decimal,
    Text,
    Uuid,
    Json,
    Date,
    Time,
    Timestamp,
    TimestampTz,
    Bytes,
}

/// A cell in flight between the two databases. Everything that is not a
/// boolean, integer, float or byte string travels as its exact text form.
#[derive(Clone, Debug, PartialEq)]
pub enum TransferValue {
    Null,
    Bool(bool),
    Int(i64),
    Float(f64),
    Text(String),
    Bytes(Vec<u8>),
}

impl TransferValue {
    pub fn approx_bytes(&self) -> usize {
        match self {
            Self::Null | Self::Bool(_) | Self::Int(_) | Self::Float(_) => 8,
            Self::Text(text) => text.len(),
            Self::Bytes(bytes) => bytes.len(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TransferDialect {
    Postgres,
    Sqlite,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PgTarget {
    Bool,
    Int(u8),
    Float(u8),
    Decimal {
        precision: Option<u32>,
        scale: Option<u32>,
    },
    Text {
        max_len: Option<u64>,
    },
    Uuid,
    Json,
    Jsonb,
    Date,
    Time {
        precision: Option<u32>,
    },
    Timestamp {
        precision: Option<u32>,
    },
    TimestampTz {
        precision: Option<u32>,
    },
    Bytea,
}

impl PgTarget {
    /// Unconstrained type a bound parameter is cast to. Length, precision
    /// and scale are enforced by the column itself on assignment, after the
    /// converter has already verified that the value fits.
    pub fn cast_type(&self) -> &'static str {
        match self {
            Self::Bool => "boolean",
            Self::Int(16) => "smallint",
            Self::Int(32) => "integer",
            Self::Int(_) => "bigint",
            Self::Float(32) => "real",
            Self::Float(_) => "double precision",
            Self::Decimal { .. } => "numeric",
            Self::Text { .. } => "text",
            Self::Uuid => "uuid",
            Self::Json => "json",
            Self::Jsonb => "jsonb",
            Self::Date => "date",
            Self::Time { .. } => "time",
            Self::Timestamp { .. } => "timestamp",
            Self::TimestampTz { .. } => "timestamptz",
            Self::Bytea => "bytea",
        }
    }
}

/// SQLite columns by declared type, using the rules of the type-affinity
/// documentation plus a few names that carry meaning for the transfer.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SqliteTarget {
    Integer,
    Real,
    Numeric,
    Text,
    Blob,
    Untyped,
    Bool,
    Temporal,
    Json,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TargetType {
    Pg(PgTarget),
    Sqlite(SqliteTarget),
}

/// Wire type of a bound PostgreSQL parameter for a converted value.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OutKind {
    Bool,
    Int,
    Float,
    Text,
    Bytes,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ConversionRule {
    /// The value moves unchanged.
    Exact,
    /// The value is converted and verified per row; a value that would lose
    /// information is rejected instead of written.
    Checked,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Op {
    Copy,
    BoolToInt,
    IntRange { min: i64, max: i64 },
    IntToFloat { max_exact: i64 },
    IntToDecimal { precision: Option<u32>, scale: Option<u32> },
    FloatCheck { bits: u8, allow_non_finite: bool },
    DecimalFit { precision: Option<u32>, scale: Option<u32> },
    DecimalToInt { min: i64, max: i64 },
    DecimalToFloat { bits: u8, allow_non_finite: bool },
    DecimalToNumeric,
    TextMaxLen { max: u64 },
    Temporal { precision: u32 },
    JsonNotNumeric,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Conversion {
    pub op: Op,
    pub out: OutKind,
    pub rule: ConversionRule,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConvertError {
    OutOfRange,
    Lossy,
    TooLong,
    NonFinite,
    Malformed,
}

impl ConvertError {
    pub fn code(self) -> &'static str {
        match self {
            Self::OutOfRange => "outOfRange",
            Self::Lossy => "lossy",
            Self::TooLong => "tooLong",
            Self::NonFinite => "nonFinite",
            Self::Malformed => "malformed",
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ConflictMode {
    /// Stop at the first row the target rejects.
    #[default]
    Fail,
    /// Skip rows that violate a unique or primary key constraint; every other
    /// rejection still stops the transfer.
    Skip,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnMappingRequest {
    pub source_column: String,
    /// `None` skips the source column explicitly.
    pub target_column: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableSelection {
    pub source_table: String,
    pub target_table: String,
    #[serde(default)]
    pub columns: Vec<ColumnMappingRequest>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableTransferRequest {
    pub source_connection_id: String,
    #[serde(default)]
    pub source_database: Option<String>,
    #[serde(default)]
    pub source_schema: Option<String>,
    pub target_connection_id: String,
    #[serde(default)]
    pub target_database: Option<String>,
    #[serde(default)]
    pub target_schema: Option<String>,
    pub tables: Vec<TableSelection>,
    #[serde(default)]
    pub conflict: ConflictMode,
    #[serde(default)]
    pub batch_rows: Option<usize>,
    #[serde(default)]
    pub transfer_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanIssue {
    pub code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column: Option<String>,
}

impl PlanIssue {
    pub fn new(code: &str, column: Option<&str>) -> Self {
        Self {
            code: code.to_string(),
            column: column.map(str::to_string),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnPlan {
    pub source_column: String,
    pub source_type: String,
    pub target_column: Option<String>,
    pub target_type: Option<String>,
    pub rule: Option<ConversionRule>,
    pub skipped: bool,
    pub issue: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TablePlan {
    pub source_table: String,
    pub target_table: String,
    pub columns: Vec<ColumnPlan>,
    pub issues: Vec<PlanIssue>,
    pub blocking: bool,
    pub estimated_rows: Option<i64>,
}

/// One mapped column, resolved for execution.
#[derive(Clone, Debug)]
pub struct ColumnBinding {
    pub source_column: String,
    pub source_kind: SourceKind,
    pub target_column: String,
    pub target_type: TargetType,
    pub conversion: Conversion,
}

#[derive(Clone, Debug)]
pub struct PlannedTable {
    pub plan: TablePlan,
    pub bindings: Vec<ColumnBinding>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferPair {
    pub source: String,
    pub target: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableTransferCapabilities {
    pub pairs: Vec<TransferPair>,
    pub write_modes: Vec<String>,
    pub conflict_modes: Vec<String>,
    pub max_batch_rows: usize,
    pub default_batch_rows: usize,
}
