//! Pure SQL Server identifier / literal helpers.
//!
//! These utilities are used when composing SQL strings for metadata queries
//! and DDL generation. They are deliberately kept free of any tiberius or
//! async dependency so they can be unit-tested trivially and reused by
//! multiple modules (introspection, DDL, explain).

/// Wrap an identifier in square brackets — the SQL Server convention that is
/// safest for reserved words and for identifiers containing spaces, dots, or
/// hyphens. A closing bracket inside the identifier is escaped by doubling.
///
/// Reference: <https://learn.microsoft.com/en-us/sql/relational-databases/databases/database-identifiers>
///
/// ```text
/// bracket_quote("dbo")        -> "[dbo]"
/// bracket_quote("my table")   -> "[my table]"
/// bracket_quote("weird]name") -> "[weird]]name]"
/// ```
pub fn bracket_quote(name: &str) -> String {
    let mut out = String::with_capacity(name.len() + 2);
    out.push('[');
    for ch in name.chars() {
        if ch == ']' {
            out.push_str("]]");
        } else {
            out.push(ch);
        }
    }
    out.push(']');
    out
}

/// ANSI-style double-quoted identifier (requires `SET QUOTED_IDENTIFIER ON`,
/// which is the SQL Server default). A double-quote inside the identifier is
/// escaped by doubling. Prefer [`bracket_quote`] for DDL; this is for cases
/// where we echo back the driver-wide `identifier_quote` from the manifest.
pub fn quote_identifier(name: &str) -> String {
    let mut out = String::with_capacity(name.len() + 2);
    out.push('"');
    for ch in name.chars() {
        if ch == '"' {
            out.push_str("\"\"");
        } else {
            out.push(ch);
        }
    }
    out.push('"');
    out
}

/// Produce a `[schema].[object]` reference. When `schema` is `None` or empty,
/// falls back to `[dbo]` (the SQL Server default schema).
pub fn qualify(schema: Option<&str>, object: &str) -> String {
    let schema = schema.unwrap_or("dbo");
    let schema = if schema.trim().is_empty() {
        "dbo"
    } else {
        schema
    };
    format!("{}.{}", bracket_quote(schema), bracket_quote(object))
}

/// Escape a single-quoted string literal by doubling embedded single quotes.
/// **Do not use this for parameterised values** — prefer tiberius parameter
/// binding (`@P1` / `conn.query(sql, &[&value])`). This helper is only for
/// metadata queries where the value is also the searchable key (e.g. when
/// embedding a schema name into a diagnostic comment).
pub fn escape_single_quoted(value: &str) -> String {
    value.replace('\'', "''")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bracket_quote_wraps_plain_identifier() {
        assert_eq!(bracket_quote("dbo"), "[dbo]");
        assert_eq!(bracket_quote("MyTable"), "[MyTable]");
    }

    #[test]
    fn bracket_quote_preserves_dots_and_spaces() {
        assert_eq!(bracket_quote("my.table"), "[my.table]");
        assert_eq!(bracket_quote("name with space"), "[name with space]");
    }

    #[test]
    fn bracket_quote_escapes_closing_bracket() {
        assert_eq!(bracket_quote("weird]name"), "[weird]]name]");
        assert_eq!(bracket_quote("]"), "[]]]");
        assert_eq!(bracket_quote("a]]b"), "[a]]]]b]");
    }

    #[test]
    fn bracket_quote_handles_empty_string() {
        assert_eq!(bracket_quote(""), "[]");
    }

    #[test]
    fn bracket_quote_leaves_other_specials_intact() {
        // Brackets and ] are the only metacharacters inside [..] — square
        // brackets are *not* regex there, and single quotes are irrelevant.
        assert_eq!(bracket_quote("a'b\"c"), "[a'b\"c]");
    }

    #[test]
    fn quote_identifier_wraps_and_escapes_double_quote() {
        assert_eq!(quote_identifier("col"), "\"col\"");
        assert_eq!(quote_identifier("weird\"name"), "\"weird\"\"name\"");
        assert_eq!(quote_identifier(""), "\"\"");
    }

    #[test]
    fn qualify_uses_dbo_when_schema_missing() {
        assert_eq!(qualify(None, "Users"), "[dbo].[Users]");
        assert_eq!(qualify(Some(""), "Users"), "[dbo].[Users]");
        assert_eq!(qualify(Some("   "), "Users"), "[dbo].[Users]");
    }

    #[test]
    fn qualify_keeps_explicit_schema() {
        assert_eq!(qualify(Some("sales"), "Orders"), "[sales].[Orders]");
    }

    #[test]
    fn qualify_escapes_brackets_in_both_parts() {
        assert_eq!(
            qualify(Some("we]ird"), "ta]ble"),
            "[we]]ird].[ta]]ble]"
        );
    }

    #[test]
    fn escape_single_quoted_doubles_apostrophes() {
        assert_eq!(escape_single_quoted("o'brien"), "o''brien");
        assert_eq!(escape_single_quoted("'''"), "''''''");
        assert_eq!(escape_single_quoted("plain"), "plain");
    }

    #[test]
    fn bracket_quote_is_round_trip_safe_through_itself() {
        // Quoting an already-quoted identifier is a useful invariant for
        // nested composition: bracket_quote(bracket_quote(x)) must still be
        // parseable — it just adds another layer of brackets.
        let once = bracket_quote("weird]name");
        let twice = bracket_quote(&once);
        assert!(twice.starts_with('['));
        assert!(twice.ends_with(']'));
        // Inner brackets ']' are each doubled again.
        assert!(twice.contains("]]]]"));
    }
}
