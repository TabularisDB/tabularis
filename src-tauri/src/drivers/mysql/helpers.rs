use sqlx::Row;

// Helper function to escape backticks in identifiers for MySQL
pub(super) fn escape_identifier(name: &str) -> String {
    name.replace('`', "``")
}

/// Renders a `&str` as a quoted MySQL string literal for the text protocol.
///
/// Used when a query has to bypass the prepared-statement protocol (e.g.
/// behind a Warpgate-style bastion that rejects `COM_STMT_PREPARE`): the
/// value can no longer travel as a bind parameter, so it is inlined as an
/// escaped literal instead. Mirrors `mysql_real_escape_string` for the
/// default `sql_mode` (backslash escapes enabled).
pub(super) fn mysql_string_literal(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('\'');
    for ch in s.chars() {
        match ch {
            '\0' => out.push_str("\\0"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\\' => out.push_str("\\\\"),
            '\'' => out.push_str("\\'"),
            '"' => out.push_str("\\\""),
            '\u{1a}' => out.push_str("\\Z"),
            c => out.push(c),
        }
    }
    out.push('\'');
    out
}

/// Renders raw bytes as a MySQL hexadecimal literal (`x'..'`) for the text
/// protocol — the inlined equivalent of binding a `Vec<u8>` blob parameter.
pub(super) fn mysql_bytes_literal(bytes: &[u8]) -> String {
    use std::fmt::Write;
    let mut out = String::with_capacity(bytes.len() * 2 + 3);
    out.push_str("x'");
    for b in bytes {
        let _ = write!(out, "{:02x}", b);
    }
    out.push('\'');
    out
}

/// Substitutes each `?` placeholder in `sql` with the next quoted string
/// literal from `binds`, in order. Used to turn a parameterised
/// introspection query into a text-protocol statement. Placeholders past
/// the end of `binds` (and `?` chars when `binds` is empty) are left as-is.
///
/// Note: this is only safe for the driver's own queries, whose `?` chars are
/// exclusively bind placeholders (never literal question marks in strings).
pub(super) fn inline_str_placeholders(sql: &str, binds: &[&str]) -> String {
    let mut out = String::with_capacity(sql.len());
    let mut iter = binds.iter();
    for ch in sql.chars() {
        if ch == '?' {
            if let Some(b) = iter.next() {
                out.push_str(&mysql_string_literal(b));
                continue;
            }
        }
        out.push(ch);
    }
    out
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
