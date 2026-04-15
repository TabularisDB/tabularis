use sqlx::Row;

// Helper function to escape backticks in identifiers for MySQL
pub(super) fn escape_identifier(name: &str) -> String {
    name.replace('`', "``")
}

/// Read a string from a MySQL row by index.
/// MySQL 8 information_schema returns VARBINARY/BLOB instead of VARCHAR,
/// so try_get::<String> fails silently. This falls back to reading raw bytes.
pub(super) fn mysql_row_str(row: &sqlx::mysql::MySqlRow, idx: usize) -> String {
    row.try_get::<String, _>(idx).unwrap_or_else(|_| {
        row.try_get::<Vec<u8>, _>(idx)
            .map(|bytes| String::from_utf8_lossy(&bytes).to_string())
            .unwrap_or_default()
    })
}

/// Optional string variant of mysql_row_str.
pub(super) fn mysql_row_str_opt(row: &sqlx::mysql::MySqlRow, idx: usize) -> Option<String> {
    match row.try_get::<Option<String>, _>(idx) {
        Ok(val) => val,
        Err(_) => row
            .try_get::<Option<Vec<u8>>, _>(idx)
            .ok()
            .flatten()
            .map(|bytes| String::from_utf8_lossy(&bytes).to_string()),
    }
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
