pub use crate::application::productivity::backfill_history_entries as backfill_missing_database;
#[cfg(test)]
pub(crate) use crate::application::productivity::{atomic_write, backup_corrupt_file};
pub use crate::application::productivity::{QueryHistoryEntry, QueryHistoryResponse};

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};

/// Minimum timed executions required in BOTH the current and prior periods
/// before a query shape can be flagged as a performance regression.
pub const MIN_REGRESSION_SAMPLES: usize = 3;

/// Minimum absolute increase in average recorded duration (milliseconds)
/// required before flagging a regression.
pub const MIN_REGRESSION_DELTA_MS: f64 = 10.0;

/// Minimum relative increase in average recorded duration (+25%)
/// required before flagging a regression.
pub const MIN_REGRESSION_RATIO: f64 = 0.25;

/// Default time window in hours (7 days = 168 hours).
pub const DEFAULT_INSIGHTS_WINDOW_HOURS: u32 = 168;

/// Maximum supported comparison window in hours (365 days).
pub const MAX_INSIGHTS_WINDOW_HOURS: u32 = 24 * 365;

/// Default maximum number of aggregated query shapes returned.
pub const DEFAULT_MAX_INSIGHT_GROUPS: usize = 100;

/// Hard upper bound on aggregated query shapes returned per request.
pub const MAX_INSIGHT_GROUPS: usize = 250;

/// Default maximum number of contributing executions attached per shape for drill-down.
pub const DEFAULT_MAX_EXECUTIONS_PER_GROUP: usize = 20;

/// Hard upper bound on contributing executions attached per shape.
pub const MAX_EXECUTIONS_PER_GROUP: usize = 100;

/// Hard upper bound on stored execution records read for insights per connection.
pub const MAX_INSIGHTS_EXECUTIONS: usize = 5_000;

/// Individual execution record stored in the bounded per-connection execution log.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct QueryHistoryExecutionRecord {
    pub id: String,
    /// ID of the corresponding deduplicated history list entry (`QueryHistoryEntry::id`),
    /// so deleting a history entry also removes its execution samples.
    #[serde(default)]
    pub entry_id: Option<String>,
    pub sql: String,
    pub executed_at: String,
    pub execution_time_ms: Option<f64>,
    pub status: String,
    pub rows_affected: Option<i64>,
    pub error: Option<String>,
    #[serde(default)]
    pub database: Option<String>,
}

impl QueryHistoryExecutionRecord {
    pub fn to_history_entry(&self) -> QueryHistoryEntry {
        QueryHistoryEntry {
            id: self.id.clone(),
            sql: self.sql.clone(),
            executed_at: self.executed_at.clone(),
            execution_time_ms: self.execution_time_ms,
            status: self.status.clone(),
            rows_affected: self.rows_affected,
            error: self.error.clone(),
            database: self.database.clone(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct QueryHistoryInsightsRequest {
    pub connection_id: String,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub window_hours: Option<u32>,
    #[serde(default)]
    pub dialect: Option<String>,
    #[serde(default)]
    pub now: Option<String>,
    #[serde(default)]
    pub max_groups: Option<usize>,
    #[serde(default)]
    pub max_executions_per_group: Option<usize>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QueryHistoryInsightsPolicy {
    pub min_regression_samples: usize,
    pub min_regression_delta_ms: f64,
    pub min_regression_ratio: f64,
    pub timing_source: String,
}

impl Default for QueryHistoryInsightsPolicy {
    fn default() -> Self {
        Self {
            min_regression_samples: MIN_REGRESSION_SAMPLES,
            min_regression_delta_ms: MIN_REGRESSION_DELTA_MS,
            min_regression_ratio: MIN_REGRESSION_RATIO,
            timing_source: "client-observed".to_string(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QueryHistoryInsightsCoverage {
    pub current_window_start: String,
    pub current_window_end: String,
    pub prior_window_start: String,
    pub prior_window_end: String,
    pub total_stored_executions: usize,
    pub max_stored_executions: usize,
    pub retention_cap_reached: bool,
    pub oldest_recorded_at: Option<String>,
    pub prior_window_fully_covered: bool,
    pub current_window_executions: usize,
    pub current_window_missing_duration_count: usize,
    pub prior_window_executions: usize,
    pub prior_window_missing_duration_count: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QueryHistoryShapeInsight {
    pub fingerprint: String,
    pub example_sql: String,
    pub statement_kind: String,
    pub databases: Vec<String>,
    pub has_unrecorded_database: bool,
    pub last_executed_at: String,
    pub call_count: usize,
    pub timed_sample_count: usize,
    pub missing_duration_count: usize,
    pub total_duration_ms: f64,
    pub avg_duration_ms: Option<f64>,
    pub max_duration_ms: Option<f64>,
    pub failure_count: usize,
    pub failure_rate: f64,
    pub prior_call_count: usize,
    pub prior_timed_sample_count: usize,
    pub prior_missing_duration_count: usize,
    pub prior_total_duration_ms: f64,
    pub prior_avg_duration_ms: Option<f64>,
    pub prior_failure_count: usize,
    pub prior_failure_rate: f64,
    pub delta_avg_ms: Option<f64>,
    pub relative_delta_avg: Option<f64>,
    pub is_regressed: bool,
    pub regression_status: String,
    pub contributing_executions: Vec<QueryHistoryEntry>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QueryHistoryInsightsResponse {
    pub groups: Vec<QueryHistoryShapeInsight>,
    pub coverage: QueryHistoryInsightsCoverage,
    pub policy: QueryHistoryInsightsPolicy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum InsightsDialect {
    Postgres,
    Mysql,
    Sqlite,
    Mssql,
    Oracle,
    Generic,
}

impl InsightsDialect {
    fn from_name(raw: Option<&str>) -> Self {
        let Some(name) = raw.map(|s| s.trim().to_ascii_lowercase()) else {
            return Self::Postgres;
        };
        match name.as_str() {
            "mysql" | "mariadb" | "tidb" | "singlestoredb" => Self::Mysql,
            "sqlite" | "sqlite3" => Self::Sqlite,
            "mssql" | "sqlserver" | "transactsql" => Self::Mssql,
            "oracle" | "plsql" => Self::Oracle,
            "generic" | "sql" => Self::Generic,
            _ => Self::Postgres,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum SqlToken {
    Keyword(String),
    Identifier(String),
    Literal(String),
    Operator(String),
    LParen,
    RParen,
    Comma,
    Dot,
    Semicolon,
}

fn is_sql_keyword(upper: &str) -> bool {
    matches!(
        upper,
        "SELECT"
            | "FROM"
            | "WHERE"
            | "JOIN"
            | "LEFT"
            | "RIGHT"
            | "INNER"
            | "OUTER"
            | "FULL"
            | "CROSS"
            | "NATURAL"
            | "ON"
            | "USING"
            | "AND"
            | "OR"
            | "NOT"
            | "IN"
            | "EXISTS"
            | "BETWEEN"
            | "LIKE"
            | "ILIKE"
            | "SIMILAR"
            | "IS"
            | "NULL"
            | "AS"
            | "DISTINCT"
            | "ALL"
            | "GROUP"
            | "BY"
            | "HAVING"
            | "ORDER"
            | "ASC"
            | "DESC"
            | "NULLS"
            | "FIRST"
            | "LAST"
            | "LIMIT"
            | "OFFSET"
            | "FETCH"
            | "NEXT"
            | "ROWS"
            | "ONLY"
            | "INSERT"
            | "INTO"
            | "VALUES"
            | "DEFAULT"
            | "UPDATE"
            | "SET"
            | "DELETE"
            | "RETURNING"
            | "WITH"
            | "RECURSIVE"
            | "UNION"
            | "INTERSECT"
            | "EXCEPT"
            | "CASE"
            | "WHEN"
            | "THEN"
            | "ELSE"
            | "END"
            | "CAST"
            | "OVER"
            | "PARTITION"
            | "WINDOW"
            | "FILTER"
            | "CREATE"
            | "ALTER"
            | "DROP"
            | "TABLE"
            | "VIEW"
            | "INDEX"
            | "TRIGGER"
            | "EXPLAIN"
            | "ANALYZE"
            | "BEGIN"
            | "COMMIT"
            | "ROLLBACK"
            | "TRANSACTION"
            | "PRAGMA"
            | "SHOW"
            | "DESCRIBE"
            | "USE"
            | "CONFLICT"
            | "DO"
            | "NOTHING"
            | "FOR"
            | "SHARE"
            | "NOWAIT"
            | "SKIP"
            | "LOCKED"
            | "TOP"
    )
}

fn match_dollar_quote_tag(bytes: &[u8], start: usize) -> Option<usize> {
    if bytes.get(start) != Some(&b'$') {
        return None;
    }
    let mut i = start + 1;
    if i < bytes.len() && bytes[i] == b'$' {
        return Some(2);
    }
    if i >= bytes.len() || !(bytes[i].is_ascii_alphabetic() || bytes[i] == b'_') {
        return None;
    }
    i += 1;
    while i < bytes.len() && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_') {
        i += 1;
    }
    if i < bytes.len() && bytes[i] == b'$' {
        Some(i + 1 - start)
    } else {
        None
    }
}

/// Normalizes a SQL statement into a canonical query shape fingerprint using a
/// documented dialect-aware policy:
/// - Strips line comments (`--`, plus `#` in MySQL; respects MySQL `-- ` whitespace rule)
///   and block comments (`/* ... */`, with nested block comments in Postgres/MSSQL).
/// - Replaces string literals (`'...'`, Postgres `E'...'` and `$$...$$`, MySQL `"..."`)
///   with `'?'` and numeric/hex/bit/boolean literals with `?`.
/// - Preserves SQL structure, statement verbs (`SELECT` vs `UPDATE` vs `DELETE`),
///   table/column identifiers, and dialect-quoted identifiers (`"..."` outside MySQL,
///   `` `...` `` in MySQL/SQLite, `[...]` in MSSQL/SQLite).
/// - Collapses literal-only `IN (?, ?, ...)` lists to `IN (?+)`.
pub fn normalize_sql_for_insights(sql: &str, dialect: Option<&str>) -> String {
    let dialect = InsightsDialect::from_name(dialect);
    let bytes = sql.as_bytes();
    let len = bytes.len();
    let mut i = 0;
    let mut raw_tokens: Vec<SqlToken> = Vec::new();

    while i < len {
        let b = bytes[i];

        // 1. Whitespace
        if b.is_ascii_whitespace() {
            i += 1;
            continue;
        }

        // 2. Line comments: `--`
        if b == b'-' && i + 1 < len && bytes[i + 1] == b'-' {
            let is_comment = if dialect == InsightsDialect::Mysql {
                i + 2 >= len
                    || bytes[i + 2].is_ascii_whitespace()
                    || bytes[i + 2].is_ascii_control()
            } else {
                true
            };
            if is_comment {
                i += 2;
                while i < len && bytes[i] != b'\n' && bytes[i] != b'\r' {
                    i += 1;
                }
                continue;
            }
        }

        // 3. MySQL `#` line comment
        if b == b'#' && dialect == InsightsDialect::Mysql {
            i += 1;
            while i < len && bytes[i] != b'\n' {
                i += 1;
            }
            continue;
        }

        // 4. Block comments `/* ... */`
        if b == b'/' && i + 1 < len && bytes[i + 1] == b'*' {
            let nested = matches!(dialect, InsightsDialect::Postgres | InsightsDialect::Mssql);
            i += 2;
            let mut depth = 1usize;
            while i < len && depth > 0 {
                if nested && i + 1 < len && bytes[i] == b'/' && bytes[i + 1] == b'*' {
                    depth += 1;
                    i += 2;
                } else if i + 1 < len && bytes[i] == b'*' && bytes[i + 1] == b'/' {
                    depth -= 1;
                    i += 2;
                } else {
                    i += 1;
                }
            }
            continue;
        }

        // 5. Postgres dollar-quoted strings `$$...$$` or `$tag$...$tag$` and `$1` params
        if b == b'$' && dialect == InsightsDialect::Postgres {
            if let Some(tag_len) = match_dollar_quote_tag(bytes, i) {
                let tag = &sql[i..i + tag_len];
                i += tag_len;
                if let Some(rel_end) = sql[i..].find(tag) {
                    i += rel_end + tag_len;
                } else {
                    i = len;
                }
                raw_tokens.push(SqlToken::Literal("'?'".to_string()));
                continue;
            }
            if i + 1 < len && bytes[i + 1].is_ascii_digit() {
                let start = i;
                i += 1;
                while i < len && bytes[i].is_ascii_digit() {
                    i += 1;
                }
                raw_tokens.push(SqlToken::Identifier(sql[start..i].to_string()));
                continue;
            }
        }

        // 6. Prefixed string or hex/bit literals: E'...', N'...', X'...', B'...'
        if (b.eq_ignore_ascii_case(&b'e')
            || b.eq_ignore_ascii_case(&b'n')
            || b.eq_ignore_ascii_case(&b'x')
            || b.eq_ignore_ascii_case(&b'b'))
            && i + 1 < len
            && bytes[i + 1] == b'\''
            && (i == 0 || !(bytes[i - 1].is_ascii_alphanumeric() || bytes[i - 1] == b'_'))
        {
            let prefix = b.to_ascii_lowercase();
            let backslash_escape = (prefix == b'e' && dialect == InsightsDialect::Postgres)
                || dialect == InsightsDialect::Mysql;
            i += 2; // skip prefix + opening `'`
            while i < len {
                if backslash_escape && bytes[i] == b'\\' {
                    i = (i + 2).min(len);
                    continue;
                }
                if bytes[i] == b'\'' {
                    if i + 1 < len && bytes[i + 1] == b'\'' {
                        i += 2;
                        continue;
                    }
                    i += 1;
                    break;
                }
                i += 1;
            }
            let placeholder = if prefix == b'x' || prefix == b'b' {
                "?"
            } else {
                "'?'"
            };
            raw_tokens.push(SqlToken::Literal(placeholder.to_string()));
            continue;
        }

        // 7. Single-quoted string literal `'...'`
        if b == b'\'' {
            let backslash_escape = dialect == InsightsDialect::Mysql;
            i += 1;
            while i < len {
                if backslash_escape && bytes[i] == b'\\' {
                    i = (i + 2).min(len);
                    continue;
                }
                if bytes[i] == b'\'' {
                    if i + 1 < len && bytes[i + 1] == b'\'' {
                        i += 2;
                        continue;
                    }
                    i += 1;
                    break;
                }
                i += 1;
            }
            raw_tokens.push(SqlToken::Literal("'?'".to_string()));
            continue;
        }

        // 8. Double-quoted string (MySQL) or identifier (all other dialects)
        if b == b'"' {
            let start = i;
            let is_mysql_string = dialect == InsightsDialect::Mysql;
            i += 1;
            while i < len {
                if is_mysql_string && bytes[i] == b'\\' {
                    i = (i + 2).min(len);
                    continue;
                }
                if bytes[i] == b'"' {
                    if i + 1 < len && bytes[i + 1] == b'"' {
                        i += 2;
                        continue;
                    }
                    i += 1;
                    break;
                }
                i += 1;
            }
            if is_mysql_string {
                raw_tokens.push(SqlToken::Literal("'?'".to_string()));
            } else {
                raw_tokens.push(SqlToken::Identifier(sql[start..i].to_string()));
            }
            continue;
        }

        // 9. Backtick-quoted identifier `` `...` `` (MySQL / SQLite / Generic)
        if b == b'`' {
            let start = i;
            i += 1;
            while i < len {
                if bytes[i] == b'`' {
                    if i + 1 < len && bytes[i + 1] == b'`' {
                        i += 2;
                        continue;
                    }
                    i += 1;
                    break;
                }
                i += 1;
            }
            raw_tokens.push(SqlToken::Identifier(sql[start..i].to_string()));
            continue;
        }

        // 10. Bracket-quoted identifier `[...]` (MSSQL / SQLite)
        if b == b'[' && matches!(dialect, InsightsDialect::Mssql | InsightsDialect::Sqlite) {
            let start = i;
            i += 1;
            while i < len {
                if bytes[i] == b']' {
                    if dialect == InsightsDialect::Mssql && i + 1 < len && bytes[i + 1] == b']' {
                        i += 2;
                        continue;
                    }
                    i += 1;
                    break;
                }
                i += 1;
            }
            raw_tokens.push(SqlToken::Identifier(sql[start..i].to_string()));
            continue;
        }

        // 11. Numeric literals (including `0x...` hex and `.5` leading-dot decimals)
        if b.is_ascii_digit() || (b == b'.' && i + 1 < len && bytes[i + 1].is_ascii_digit()) {
            if b == b'0' && i + 1 < len && (bytes[i + 1] == b'x' || bytes[i + 1] == b'X') {
                i += 2;
                while i < len && bytes[i].is_ascii_hexdigit() {
                    i += 1;
                }
                raw_tokens.push(SqlToken::Literal("?".to_string()));
                continue;
            }
            if b == b'.' {
                i += 1;
                while i < len && bytes[i].is_ascii_digit() {
                    i += 1;
                }
            } else {
                while i < len && bytes[i].is_ascii_digit() {
                    i += 1;
                }
                if i < len && bytes[i] == b'.' {
                    i += 1;
                    while i < len && bytes[i].is_ascii_digit() {
                        i += 1;
                    }
                }
            }
            if i < len && (bytes[i] == b'e' || bytes[i] == b'E') {
                let mut exp_i = i + 1;
                if exp_i < len && (bytes[exp_i] == b'+' || bytes[exp_i] == b'-') {
                    exp_i += 1;
                }
                if exp_i < len && bytes[exp_i].is_ascii_digit() {
                    i = exp_i + 1;
                    while i < len && bytes[i].is_ascii_digit() {
                        i += 1;
                    }
                }
            }
            raw_tokens.push(SqlToken::Literal("?".to_string()));
            continue;
        }

        // 12. Identifiers / Keywords / @variables
        if b.is_ascii_alphabetic() || b == b'_' || b == b'@' {
            let start = i;
            i += 1;
            if b == b'@' && i < len && bytes[i] == b'@' {
                i += 1;
            }
            while i < len
                && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_' || bytes[i] == b'$')
            {
                i += 1;
            }
            let word = &sql[start..i];
            if b == b'@' {
                raw_tokens.push(SqlToken::Identifier(word.to_ascii_lowercase()));
            } else {
                let upper = word.to_ascii_uppercase();
                if upper == "TRUE" || upper == "FALSE" {
                    raw_tokens.push(SqlToken::Literal("?".to_string()));
                } else if is_sql_keyword(&upper) {
                    raw_tokens.push(SqlToken::Keyword(upper));
                } else {
                    raw_tokens.push(SqlToken::Identifier(word.to_ascii_lowercase()));
                }
            }
            continue;
        }

        // 13. Punctuation & Operators
        match b {
            b'(' => {
                raw_tokens.push(SqlToken::LParen);
                i += 1;
            }
            b')' => {
                raw_tokens.push(SqlToken::RParen);
                i += 1;
            }
            b',' => {
                raw_tokens.push(SqlToken::Comma);
                i += 1;
            }
            b'.' => {
                raw_tokens.push(SqlToken::Dot);
                i += 1;
            }
            b';' => {
                raw_tokens.push(SqlToken::Semicolon);
                i += 1;
            }
            b'?' => {
                raw_tokens.push(SqlToken::Literal("?".to_string()));
                i += 1;
            }
            _ => {
                // Multi-character operators
                let three = if i + 2 < len {
                    bytes.get(i..i + 3)
                } else {
                    None
                };
                let two = if i + 1 < len {
                    bytes.get(i..i + 2)
                } else {
                    None
                };
                if matches!(three, Some(b"->>" | b"#>>")) {
                    raw_tokens.push(SqlToken::Operator(
                        std::str::from_utf8(three.unwrap()).unwrap().to_string(),
                    ));
                    i += 3;
                } else if matches!(
                    two,
                    Some(
                        b"<="
                            | b">="
                            | b"<>"
                            | b"!="
                            | b"::"
                            | b"||"
                            | b"->"
                            | b"#>"
                            | b"@>"
                            | b"<@"
                    )
                ) {
                    raw_tokens.push(SqlToken::Operator(
                        std::str::from_utf8(two.unwrap()).unwrap().to_string(),
                    ));
                    i += 2;
                } else if b.is_ascii() {
                    raw_tokens.push(SqlToken::Operator((b as char).to_string()));
                    i += 1;
                } else {
                    // Non-ASCII character outside quotes: advance by UTF-8 char
                    let ch = sql[i..].chars().next().unwrap();
                    raw_tokens.push(SqlToken::Identifier(ch.to_string()));
                    i += ch.len_utf8();
                }
            }
        }
    }

    // Strip trailing semicolons
    while matches!(raw_tokens.last(), Some(SqlToken::Semicolon)) {
        raw_tokens.pop();
    }

    // Fold unary `+` / `-` before numeric literal `?` when preceded by an expression boundary
    let mut folded_tokens: Vec<SqlToken> = Vec::with_capacity(raw_tokens.len());
    let mut idx = 0;
    while idx < raw_tokens.len() {
        if let SqlToken::Operator(op) = &raw_tokens[idx] {
            if (op == "-" || op == "+")
                && matches!(raw_tokens.get(idx + 1), Some(SqlToken::Literal(lit)) if lit == "?")
            {
                let prev_is_boundary = match folded_tokens.last() {
                    None
                    | Some(SqlToken::LParen)
                    | Some(SqlToken::Comma)
                    | Some(SqlToken::Semicolon)
                    | Some(SqlToken::Operator(_)) => true,
                    Some(SqlToken::Keyword(k)) => k != "END" && k != "NULL",
                    _ => false,
                };
                if prev_is_boundary {
                    folded_tokens.push(SqlToken::Literal("?".to_string()));
                    idx += 2;
                    continue;
                }
            }
        }
        folded_tokens.push(raw_tokens[idx].clone());
        idx += 1;
    }

    // Collapse `IN (?, ?, ...)` literal-only lists into `IN (?+)`
    let mut tokens: Vec<SqlToken> = Vec::with_capacity(folded_tokens.len());
    let mut k = 0;
    while k < folded_tokens.len() {
        if matches!(&folded_tokens[k], SqlToken::Keyword(kw) if kw == "IN")
            && matches!(folded_tokens.get(k + 1), Some(SqlToken::LParen))
        {
            let mut cursor = k + 2;
            let mut literal_count = 0usize;
            let mut expect_literal = true;
            let mut valid_list = false;
            while cursor < folded_tokens.len() {
                match &folded_tokens[cursor] {
                    SqlToken::Literal(lit) if expect_literal && (lit == "?" || lit == "'?'") => {
                        literal_count += 1;
                        expect_literal = false;
                        cursor += 1;
                    }
                    SqlToken::Comma if !expect_literal => {
                        expect_literal = true;
                        cursor += 1;
                    }
                    SqlToken::RParen if !expect_literal && literal_count > 0 => {
                        valid_list = true;
                        break;
                    }
                    _ => break,
                }
            }
            if valid_list {
                tokens.push(SqlToken::Keyword("IN".to_string()));
                tokens.push(SqlToken::LParen);
                tokens.push(SqlToken::Literal("?+".to_string()));
                tokens.push(SqlToken::RParen);
                k = cursor + 1;
                continue;
            }
        }
        tokens.push(folded_tokens[k].clone());
        k += 1;
    }

    // Render normalized token stream
    let mut out = String::new();
    for (pos, tok) in tokens.iter().enumerate() {
        let text = match tok {
            SqlToken::Keyword(s)
            | SqlToken::Identifier(s)
            | SqlToken::Literal(s)
            | SqlToken::Operator(s) => s.as_str(),
            SqlToken::LParen => "(",
            SqlToken::RParen => ")",
            SqlToken::Comma => ",",
            SqlToken::Dot => ".",
            SqlToken::Semicolon => ";",
        };
        if pos > 0 {
            let prev = &tokens[pos - 1];
            let no_space_before = matches!(
                tok,
                SqlToken::Comma | SqlToken::RParen | SqlToken::Semicolon | SqlToken::Dot
            ) || matches!(tok, SqlToken::Operator(op) if op == "::");
            let no_space_after = matches!(prev, SqlToken::LParen | SqlToken::Dot)
                || matches!(prev, SqlToken::Operator(op) if op == "::");
            if !no_space_before && !no_space_after {
                out.push(' ');
            }
        }
        out.push_str(text);
    }

    out
}

/// Extracts the leading SQL operation verb (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `WITH`, etc.)
/// from a normalized query fingerprint.
pub fn extract_statement_kind(normalized_sql: &str) -> String {
    normalized_sql
        .split_whitespace()
        .next()
        .map(|token| {
            token
                .trim_matches(|c: char| !c.is_ascii_alphabetic())
                .to_ascii_uppercase()
        })
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "OTHER".to_string())
}

fn matches_database_filter(entry_db: Option<&str>, filter: Option<&str>) -> bool {
    let Some(raw) = filter
        .map(str::trim)
        .filter(|s| !s.is_empty() && *s != "all")
    else {
        return true;
    };
    let recorded = entry_db.map(str::trim).filter(|s| !s.is_empty());
    if raw == "none" {
        return recorded.is_none();
    }
    let expected = raw.strip_prefix("db:").unwrap_or(raw);
    recorded == Some(expected)
}

fn parse_timestamp(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

#[derive(Default)]
struct PeriodAccumulator {
    call_count: usize,
    timed_sample_count: usize,
    missing_duration_count: usize,
    total_duration_ms: f64,
    max_duration_ms: Option<f64>,
    failure_count: usize,
}

impl PeriodAccumulator {
    fn record(&mut self, entry: &QueryHistoryEntry) {
        self.call_count += 1;
        if entry.status != "success" {
            self.failure_count += 1;
        }
        match entry.execution_time_ms {
            Some(ms) if ms.is_finite() && ms >= 0.0 => {
                self.timed_sample_count += 1;
                self.total_duration_ms += ms;
                self.max_duration_ms = Some(self.max_duration_ms.map_or(ms, |prev| prev.max(ms)));
            }
            _ => {
                self.missing_duration_count += 1;
            }
        }
    }

    fn avg_duration_ms(&self) -> Option<f64> {
        if self.timed_sample_count > 0 {
            Some(self.total_duration_ms / (self.timed_sample_count as f64))
        } else {
            None
        }
    }

    fn failure_rate(&self) -> f64 {
        if self.call_count > 0 {
            (self.failure_count as f64) / (self.call_count as f64)
        } else {
            0.0
        }
    }
}

struct GroupAccumulator {
    fingerprint: String,
    example_sql: String,
    statement_kind: String,
    databases: BTreeSet<String>,
    has_unrecorded_database: bool,
    last_executed_at: String,
    last_executed_dt: DateTime<Utc>,
    current: PeriodAccumulator,
    prior: PeriodAccumulator,
    contributing_executions: Vec<(DateTime<Utc>, QueryHistoryEntry)>,
}

/// Evaluates whether a query shape has regressed, improved, remained stable, or
/// lacks sufficient timed samples (`MIN_REGRESSION_SAMPLES` in both windows).
pub fn evaluate_regression(
    current_timed_samples: usize,
    current_avg_ms: Option<f64>,
    prior_timed_samples: usize,
    prior_avg_ms: Option<f64>,
) -> (Option<f64>, Option<f64>, bool, String) {
    let (Some(curr_avg), Some(prev_avg)) = (current_avg_ms, prior_avg_ms) else {
        return (None, None, false, "insufficientSamples".to_string());
    };
    let delta_ms = curr_avg - prev_avg;
    let relative = if prev_avg > 0.0 {
        Some(delta_ms / prev_avg)
    } else if delta_ms > 0.0 {
        Some(f64::INFINITY)
    } else {
        Some(0.0)
    };

    if current_timed_samples < MIN_REGRESSION_SAMPLES
        || prior_timed_samples < MIN_REGRESSION_SAMPLES
    {
        let clean_rel = relative.filter(|r| r.is_finite());
        return (
            Some(delta_ms),
            clean_rel,
            false,
            "insufficientSamples".to_string(),
        );
    }

    let meets_delta = delta_ms >= MIN_REGRESSION_DELTA_MS;
    let meets_ratio = relative.is_some_and(|r| r >= MIN_REGRESSION_RATIO);
    if meets_delta && meets_ratio {
        return (
            Some(delta_ms),
            relative.filter(|r| r.is_finite()),
            true,
            "regressed".to_string(),
        );
    }

    if delta_ms <= -MIN_REGRESSION_DELTA_MS && relative.is_some_and(|r| r <= -MIN_REGRESSION_RATIO)
    {
        return (
            Some(delta_ms),
            relative.filter(|r| r.is_finite()),
            false,
            "improved".to_string(),
        );
    }

    (
        Some(delta_ms),
        relative.filter(|r| r.is_finite()),
        false,
        "stable".to_string(),
    )
}

/// Aggregates bounded query history executions into normalized query shapes and
/// compares the selected current time window against the immediately preceding
/// window of equal duration.
pub fn compute_query_history_insights(
    entries: &[QueryHistoryEntry],
    max_stored_executions: usize,
    request: &QueryHistoryInsightsRequest,
) -> Result<QueryHistoryInsightsResponse, String> {
    let now_dt = match request
        .now
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(raw) => {
            parse_timestamp(raw).ok_or_else(|| "Invalid reference timestamp".to_string())?
        }
        None => Utc::now(),
    };

    let window_hours = request
        .window_hours
        .unwrap_or(DEFAULT_INSIGHTS_WINDOW_HOURS)
        .clamp(1, MAX_INSIGHTS_WINDOW_HOURS);
    let max_groups = request
        .max_groups
        .unwrap_or(DEFAULT_MAX_INSIGHT_GROUPS)
        .clamp(1, MAX_INSIGHT_GROUPS);
    let max_executions_per_group = request
        .max_executions_per_group
        .unwrap_or(DEFAULT_MAX_EXECUTIONS_PER_GROUP)
        .clamp(1, MAX_EXECUTIONS_PER_GROUP);

    let window_duration = Duration::hours(i64::from(window_hours));
    let current_start = now_dt - window_duration;
    let prior_start = current_start - window_duration;

    let total_stored_executions = entries.len();
    let retention_cap_reached =
        max_stored_executions > 0 && total_stored_executions >= max_stored_executions;

    let mut oldest_dt: Option<DateTime<Utc>> = None;
    for entry in entries {
        if let Some(dt) = parse_timestamp(&entry.executed_at) {
            oldest_dt = Some(oldest_dt.map_or(dt, |prev| prev.min(dt)));
        }
    }
    let oldest_recorded_at = oldest_dt.map(|dt| dt.to_rfc3339());
    let prior_window_fully_covered = if retention_cap_reached {
        oldest_dt.is_some_and(|oldest| oldest <= prior_start)
    } else {
        true
    };

    let mut current_window_executions = 0usize;
    let mut current_window_missing_duration_count = 0usize;
    let mut prior_window_executions = 0usize;
    let mut prior_window_missing_duration_count = 0usize;

    let mut groups_map: HashMap<String, GroupAccumulator> = HashMap::new();

    for entry in entries {
        if !matches_database_filter(entry.database.as_deref(), request.database.as_deref()) {
            continue;
        }
        let Some(executed_dt) = parse_timestamp(&entry.executed_at) else {
            continue;
        };
        if executed_dt > now_dt || executed_dt < prior_start {
            continue;
        }

        let in_current = executed_dt >= current_start;
        let fingerprint = normalize_sql_for_insights(&entry.sql, request.dialect.as_deref());
        if fingerprint.is_empty() {
            continue;
        }

        let missing_duration = !entry
            .execution_time_ms
            .is_some_and(|ms| ms.is_finite() && ms >= 0.0);

        if in_current {
            current_window_executions += 1;
            if missing_duration {
                current_window_missing_duration_count += 1;
            }
        } else {
            prior_window_executions += 1;
            if missing_duration {
                prior_window_missing_duration_count += 1;
            }
        }

        let group = groups_map.entry(fingerprint.clone()).or_insert_with(|| {
            let statement_kind = extract_statement_kind(&fingerprint);
            GroupAccumulator {
                fingerprint,
                example_sql: entry.sql.clone(),
                statement_kind,
                databases: BTreeSet::new(),
                has_unrecorded_database: false,
                last_executed_at: entry.executed_at.clone(),
                last_executed_dt: executed_dt,
                current: PeriodAccumulator::default(),
                prior: PeriodAccumulator::default(),
                contributing_executions: Vec::new(),
            }
        });

        if executed_dt > group.last_executed_dt {
            group.last_executed_dt = executed_dt;
            group.last_executed_at = entry.executed_at.clone();
            group.example_sql = entry.sql.clone();
        }

        match entry
            .database
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            Some(db) => {
                group.databases.insert(db.to_string());
            }
            None => {
                group.has_unrecorded_database = true;
            }
        }

        if in_current {
            group.current.record(entry);
            group
                .contributing_executions
                .push((executed_dt, entry.clone()));
        } else {
            group.prior.record(entry);
        }
    }

    let mut groups: Vec<QueryHistoryShapeInsight> = groups_map
        .into_values()
        .filter(|g| g.current.call_count > 0)
        .map(|mut g| {
            g.contributing_executions
                .sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.id.cmp(&b.1.id)));
            let contributing_executions: Vec<QueryHistoryEntry> = g
                .contributing_executions
                .into_iter()
                .take(max_executions_per_group)
                .map(|(_, entry)| entry)
                .collect();

            let avg_duration_ms = g.current.avg_duration_ms();
            let prior_avg_duration_ms = g.prior.avg_duration_ms();
            let (delta_avg_ms, relative_delta_avg, is_regressed, regression_status) =
                evaluate_regression(
                    g.current.timed_sample_count,
                    avg_duration_ms,
                    g.prior.timed_sample_count,
                    prior_avg_duration_ms,
                );

            QueryHistoryShapeInsight {
                fingerprint: g.fingerprint,
                example_sql: g.example_sql,
                statement_kind: g.statement_kind,
                databases: g.databases.into_iter().collect(),
                has_unrecorded_database: g.has_unrecorded_database,
                last_executed_at: g.last_executed_at,
                call_count: g.current.call_count,
                timed_sample_count: g.current.timed_sample_count,
                missing_duration_count: g.current.missing_duration_count,
                total_duration_ms: g.current.total_duration_ms,
                avg_duration_ms,
                max_duration_ms: g.current.max_duration_ms,
                failure_count: g.current.failure_count,
                failure_rate: g.current.failure_rate(),
                prior_call_count: g.prior.call_count,
                prior_timed_sample_count: g.prior.timed_sample_count,
                prior_missing_duration_count: g.prior.missing_duration_count,
                prior_total_duration_ms: g.prior.total_duration_ms,
                prior_avg_duration_ms,
                prior_failure_count: g.prior.failure_count,
                prior_failure_rate: g.prior.failure_rate(),
                delta_avg_ms,
                relative_delta_avg,
                is_regressed,
                regression_status,
                contributing_executions,
            }
        })
        .collect();

    // Default ordering: regressed shapes first, then by highest total duration, then by call count
    groups.sort_by(|a, b| {
        b.is_regressed
            .cmp(&a.is_regressed)
            .then_with(|| {
                b.total_duration_ms
                    .partial_cmp(&a.total_duration_ms)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .then_with(|| b.call_count.cmp(&a.call_count))
            .then_with(|| a.fingerprint.cmp(&b.fingerprint))
    });
    groups.truncate(max_groups);

    Ok(QueryHistoryInsightsResponse {
        groups,
        coverage: QueryHistoryInsightsCoverage {
            current_window_start: current_start.to_rfc3339(),
            current_window_end: now_dt.to_rfc3339(),
            prior_window_start: prior_start.to_rfc3339(),
            prior_window_end: current_start.to_rfc3339(),
            total_stored_executions,
            max_stored_executions,
            retention_cap_reached,
            oldest_recorded_at,
            prior_window_fully_covered,
            current_window_executions,
            current_window_missing_duration_count,
            prior_window_executions,
            prior_window_missing_duration_count,
        },
        policy: QueryHistoryInsightsPolicy::default(),
    })
}
