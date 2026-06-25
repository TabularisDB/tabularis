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
/// escaped literal instead.
///
/// The escaping depends on the server's `sql_mode`: when `NO_BACKSLASH_ESCAPES`
/// is set (ANSI mode, some bastion targets) the backslash is an ordinary
/// character, so a value like `o\'brien` must close the quote by doubling it
/// (`''`) rather than `\'` — otherwise the literal is mis-parsed and user cell
/// values become an injection vector. Quote doubling is also valid in the
/// default mode, but backslash escaping is not portable, so callers must pass
/// the actual server setting via `no_backslash_escapes`.
pub(super) fn mysql_string_literal(s: &str, no_backslash_escapes: bool) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('\'');
    if no_backslash_escapes {
        // Backslash is literal here; the single quote is the only metacharacter
        // inside the literal and is escaped by doubling it. Everything else
        // (including control bytes and backslashes) is emitted verbatim.
        for ch in s.chars() {
            if ch == '\'' {
                out.push_str("''");
            } else {
                out.push(ch);
            }
        }
    } else {
        // Default mode: mirror `mysql_real_escape_string` (backslash escapes on).
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
/// `no_backslash_escapes` is forwarded to [`mysql_string_literal`] so the
/// literals match the server's `sql_mode`.
///
/// # Safety
///
/// This treats every `?` as a bind placeholder, so it is only sound for the
/// driver's own hand-written introspection queries (whose `?` chars are
/// exclusively placeholders). It must never be used to render arbitrary user
/// SQL, where a `?` could appear inside a string literal.
pub(super) fn inline_str_placeholders(
    sql: &str,
    binds: &[&str],
    no_backslash_escapes: bool,
) -> String {
    let mut out = String::with_capacity(sql.len());
    let mut iter = binds.iter();
    for ch in sql.chars() {
        if ch == '?' {
            if let Some(b) = iter.next() {
                out.push_str(&mysql_string_literal(b, no_backslash_escapes));
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
