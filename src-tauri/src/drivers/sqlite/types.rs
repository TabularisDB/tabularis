use crate::models::DataTypeInfo;

/// Returns the list of data types supported by SQLite.
/// SQLite has a simpler type system with type affinity.
/// Common type names are accepted but stored with affinity rules.
pub fn get_data_types() -> Vec<DataTypeInfo> {
    vec![
        // Core SQLite types (type affinity)
        DataTypeInfo {
            name: "INTEGER".to_string(),
            category: "numeric".to_string(),
            requires_length: false,
            requires_precision: false,
            default_length: None,
            supports_auto_increment: true,
            requires_extension: None,
        },
        DataTypeInfo {
            name: "REAL".to_string(),
            category: "numeric".to_string(),
            requires_length: false,
            requires_precision: false,
            default_length: None,
            supports_auto_increment: false,
            requires_extension: None,
        },
        DataTypeInfo {
            name: "TEXT".to_string(),
            category: "string".to_string(),
            requires_length: false,
            requires_precision: false,
            default_length: None,
            supports_auto_increment: false,
            requires_extension: None,
        },
        DataTypeInfo {
            name: "BLOB".to_string(),
            category: "binary".to_string(),
            requires_length: false,
            requires_precision: false,
            default_length: None,
            supports_auto_increment: false,
            requires_extension: None,
        },
        // Common type name aliases (accepted by SQLite)
        DataTypeInfo {
            name: "VARCHAR".to_string(),
            category: "string".to_string(),
            requires_length: true,
            requires_precision: false,
            default_length: Some("255".to_string()),
            supports_auto_increment: false,
            requires_extension: None,
        },
        DataTypeInfo {
            name: "BOOLEAN".to_string(),
            category: "other".to_string(),
            requires_length: false,
            requires_precision: false,
            default_length: None,
            supports_auto_increment: false,
            requires_extension: None,
        },
        DataTypeInfo {
            name: "DATE".to_string(),
            category: "date".to_string(),
            requires_length: false,
            requires_precision: false,
            default_length: None,
            supports_auto_increment: false,
            requires_extension: None,
        },
        DataTypeInfo {
            name: "DATETIME".to_string(),
            category: "date".to_string(),
            requires_length: false,
            requires_precision: false,
            default_length: None,
            supports_auto_increment: false,
            requires_extension: None,
        },
    ]
}
