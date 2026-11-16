use crate::drivers::common::full_type_if_distinct;
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

/// Read CHARACTER_MAXIMUM_LENGTH, which the column queries cast to UNSIGNED:
/// MySQL 8 reports it as a signed BIGINT and 5.7 as BIGINT UNSIGNED, and sqlx
/// won't decode a signed column into `u64`. NULL means the column has no
/// character length; a value that still fails to decode is logged.
pub(super) fn mysql_row_max_length(
    row: &sqlx::mysql::MySqlRow,
    idx: usize,
    column: &str,
) -> Option<u64> {
    row.try_get::<Option<u64>, _>(idx).unwrap_or_else(|e| {
        log::warn!("MySQL: Could not read the maximum length of column `{column}`: {e}");
        None
    })
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

/// Maps MySQL's `DATA_TYPE` / `COLUMN_TYPE` pair to the `(data_type, full_type)`
/// reported on a `TableColumn`.
///
/// For ENUM and SET, `DATA_TYPE` is only the base name (`enum`) while
/// `COLUMN_TYPE` carries the allowed values (`enum('pending','approved')`), so
/// `COLUMN_TYPE` becomes `data_type` and the UI can offer the values. Every
/// other type keeps the base name in `data_type`, which value handling and
/// SQL generation match on, and `COLUMN_TYPE` (`varchar(255)`,
/// `decimal(10,2)`, `tinyint(1)`, `int unsigned`) goes to `full_type` for
/// display (#1277).
pub(super) fn mysql_column_types(
    data_type: String,
    column_type: String,
) -> (String, Option<String>) {
    if data_type.eq_ignore_ascii_case("enum") || data_type.eq_ignore_ascii_case("set") {
        return (column_type, None);
    }
    let full_type = full_type_if_distinct(&data_type, Some(column_type));
    (data_type, full_type)
}

/// Whether `value` is a `CURRENT_TIMESTAMP`-style default (`CURRENT_TIMESTAMP`,
/// `current_timestamp(3)`, `now()`, `LOCALTIMESTAMP`), which MySQL accepts
/// after `DEFAULT` / `ON UPDATE` without parentheses.
fn is_current_timestamp_default(value: &str) -> bool {
    let lower = value.trim().to_ascii_lowercase();
    let (name, rest) = match lower.find('(') {
        Some(idx) => (&lower[..idx], &lower[idx..]),
        None => (lower.as_str(), ""),
    };
    let known = matches!(
        name.trim_end(),
        "current_timestamp" | "now" | "localtime" | "localtimestamp"
    );
    let args_ok = rest.is_empty()
        || (rest.starts_with('(')
            && rest.ends_with(')')
            && rest[1..rest.len() - 1]
                .trim()
                .chars()
                .all(|c| c.is_ascii_digit()));
    known && args_ok
}

/// Turns the `COLUMN_DEFAULT` that `information_schema.columns` reports into
/// SQL that can follow `DEFAULT` when the column is restated with `CHANGE` or
/// `MODIFY` (#271).
///
/// - MySQL reports literals as raw text (`new`, `5`, `2020-01-02`): they are
///   quoted as string literals, as `SHOW CREATE TABLE` does. Bit literals
///   (`b'1'`) are kept as they are.
/// - Expression defaults are marked `DEFAULT_GENERATED` in `EXTRA` (MySQL
///   8.0.13+): `CURRENT_TIMESTAMP` style values stay bare, any other
///   expression (`uuid()`) is wrapped in parentheses. MySQL 5.7 has no marker,
///   so a `CURRENT_TIMESTAMP` default of a temporal column is kept bare too.
/// - MariaDB (10.2.7+) already reports the default as SQL (`'new'`,
///   `current_timestamp()`), with `NULL` for no default.
pub(super) fn mysql_default_sql(
    raw: Option<&str>,
    extra: &str,
    data_type: &str,
    is_mariadb: bool,
    no_backslash_escapes: bool,
) -> Option<String> {
    let raw = raw?;
    if is_mariadb {
        return if raw.eq_ignore_ascii_case("null") {
            None
        } else {
            Some(raw.to_string())
        };
    }
    let data_type = data_type.to_ascii_lowercase();
    let generated = extra.to_ascii_lowercase().contains("default_generated");
    if generated {
        if is_current_timestamp_default(raw) {
            return Some(raw.to_string());
        }
        let expr = unescape_generated_default(raw);
        let expr = if no_backslash_escapes {
            standard_string_literals(&expr)
        } else {
            expr
        };
        return Some(format!("({expr})"));
    }
    let temporal = matches!(data_type.as_str(), "timestamp" | "datetime");
    if temporal && is_current_timestamp_default(raw) {
        return Some(raw.to_string());
    }
    if data_type == "bit" && raw.starts_with("b'") {
        return Some(raw.to_string());
    }
    Some(mysql_string_literal(raw, no_backslash_escapes))
}

/// `information_schema.COLUMNS.COLUMN_DEFAULT` reports an expression default
/// with its quotes and backslashes escaped once more than in the expression
/// itself: `concat(_latin1\'a\',_latin1\'b\')` for
/// `concat(_latin1'a',_latin1'b')`. Undo that one level, the way
/// `SHOW CREATE TABLE` prints the expression.
fn unescape_generated_default(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            out.push(ch);
            continue;
        }
        match chars.next() {
            Some(next @ ('\'' | '\\')) => out.push(next),
            Some(next) => {
                out.push('\\');
                out.push(next);
            }
            None => out.push('\\'),
        }
    }
    out
}

/// MySQL keeps an expression default's string literals with backslash
/// escapes (`'it\'s'`) even when the session runs with
/// `NO_BACKSLASH_ESCAPES`, where a backslash is an ordinary character and
/// that literal would not end where it should. Rewrite the escapes inside
/// single-quoted literals into the form that mode reads: the character itself,
/// and `''` for a quote. Backquoted identifiers are copied unchanged.
fn standard_string_literals(expr: &str) -> String {
    let mut out = String::with_capacity(expr.len());
    let mut chars = expr.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '`' => {
                out.push(ch);
                for inner in chars.by_ref() {
                    out.push(inner);
                    if inner == '`' {
                        break;
                    }
                }
            }
            '\'' => {
                out.push(ch);
                while let Some(inner) = chars.next() {
                    match inner {
                        '\\' => match chars.next() {
                            Some('0') => out.push('\0'),
                            Some('\'') => out.push_str("''"),
                            Some('b') => out.push('\u{8}'),
                            Some('n') => out.push('\n'),
                            Some('r') => out.push('\r'),
                            Some('t') => out.push('\t'),
                            Some('Z') => out.push('\u{1a}'),
                            // `\%` and `\_` keep their backslash in MySQL.
                            Some(keep @ ('%' | '_')) => {
                                out.push('\\');
                                out.push(keep);
                            }
                            Some(other) => out.push(other),
                            None => out.push('\\'),
                        },
                        '\'' if chars.peek() == Some(&'\'') => {
                            chars.next();
                            out.push_str("''");
                        }
                        '\'' => {
                            out.push(inner);
                            break;
                        }
                        other => out.push(other),
                    }
                }
            }
            other => out.push(other),
        }
    }
    out
}

/// The `ON UPDATE` expression in a column's `EXTRA`
/// (`DEFAULT_GENERATED on update CURRENT_TIMESTAMP` → `CURRENT_TIMESTAMP`).
pub(super) fn mysql_on_update(extra: &str) -> Option<String> {
    const MARKER: &str = "on update ";
    let idx = extra.to_ascii_lowercase().find(MARKER)?;
    let expr = extra[idx + MARKER.len()..].trim();
    (!expr.is_empty()).then(|| expr.to_string())
}

/// Whether `VERSION()` / `@@sql_mode`, read along with the column metadata,
/// say the server is MariaDB / runs with `NO_BACKSLASH_ESCAPES`.
pub(super) fn mysql_server_flags(version: &str, sql_mode: &str) -> (bool, bool) {
    let is_mariadb = version.to_ascii_lowercase().contains("mariadb");
    let no_backslash_escapes = sql_mode
        .split(',')
        .any(|m| m.trim().eq_ignore_ascii_case("NO_BACKSLASH_ESCAPES"));
    (is_mariadb, no_backslash_escapes)
}
