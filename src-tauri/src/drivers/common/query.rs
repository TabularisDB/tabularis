use sqlparser::ast::{Expr, LimitClause, Offset, OffsetRows, Statement, Value};
use sqlparser::dialect::{Dialect, MySqlDialect, PostgreSqlDialect, SQLiteDialect};
use sqlparser::parser::Parser;

/// Check if a query is a SELECT statement.
///
/// Leading SQL comments are stripped before checking, matching
/// [`returns_result_set`] and [`is_explainable_query`] — drivers rely
/// on this to route commented-header SELECTs through the pagination
/// path.
pub fn is_select_query(query: &str) -> bool {
    strip_leading_sql_comments(query)
        .trim_start()
        .to_uppercase()
        .starts_with("SELECT")
}

/// Strip leading SQL comments (`-- …` line comments and `/* … */` block
/// comments) and whitespace so the first statement keyword is at position 0.
pub fn strip_leading_sql_comments(query: &str) -> &str {
    let mut s = query;
    loop {
        s = s.trim_start();
        if s.starts_with("--") {
            match s.find('\n') {
                Some(pos) => s = &s[pos + 1..],
                None => return "",
            }
        } else if s.starts_with("/*") {
            match s.find("*/") {
                Some(pos) => s = &s[pos + 2..],
                None => return "",
            }
        } else {
            break;
        }
    }
    s
}

/// Returns true if a statement's leading keyword produces a row stream.
/// Used by drivers to pick between the fetch-rows path and the
/// execute-and-collect-affected-rows path so INSERT/UPDATE/DELETE no
/// longer hardcode `affected_rows: 0`.
///
/// `CALL` is intentionally treated as result-set-bearing: a MySQL stored
/// procedure may or may not return one, and the fetch path degrades to
/// `(rows: [], affected_rows: 0)` for the no-result case without
/// erroring — losing accurate affected_rows for procs that mutate is the
/// lesser evil compared to misclassifying procedures that do return
/// rows.
pub fn returns_result_set(query: &str) -> bool {
    let head = strip_leading_sql_comments(query)
        .split(|c: char| !c.is_ascii_alphanumeric() && c != '_')
        .next()
        .unwrap_or("")
        .to_uppercase();
    matches!(
        head.as_str(),
        "SELECT"
            | "WITH"
            | "SHOW"
            | "EXPLAIN"
            | "DESCRIBE"
            | "DESC"
            | "VALUES"
            | "TABLE"
            | "PRAGMA"
            | "CALL"
    )
}

/// Check if a query type supports EXPLAIN.
///
/// MySQL/MariaDB support EXPLAIN for DML statements only:
/// SELECT, INSERT, UPDATE, DELETE, REPLACE, and WITH (CTE).
/// PostgreSQL 15+ and Oracle also support EXPLAIN MERGE.
/// DDL statements (CREATE, DROP, ALTER, TRUNCATE, etc.) are not supported.
/// Leading SQL comments are stripped before checking.
///
/// Kept in sync with the TypeScript classifier in
/// `src/utils/sqlSplitter/classify.ts` (EXPLAINABLE_KEYWORDS) so the
/// editor's Explain UI cannot offer a statement the backend will refuse.
pub fn is_explainable_query(query: &str) -> bool {
    let upper = strip_leading_sql_comments(query).to_uppercase();
    upper.starts_with("SELECT")
        || upper.starts_with("INSERT")
        || upper.starts_with("UPDATE")
        || upper.starts_with("DELETE")
        || upper.starts_with("REPLACE")
        || upper.starts_with("WITH")
        || upper.starts_with("TABLE")
        || upper.starts_with("MERGE")
}

/// Calculate offset for pagination
pub fn calculate_offset(page: u32, page_size: u32) -> u32 {
    (page - 1) * page_size
}

/// Read a quoted token (`'...'`, `"..."`, or `` `...` ``) starting at
/// `chars[*i]`, which must be the opening quote. The doubled-quote
/// escape (`''`, `""`, ` `` `) is consumed as a single literal quote.
/// On return `*i` points past the closing quote (or past end-of-input
/// for an unterminated literal — kept as-is for parity with the rest
/// of the tokenizer's lenient behaviour).
fn read_quoted(chars: &[(usize, char)], i: &mut usize, quote: char) -> String {
    let len = chars.len();
    let mut token = String::new();
    token.push(quote);
    *i += 1;
    while *i < len {
        let ch = chars[*i].1;
        token.push(ch);
        if ch == quote {
            if *i + 1 < len && chars[*i + 1].1 == quote {
                *i += 1;
                token.push(chars[*i].1);
            } else {
                *i += 1;
                break;
            }
        }
        *i += 1;
    }
    token
}

/// Simple SQL tokenizer that respects:
/// - Single-quoted strings ('...')
/// - Double-quoted identifiers ("...")
/// - Backtick-quoted identifiers (`...`)
/// - Parenthesized groups (treated as single tokens)
/// - Whitespace as delimiter
///
/// This prevents keywords like LIMIT or OFFSET from being matched
/// inside string literals, quoted identifiers, or table names such as
/// `tapp_appointment_message_event_limit`. Each token is returned with
/// its starting byte offset so callers can slice the original input
/// instead of rebuilding it from tokens.
fn tokenize_sql_with_pos(sql: &str) -> Vec<(String, usize)> {
    let mut tokens: Vec<(String, usize)> = Vec::new();
    let chars: Vec<(usize, char)> = sql.char_indices().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        let (start_byte, c) = chars[i];

        if c.is_whitespace() {
            i += 1;
            continue;
        }

        if c == '\'' || c == '"' || c == '`' {
            let token = read_quoted(&chars, &mut i, c);
            tokens.push((token, start_byte));
            continue;
        }

        if c == '(' {
            let mut token = String::new();
            let mut depth = 0;
            while i < len {
                let ch = chars[i].1;
                token.push(ch);
                if ch == '(' {
                    depth += 1;
                } else if ch == ')' {
                    depth -= 1;
                    if depth == 0 {
                        i += 1;
                        break;
                    }
                } else if ch == '\'' {
                    i += 1;
                    while i < len {
                        let inner = chars[i].1;
                        token.push(inner);
                        if inner == '\'' {
                            if i + 1 < len && chars[i + 1].1 == '\'' {
                                i += 1;
                                token.push(chars[i].1);
                            } else {
                                break;
                            }
                        }
                        i += 1;
                    }
                }
                i += 1;
            }
            tokens.push((token, start_byte));
            continue;
        }

        let mut token = String::new();
        while i < len {
            let ch = chars[i].1;
            if ch.is_whitespace() || ch == '(' || ch == '\'' || ch == '"' || ch == '`' {
                break;
            }
            token.push(ch);
            i += 1;
        }
        if !token.is_empty() {
            tokens.push((token, start_byte));
        }
    }

    tokens
}

/// Remove trailing LIMIT and OFFSET clauses from a SQL query.
///
/// Returns a substring of the original input so leading comments and
/// internal whitespace are preserved verbatim. Rebuilding via
/// `tokens.join(" ")` would collapse newlines, fatal for queries that
/// begin with `--` headers — the appended pagination clause would land
/// on the same line as the `--` and be parsed as part of the comment.
pub fn strip_limit_offset(query: &str) -> String {
    let trimmed = query.trim_end();
    let tokens = tokenize_sql_with_pos(trimmed);
    let mut end = tokens.len();

    if end >= 2
        && tokens[end - 2].0.to_uppercase() == "OFFSET"
        && tokens[end - 1].0.parse::<u64>().is_ok()
    {
        end -= 2;
    }

    if end >= 2
        && tokens[end - 2].0.to_uppercase() == "LIMIT"
        && tokens[end - 1].0.parse::<u64>().is_ok()
    {
        end -= 2;
    }

    if end == tokens.len() {
        return trimmed.to_string();
    }

    let cut = tokens[end].1;
    trimmed[..cut].trim_end().to_string()
}

/// Extract the numeric value from a trailing LIMIT clause, if present.
///
/// Uses a token-aware scan so that `LIMIT` as a substring of a table name
/// (e.g. `tapp_appointment_message_event_limit`) is never misidentified.
pub fn extract_user_limit(query: &str) -> Option<u32> {
    let tokens = tokenize_sql_with_pos(query.trim());
    let len = tokens.len();

    let mut end = len;
    if end >= 2
        && tokens[end - 2].0.to_uppercase() == "OFFSET"
        && tokens[end - 1].0.parse::<u64>().is_ok()
    {
        end -= 2;
    }

    if end >= 2 && tokens[end - 2].0.to_uppercase() == "LIMIT" {
        return tokens[end - 1].0.parse().ok();
    }

    None
}

/// Extract the numeric value from a trailing OFFSET clause, if present.
///
/// Mirrors [`extract_user_limit`] and only recognises the `… OFFSET <n>`
/// shape that [`strip_limit_offset`] removes (the common `LIMIT x OFFSET y`
/// ordering). Uses a token-aware scan so `OFFSET` inside an identifier or
/// string literal is never misidentified.
pub fn extract_user_offset(query: &str) -> Option<u32> {
    let tokens = tokenize_sql_with_pos(query.trim());
    let end = tokens.len();

    if end >= 2 && tokens[end - 2].0.to_uppercase() == "OFFSET" {
        return tokens[end - 1].0.parse().ok();
    }

    None
}

/// SQL dialect used to parse a query before rewriting its pagination.
///
/// Driver-facing wrapper so the `sqlparser` dialect types stay internal to
/// this module — each driver passes the variant matching its engine.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PaginationDialect {
    MySql,
    Postgres,
    Sqlite,
}

impl PaginationDialect {
    fn parser_dialect(self) -> Box<dyn Dialect> {
        match self {
            PaginationDialect::MySql => Box::new(MySqlDialect {}),
            PaginationDialect::Postgres => Box::new(PostgreSqlDialect {}),
            PaginationDialect::Sqlite => Box::new(SQLiteDialect {}),
        }
    }
}

/// LIMIT/OFFSET read from a query's parsed AST.
struct ParsedPagination {
    /// User-supplied LIMIT, if it is a plain numeric literal.
    user_limit: Option<u32>,
    /// User-supplied OFFSET (0 when absent or non-numeric).
    user_offset: u32,
    /// Whether the query carries a top-level LIMIT/OFFSET clause to strip.
    has_limit_clause: bool,
}

/// Resolve a numeric-literal expression to a `u32`.
///
/// Non-literal expressions (placeholders, arithmetic, bind parameters) yield
/// `None` so they are treated as "no value" rather than being mis-read.
fn eval_u32(expr: &Expr) -> Option<u32> {
    match expr {
        Expr::Value(value) => match &value.value {
            Value::Number(n, _) => n.parse().ok(),
            _ => None,
        },
        _ => None,
    }
}

/// Parse `query` with `dialect` and read the top-level LIMIT/OFFSET from the
/// AST, normalising MySQL's `LIMIT <offset>, <count>` form to the same shape.
///
/// Returns `None` — so the caller falls back to the token heuristics — when
/// the input is not a single query the parser understands, or when it relies
/// on a `FETCH FIRST … ROWS` clause this rewriter does not handle.
fn parse_pagination(query: &str, dialect: PaginationDialect) -> Option<ParsedPagination> {
    let statements = Parser::parse_sql(dialect.parser_dialect().as_ref(), query).ok()?;
    if statements.len() != 1 {
        return None;
    }
    let Statement::Query(q) = &statements[0] else {
        return None;
    };

    // FETCH FIRST … ROWS ONLY is out of scope; defer to the fallback path so
    // its behaviour is unchanged rather than producing a mixed clause.
    if q.fetch.is_some() {
        return None;
    }

    match &q.limit_clause {
        None => Some(ParsedPagination {
            user_limit: None,
            user_offset: 0,
            has_limit_clause: false,
        }),
        Some(LimitClause::LimitOffset { limit, offset, .. }) => Some(ParsedPagination {
            user_limit: limit.as_ref().and_then(eval_u32),
            user_offset: offset
                .as_ref()
                .and_then(|o| eval_u32(&o.value))
                .unwrap_or(0),
            has_limit_clause: true,
        }),
        Some(LimitClause::OffsetCommaLimit { offset, limit }) => Some(ParsedPagination {
            user_limit: eval_u32(limit),
            user_offset: eval_u32(offset).unwrap_or(0),
            has_limit_clause: true,
        }),
    }
}

/// True for the keyword/value tokens that make up a trailing LIMIT/OFFSET
/// clause (standard, MySQL comma, and FETCH spellings), so a LIMIT/OFFSET that
/// appears mid-query is never mistaken for the trailing pagination clause.
///
/// The numeric arm accepts digits interleaved with commas so MySQL's
/// `LIMIT <offset>,<count>` is recognised even when written without spaces
/// (`LIMIT 0,1`): the tokenizer splits only on whitespace, so the count and
/// offset arrive glued together as a single `0,1` token.
fn is_pagination_tail_token(tok: &str) -> bool {
    let upper = tok.to_uppercase();
    matches!(
        upper.as_str(),
        "LIMIT" | "OFFSET" | "BY" | "ROW" | "ROWS" | "ONLY" | "NEXT" | "FIRST" | ","
    ) || (!tok.is_empty() && tok.chars().all(|c| c.is_ascii_digit() || c == ','))
}

/// Cut the query immediately before its trailing top-level LIMIT/OFFSET clause.
///
/// Reuses [`tokenize_sql_with_pos`], which collapses parenthesised groups into
/// a single token, so a LIMIT/OFFSET inside a subquery is never seen and only
/// the outer clause is removed. Unlike [`strip_limit_offset`], it cuts at the
/// keyword regardless of the value shape, so MySQL's `LIMIT <offset>, <count>`
/// is handled. Falls back to [`strip_limit_offset`] if no trailing clause is
/// found (kept total; the parser having reported a clause makes this rare).
fn strip_at_limit_keyword(query: &str) -> String {
    let trimmed = query.trim_end();
    let tokens = tokenize_sql_with_pos(trimmed);
    for (idx, (tok, pos)) in tokens.iter().enumerate() {
        let upper = tok.to_uppercase();
        if (upper == "LIMIT" || upper == "OFFSET")
            && tokens[idx + 1..]
                .iter()
                .all(|(t, _)| is_pagination_tail_token(t))
        {
            return trimmed[..*pos].trim_end().to_string();
        }
    }
    strip_limit_offset(query)
}

/// Build a numeric-literal expression for the rendered pagination clause.
fn number_expr(n: u32) -> Expr {
    Expr::value(Value::Number(n.to_string(), false))
}

/// Build a paginated query by stripping any user-supplied LIMIT/OFFSET and
/// appending pagination clauses directly. ORDER BY is left in place so that
/// table-qualified column references (e.g. `o.created_at`) remain valid —
/// wrapping the original query in a subquery would move those references out
/// of scope and cause "unknown column" errors.
///
/// The user's LIMIT/OFFSET are read from the parsed AST (using `dialect`), so
/// dialect-specific forms such as MySQL's `LIMIT <offset>, <count>` and
/// `OFFSET` before `LIMIT` are understood. When the parser cannot handle the
/// input, it falls back to a token-aware heuristic scan. The appended
/// pagination clause is rendered from a [`LimitClause`] AST node and
/// concatenated to the verbatim sliced base, so leading comments, inline
/// hints, and the body's formatting are preserved.
///
/// When the user wrote an explicit LIMIT, it is honoured as a cap on the total
/// number of rows returned across all pages. A user-supplied OFFSET is honoured
/// too: it is added to the per-page offset so that pagination walks the result
/// set the user actually asked for (the rows after their OFFSET). Discarding it
/// silently collapsed `LIMIT 1 OFFSET 1` to `LIMIT 1 OFFSET 0` on page 1.
pub fn build_paginated_query(
    query: &str,
    page_size: u32,
    page: u32,
    dialect: PaginationDialect,
) -> String {
    let page_offset = calculate_offset(page, page_size);

    let (user_limit, user_offset, base) = match parse_pagination(query, dialect) {
        Some(parsed) => {
            let base = if parsed.has_limit_clause {
                strip_at_limit_keyword(query)
            } else {
                query.trim_end().to_string()
            };
            (parsed.user_limit, parsed.user_offset, base)
        }
        // Parser could not handle the input — fall back to the token heuristics.
        None => (
            extract_user_limit(query),
            extract_user_offset(query).unwrap_or(0),
            strip_limit_offset(query),
        ),
    };

    let fetch_count = match user_limit {
        Some(ul) => {
            let remaining = ul.saturating_sub(page_offset);
            // +1 for has_more detection, but capped by user's LIMIT
            remaining.min(page_size + 1)
        }
        None => page_size + 1,
    };

    let offset = user_offset.saturating_add(page_offset);

    // Render the pagination clause from an AST node so the output is built by
    // the parser rather than hand-formatted.
    let clause = LimitClause::LimitOffset {
        limit: Some(number_expr(fetch_count)),
        offset: Some(Offset {
            value: number_expr(offset),
            rows: OffsetRows::None,
        }),
        limit_by: Vec::new(),
    };

    // `LimitClause`'s Display renders a leading space (it is meant to follow a
    // preceding clause), so concatenate without inserting another one.
    format!("{}{}", base, clause)
}

/// Sentinel that separates a human error message from the actual SQL that
/// produced it inside a single error string. The leading code point is from
/// the Unicode private-use area, so it never appears in real SQL text or DB
/// driver error messages and survives JSON/IPC transport unescaped — letting
/// the frontend split on this marker without colliding with the `\n\n`
/// brief/detail convention. Must stay in sync with the parser in
/// `src/components/ui/ErrorDisplay.tsx`.
pub const EXECUTED_QUERY_MARKER: &str = "\u{E000}__TABULARIS_EXECUTED_QUERY__";

/// Appends the executed SQL to a DB error message so the UI can show the user
/// the exact statement that failed. This matters when pagination rewrote the
/// query (appending `LIMIT`/`OFFSET`): the database complains about clauses the
/// user never typed, and without the rewritten text the error is baffling.
///
/// When `executed` matches `original` (ignoring surrounding whitespace) the
/// error is returned unchanged — echoing back the query the user can already
/// see would only add noise.
pub fn annotate_error_with_query(err: String, executed: &str, original: &str) -> String {
    if executed.trim() == original.trim() {
        err
    } else {
        format!("{err}{EXECUTED_QUERY_MARKER}{executed}")
    }
}
