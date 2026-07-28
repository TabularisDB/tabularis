//! Recognises the few SQL statements that change which databases exist, so the
//! app can keep the sidebar in sync with the server instead of waiting for a
//! manual refresh (#525, following #518 and #524).
//!
//! Everything here is deliberately narrow and fails closed: a statement that
//! isn't unambiguously recognised returns `None` rather than a guess. A missed
//! detection just leaves the sidebar stale until the next refresh, which is
//! today's behaviour anyway; a wrong detection would tell the user a database
//! is gone when it isn't, which is worse than doing nothing.

use crate::ai_activity::{has_trailing_statements, strip_strings_and_comments};

#[cfg(test)]
mod tests;

/// The database targeted by a `DROP DATABASE` / `DROP SCHEMA` statement.
///
/// Returns `None` unless the input is exactly one such statement. In
/// particular, a multi-statement payload returns `None`: which statement
/// actually succeeded is the caller's problem to disambiguate, not this
/// function's to guess.
///
/// The statement must also start with `DROP`, so a leading comment (`-- note`
/// before the statement) is not recognised. Callers pass the statement they
/// just executed, which in practice starts at the keyword; and a miss here only
/// costs a stale sidebar until the next refresh.
pub fn dropped_database(sql: &str) -> Option<String> {
    // Only used to reject multi-statement payloads and to ignore text inside
    // comments and string literals. The walk below reads the original string,
    // because stripping also blanks out quoted identifiers -- which is exactly
    // where the database name lives.
    if has_trailing_statements(&strip_strings_and_comments(sql)) {
        return None;
    }

    let rest = after_keyword(sql, "DROP")?;
    // MySQL and Postgres both accept SCHEMA as a synonym of DATABASE here.
    let rest = after_keyword(rest, "DATABASE").or_else(|| after_keyword(rest, "SCHEMA"))?;
    let rest = match after_keyword(rest, "IF") {
        Some(after_if) => after_keyword(after_if, "EXISTS")?,
        None => rest,
    };

    identifier(rest)
}

/// The text following an ASCII SQL keyword at the start of `s` (after leading
/// whitespace), matched case-insensitively and left-trimmed.
///
/// Requires a word boundary after the keyword -- whitespace, an identifier
/// quote, or end of input -- so `DATABASEX` never matches `DATABASE`.
fn after_keyword<'a>(s: &'a str, keyword: &str) -> Option<&'a str> {
    let s = s.trim_start();
    // Byte slicing is safe here: the keyword is pure ASCII, so if the leading
    // bytes match it they are all single-byte characters and `keyword.len()`
    // lands on a character boundary.
    if s.len() < keyword.len()
        || !s.as_bytes()[..keyword.len()].eq_ignore_ascii_case(keyword.as_bytes())
    {
        return None;
    }
    let tail = &s[keyword.len()..];
    match tail.chars().next() {
        None => Some(tail),
        Some(c) if c.is_whitespace() || is_quote(c) => Some(tail.trim_start()),
        Some(_) => None,
    }
}

/// Whether `c` opens a quoted identifier in any dialect the app supports.
fn is_quote(c: char) -> bool {
    matches!(c, '`' | '"' | '[')
}

/// The single identifier `s` consists of, unquoted.
///
/// Accepts backticks (MySQL/MariaDB), double quotes (Postgres, SQL standard)
/// and brackets (SQL Server), or a bare name. Anything other than whitespace
/// and an optional `;` after the identifier returns `None`, so
/// `DROP DATABASE foo bar` yields nothing rather than silently taking `foo`.
///
/// A doubled quote inside a quoted identifier (a literal backtick in the name)
/// is not handled: it ends the name early, the leftover fails the trailing
/// check, and the result is `None`. That shape is vanishingly rare for a
/// database name, and failing closed costs a missed detection rather than a
/// truncated name.
fn identifier(s: &str) -> Option<String> {
    let name = match s.chars().next()? {
        quote @ ('`' | '"') => delimited(s, quote, quote)?,
        '[' => delimited(s, '[', ']')?,
        _ => bare(s)?,
    };
    Some(name.to_string())
}

/// The text between `open` and the next `close`, if what follows it is only
/// whitespace and an optional statement terminator.
fn delimited(s: &str, open: char, close: char) -> Option<&str> {
    let body = s.strip_prefix(open)?;
    let (name, after) = body.split_once(close)?;
    only_terminator(after).then_some(name)
}

/// A leading unquoted identifier: alphanumerics, `_` and `$` (accepted by
/// MySQL, and present in some legacy schema names).
fn bare(s: &str) -> Option<&str> {
    let end = s
        .find(|c: char| !(c.is_alphanumeric() || c == '_' || c == '$'))
        .unwrap_or(s.len());
    let (name, after) = s.split_at(end);
    (!name.is_empty() && only_terminator(after)).then_some(name)
}

fn only_terminator(s: &str) -> bool {
    matches!(s.trim(), "" | ";")
}
