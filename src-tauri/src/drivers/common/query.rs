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
/// DDL statements (CREATE, DROP, ALTER, TRUNCATE, etc.) are not supported.
/// Leading SQL comments are stripped before checking.
pub fn is_explainable_query(query: &str) -> bool {
    let upper = strip_leading_sql_comments(query).to_uppercase();
    upper.starts_with("SELECT")
        || upper.starts_with("INSERT")
        || upper.starts_with("UPDATE")
        || upper.starts_with("DELETE")
        || upper.starts_with("REPLACE")
        || upper.starts_with("WITH")
        || upper.starts_with("TABLE")
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

/// Build a paginated query by stripping any user-supplied LIMIT/OFFSET and
/// appending pagination clauses directly. ORDER BY is left in place so that
/// table-qualified column references (e.g. `o.created_at`) remain valid —
/// wrapping the original query in a subquery would move those references out
/// of scope and cause "unknown column" errors.
///
/// When the user wrote an explicit LIMIT, it is honoured as a cap on the total
/// number of rows returned across all pages.
pub fn build_paginated_query(query: &str, page_size: u32, page: u32) -> String {
    let offset = calculate_offset(page, page_size);
    let user_limit = extract_user_limit(query);
    let base = strip_limit_offset(query);

    let fetch_count = match user_limit {
        Some(ul) => {
            let remaining = ul.saturating_sub(offset);
            // +1 for has_more detection, but capped by user's LIMIT
            remaining.min(page_size + 1)
        }
        None => page_size + 1,
    };

    format!("{} LIMIT {} OFFSET {}", base, fetch_count, offset)
}
