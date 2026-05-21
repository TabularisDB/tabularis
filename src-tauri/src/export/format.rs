use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportFormat {
    Csv,
    Json,
}

impl ExportFormat {
    pub fn parse(s: &str) -> Result<Self, String> {
        match s.trim().to_ascii_lowercase().as_str() {
            "csv" => Ok(Self::Csv),
            "json" => Ok(Self::Json),
            other => Err(format!("Unsupported export format: {}", other)),
        }
    }
}

pub const DEFAULT_CSV_DELIMITER: u8 = b',';

/// Returns the first byte of the supplied string, falling back to a comma when
/// the option is `None`, an empty string, or pure whitespace.
pub fn parse_csv_delimiter(value: Option<&str>) -> u8 {
    value
        .and_then(|d| d.bytes().next())
        .unwrap_or(DEFAULT_CSV_DELIMITER)
}

/// Converts a JSON value into the string representation used by the CSV writer.
/// Strings are emitted verbatim, `null` becomes the sentinel `NULL`, and every
/// other scalar/composite delegates to `Value::to_string`.
pub fn value_to_csv_string(val: &Value) -> String {
    match val {
        Value::String(s) => s.clone(),
        Value::Null => "NULL".to_string(),
        other => other.to_string(),
    }
}
