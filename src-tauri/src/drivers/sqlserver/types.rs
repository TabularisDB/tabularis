use crate::models::DataTypeInfo;

/// Returns the list of data types supported by SQL Server.
pub fn get_data_types() -> Vec<DataTypeInfo> {
    vec![
        // Exact numeric
        DataTypeInfo {
            name: "TINYINT".to_string(),
            category: "numeric".to_string(),
            requires_length: false,
            requires_precision: false,
            default_length: None,
            supports_auto_increment: true,
            requires_extension: None,
        },
        DataTypeInfo {
            name: "SMALLINT".to_string(),
            category: "numeric".to_string(),
            requires_length: false,
            requires_precision: false,
            default_length: None,
            supports_auto_increment: true,
            requires_extension: None,
        },
        DataTypeInfo {
            name: "INT".to_string(),
            category: "numeric".to_string(),
            requires_length: false,
            requires_precision: false,
            default_length: None,
            supports_auto_increment: true,
            requires_extension: None,
        },
        DataTypeInfo {
            name: "BIGINT".to_string(),
            category: "numeric".to_string(),
            requires_length: false,
            requires_precision: false,
            default_length: None,
            supports_auto_increment: true,
            requires_extension: None,
        },
        DataTypeInfo {
            name: "DECIMAL".to_string(),
            category: "numeric".to_string(),
            requires_length: false,
            requires_precision: true,
            default_length: Some("18,2".to_string()),
            supports_auto_increment: false,
            requires_extension: None,
        },
        DataTypeInfo {
            name: "NUMERIC".to_string(),
            category: "numeric".to_string(),
            requires_length: false,
            requires_precision: true,
            default_length: Some("18,2".to_string()),
            supports_auto_increment: false,
            requires_extension: None,
        },
        DataTypeInfo {
            name: "SMALLMONEY".to_string(),
            category: "numeric".to_string(),
            requires_length: false,
            requires_precision: false,
            default_length: None,
            supports_auto_increment: false,
            requires_extension: None,
        },
        DataTypeInfo {
            name: "MONEY".to_string(),
            category: "numeric".to_string(),
            requires_length: false,
            requires_precision: false,
            default_length: None,
            supports_auto_increment: false,
            requires_extension: None,
        },
        // Approximate numeric
        DataTypeInfo {
            name: "FLOAT".to_string(),
            category: "numeric".to_string(),
            requires_length: false,
            requires_precision: false,
            default_length: None,
            supports_auto_increment: false,
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
        // Character strings
        DataTypeInfo {
            name: "CHAR".to_string(),
            category: "text".to_string(),
            requires_length: true,
            requires_precision: false,
            default_length: Some("1".to_string()),
            supports_auto_increment: false,
            requires_extension: None,
        },
        DataTypeInfo {
            name: "VARCHAR".to_string(),
            category: "text".to_string(),
            requires_length: true,
            requires_precision: false,
            default_length: Some("255".to_string()),
            supports_auto_increment: false,
            requires_extension: None,
        },
        DataTypeInfo {
            name: "VARCHAR(MAX)".to_string(),
            category: "text".to_string(),
            requires_length: false,
            requires_precision: false,
            default_length: None,
            supports_auto_increment: false,
            requires_extension: None,
        },
        DataTypeInfo {
            name: "TEXT".to_string(),
            category: "text".to_string(),
            requires_length: false,
            requires_precision: false,
            default_length: None,
            supports_auto_increment: false,
            requires_extension: None,
        },
        // Unicode strings
        DataTypeInfo {
            name: "NCHAR".to_string(),
            category: "text".to_string(),
            requires_length: true,
            requires_precision: false,
            default_length: Some("1".to_string()),
            supports_auto_increment: false,
            requires_extension: None,
        },
        DataTypeInfo {
            name: "NVARCHAR".to_string(),
            category: "text".to_string(),
            requires_length: true,
            requires_precision: false,
            default_length: Some("255".to_string()),
            supports_auto_increment: false,
            requires_extension: None,
        },
        DataTypeInfo {
            name: "NVARCHAR(MAX)".to_string(),
            category: "text".to_string(),
            requires_length: false,
            requires_precision: false,
            default_length: None,
            supports_auto_increment: false,
            requires_extension: None,
        },
        DataTypeInfo {
            name: "NTEXT".to_string(),
            category: "text".to_string(),
            requires_length: false,
            requires_precision: false,
            default_length: None,
            supports_auto_increment: false,
            requires_extension: None,
        },
        // Binary
        DataTypeInfo {
            name: "BINARY".to_string(),
            category: "binary".to_string(),
            requires_length: true,
            requires_precision: false,
            default_length: Some("1".to_string()),
            supports_auto_increment: false,
            requires_extension: None,
        },
        DataTypeInfo {
            name: "VARBINARY".to_string(),
            category: "binary".to_string(),
            requires_length: true,
            requires_precision: false,
            default_length: Some("255".to_string()),
            supports_auto_increment: false,
            requires_extension: None,
        },
        DataTypeInfo {
            name: "VARBINARY(MAX)".to_string(),
            category: "binary".to_string(),
            requires_length: false,
            requires_precision: false,
            default_length: None,
            supports_auto_increment: false,
            requires_extension: None,
        },
        DataTypeInfo {
            name: "IMAGE".to_string(),
            category: "binary".to_string(),
            requires_length: false,
            requires_precision: false,
            default_length: None,
            supports_auto_increment: false,
            requires_extension: None,
        },
        // Date / time
        DataTypeInfo {
            name: "DATE".to_string(),
            category: "datetime".to_string(),
            requires_length: false,
            requires_precision: false,
            default_length: None,
            supports_auto_increment: false,
            requires_extension: None,
        },
        DataTypeInfo {
            name: "TIME".to_string(),
            category: "datetime".to_string(),
            requires_length: false,
            requires_precision: false,
            default_length: None,
            supports_auto_increment: false,
            requires_extension: None,
        },
        DataTypeInfo {
            name: "DATETIME".to_string(),
            category: "datetime".to_string(),
            requires_length: false,
            requires_precision: false,
            default_length: None,
            supports_auto_increment: false,
            requires_extension: None,
        },
        DataTypeInfo {
            name: "DATETIME2".to_string(),
            category: "datetime".to_string(),
            requires_length: false,
            requires_precision: false,
            default_length: None,
            supports_auto_increment: false,
            requires_extension: None,
        },
        DataTypeInfo {
            name: "SMALLDATETIME".to_string(),
            category: "datetime".to_string(),
            requires_length: false,
            requires_precision: false,
            default_length: None,
            supports_auto_increment: false,
            requires_extension: None,
        },
        DataTypeInfo {
            name: "DATETIMEOFFSET".to_string(),
            category: "datetime".to_string(),
            requires_length: false,
            requires_precision: false,
            default_length: None,
            supports_auto_increment: false,
            requires_extension: None,
        },
        // Other
        DataTypeInfo {
            name: "BIT".to_string(),
            category: "boolean".to_string(),
            requires_length: false,
            requires_precision: false,
            default_length: None,
            supports_auto_increment: false,
            requires_extension: None,
        },
        DataTypeInfo {
            name: "UNIQUEIDENTIFIER".to_string(),
            category: "other".to_string(),
            requires_length: false,
            requires_precision: false,
            default_length: None,
            supports_auto_increment: false,
            requires_extension: None,
        },
        DataTypeInfo {
            name: "XML".to_string(),
            category: "other".to_string(),
            requires_length: false,
            requires_precision: false,
            default_length: None,
            supports_auto_increment: false,
            requires_extension: None,
        },
        DataTypeInfo {
            name: "SQL_VARIANT".to_string(),
            category: "other".to_string(),
            requires_length: false,
            requires_precision: false,
            default_length: None,
            supports_auto_increment: false,
            requires_extension: None,
        },
        DataTypeInfo {
            name: "ROWVERSION".to_string(),
            category: "other".to_string(),
            requires_length: false,
            requires_precision: false,
            default_length: None,
            supports_auto_increment: false,
            requires_extension: None,
        },
        DataTypeInfo {
            name: "TIMESTAMP".to_string(),
            category: "other".to_string(),
            requires_length: false,
            requires_precision: false,
            default_length: None,
            supports_auto_increment: false,
            requires_extension: None,
        },
        DataTypeInfo {
            name: "HIERARCHYID".to_string(),
            category: "other".to_string(),
            requires_length: false,
            requires_precision: false,
            default_length: None,
            supports_auto_increment: false,
            requires_extension: None,
        },
        DataTypeInfo {
            name: "GEOGRAPHY".to_string(),
            category: "spatial".to_string(),
            requires_length: false,
            requires_precision: false,
            default_length: None,
            supports_auto_increment: false,
            requires_extension: None,
        },
        DataTypeInfo {
            name: "GEOMETRY".to_string(),
            category: "spatial".to_string(),
            requires_length: false,
            requires_precision: false,
            default_length: None,
            supports_auto_increment: false,
            requires_extension: None,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn types_list_is_non_empty() {
        let types = get_data_types();
        assert!(!types.is_empty());
    }

    #[test]
    fn int_supports_auto_increment() {
        let types = get_data_types();
        let int_type = types.iter().find(|t| t.name == "INT").expect("INT must be present");
        assert!(int_type.supports_auto_increment);
    }

    #[test]
    fn varchar_requires_length() {
        let types = get_data_types();
        let t = types.iter().find(|t| t.name == "VARCHAR").expect("VARCHAR must be present");
        assert!(t.requires_length);
    }

    #[test]
    fn decimal_requires_precision() {
        let types = get_data_types();
        let t = types.iter().find(|t| t.name == "DECIMAL").expect("DECIMAL must be present");
        assert!(t.requires_precision);
    }
}
