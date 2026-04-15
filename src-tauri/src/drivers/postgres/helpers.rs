/// Extract base type name, e.g. "GEOMETRY(Point, 4326)" -> "GEOMETRY", "VARCHAR(255)" -> "VARCHAR"
pub(super) fn extract_base_type(data_type: &str) -> String {
    if let Some(idx) = data_type.find('(') {
        data_type[..idx].trim().to_uppercase()
    } else {
        data_type.trim().to_uppercase()
    }
}

/// Check if PostgreSQL can implicitly cast between these base types (no USING clause needed).
pub(super) fn is_implicit_cast_compatible(old_type: &str, new_type: &str) -> bool {
    if old_type == new_type {
        return true;
    }

    let compatible_groups: &[&[&str]] = &[
        &[
            "SMALLINT",
            "INTEGER",
            "BIGINT",
            "SERIAL",
            "BIGSERIAL",
            "SMALLSERIAL",
        ],
        &["REAL", "DOUBLE PRECISION", "NUMERIC", "DECIMAL", "MONEY"],
        &["CHAR", "VARCHAR", "TEXT", "NAME", "CITEXT"],
        &["TIMESTAMP", "TIMESTAMPTZ"],
        &["TIME", "TIMETZ"],
        &["JSON", "JSONB"],
        &["BIT", "VARBIT"],
    ];

    for group in compatible_groups {
        if group.contains(&old_type) && group.contains(&new_type) {
            return true;
        }
    }
    false
}

// Helper function to escape double quotes in identifiers for PostgreSQL
pub(super) fn escape_identifier(name: &str) -> String {
    name.replace('"', "\"\"")
}

/// Checks if a string value looks like WKT (Well-Known Text) geometry format
pub(super) fn is_wkt_geometry(s: &str) -> bool {
    let s_upper = s.trim().to_uppercase();
    s_upper.starts_with("POINT(")
        || s_upper.starts_with("LINESTRING(")
        || s_upper.starts_with("POLYGON(")
        || s_upper.starts_with("MULTIPOINT(")
        || s_upper.starts_with("MULTILINESTRING(")
        || s_upper.starts_with("MULTIPOLYGON(")
        || s_upper.starts_with("GEOMETRYCOLLECTION(")
        || s_upper.starts_with("GEOMETRY(")
}

/// Convert a JSON array to a PostgreSQL ARRAY[...] literal.
/// Elements are safely formatted to prevent SQL injection.
pub(super) fn json_array_to_pg_literal(arr: &[serde_json::Value]) -> Result<String, String> {
    if arr.is_empty() {
        return Ok("'{}'".to_string());
    }
    let mut parts = Vec::new();
    for val in arr {
        match val {
            serde_json::Value::Number(n) => parts.push(n.to_string()),
            serde_json::Value::String(s) => {
                let escaped = s.replace('\'', "''");
                parts.push(format!("'{}'", escaped));
            }
            serde_json::Value::Bool(b) => parts.push(if *b { "TRUE" } else { "FALSE" }.to_string()),
            serde_json::Value::Null => parts.push("NULL".to_string()),
            serde_json::Value::Array(nested) => {
                parts.push(json_array_to_pg_literal(nested)?);
            }
            _ => return Err("Unsupported array element type".to_string()),
        }
    }
    Ok(format!("ARRAY[{}]", parts.join(", ")))
}

/// Try to parse a string as a JSON array and convert to PostgreSQL array literal.
pub(super) fn try_parse_pg_array(s: &str) -> Option<Result<String, String>> {
    let trimmed = s.trim();
    if trimmed.starts_with('[') && trimmed.ends_with(']') {
        if let Ok(serde_json::Value::Array(arr)) =
            serde_json::from_str::<serde_json::Value>(trimmed)
        {
            return Some(json_array_to_pg_literal(&arr));
        }
    }
    None
}

/// Checks if a string value is a raw SQL function call (e.g., ST_GeomFromText(...))
/// This is used to detect when user has entered a complete SQL function that should
/// be inserted directly into the query without parameter binding
pub(super) fn is_raw_sql_function(s: &str) -> bool {
    let trimmed = s.trim().to_uppercase();
    // Check for common SQL spatial function patterns
    // Functions starting with ST_ followed by parenthesis
    if trimmed.starts_with("ST_") {
        return trimmed.contains('(');
    }
    // Legacy function names
    trimmed.starts_with("GEOMFROMTEXT(")
        || trimmed.starts_with("GEOMFROMWKB(")
        || trimmed.starts_with("POINTFROMTEXT(")
        || trimmed.starts_with("POINTFROMWKB(")
}
