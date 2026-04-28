/// Check if a query is a SELECT statement
pub fn is_select_query(query: &str) -> bool {
    query.trim_start().to_uppercase().starts_with("SELECT")
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

/// Simple SQL tokenizer that respects:
/// - Single-quoted strings ('...')
/// - Double-quoted identifiers ("...")
/// - Backtick-quoted identifiers (`...`)
/// - Parenthesized groups (treated as single tokens)
/// - Whitespace as delimiter
///
/// This prevents keywords like LIMIT or OFFSET from being matched
/// inside string literals, quoted identifiers, or table names such as
/// `tapp_appointment_message_event_limit`.
fn tokenize_sql(sql: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let chars: Vec<char> = sql.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        if chars[i].is_whitespace() {
            i += 1;
            continue;
        }

        if chars[i] == '\'' {
            let mut token = String::new();
            token.push(chars[i]);
            i += 1;
            while i < len {
                token.push(chars[i]);
                if chars[i] == '\'' {
                    if i + 1 < len && chars[i + 1] == '\'' {
                        i += 1;
                        token.push(chars[i]);
                    } else {
                        i += 1;
                        break;
                    }
                }
                i += 1;
            }
            tokens.push(token);
            continue;
        }

        if chars[i] == '"' {
            let mut token = String::new();
            token.push(chars[i]);
            i += 1;
            while i < len {
                token.push(chars[i]);
                if chars[i] == '"' {
                    if i + 1 < len && chars[i + 1] == '"' {
                        i += 1;
                        token.push(chars[i]);
                    } else {
                        i += 1;
                        break;
                    }
                }
                i += 1;
            }
            tokens.push(token);
            continue;
        }

        if chars[i] == '`' {
            let mut token = String::new();
            token.push(chars[i]);
            i += 1;
            while i < len {
                token.push(chars[i]);
                if chars[i] == '`' {
                    if i + 1 < len && chars[i + 1] == '`' {
                        i += 1;
                        token.push(chars[i]);
                    } else {
                        i += 1;
                        break;
                    }
                }
                i += 1;
            }
            tokens.push(token);
            continue;
        }

        if chars[i] == '(' {
            let mut token = String::new();
            let mut depth = 0;
            while i < len {
                token.push(chars[i]);
                if chars[i] == '(' {
                    depth += 1;
                } else if chars[i] == ')' {
                    depth -= 1;
                    if depth == 0 {
                        i += 1;
                        break;
                    }
                } else if chars[i] == '\'' {
                    i += 1;
                    while i < len {
                        token.push(chars[i]);
                        if chars[i] == '\'' {
                            if i + 1 < len && chars[i + 1] == '\'' {
                                i += 1;
                                token.push(chars[i]);
                            } else {
                                break;
                            }
                        }
                        i += 1;
                    }
                }
                i += 1;
            }
            tokens.push(token);
            continue;
        }

        let mut token = String::new();
        while i < len
            && !chars[i].is_whitespace()
            && chars[i] != '('
            && chars[i] != '\''
            && chars[i] != '"'
            && chars[i] != '`'
        {
            token.push(chars[i]);
            i += 1;
        }
        if !token.is_empty() {
            tokens.push(token);
        }
    }

    tokens
}

/// Remove trailing LIMIT and OFFSET clauses from a SQL query.
///
/// Uses a token-aware scan so that `LIMIT` / `OFFSET` keywords inside
/// string literals, quoted identifiers, parenthesized subqueries, or as
/// part of table names (e.g. `tapp_…_limit`) are never misidentified.
pub fn strip_limit_offset(query: &str) -> String {
    let tokens = tokenize_sql(query.trim());
    let mut end = tokens.len();

    // Scan backwards for OFFSET <n>
    if end >= 2 && tokens[end - 2].to_uppercase() == "OFFSET" {
        if tokens[end - 1].parse::<u64>().is_ok() {
            end -= 2;
        }
    }

    // Scan backwards for LIMIT <n>
    if end >= 2 && tokens[end - 2].to_uppercase() == "LIMIT" {
        if tokens[end - 1].parse::<u64>().is_ok() {
            end -= 2;
        }
    }

    tokens[..end].join(" ")
}

/// Extract the numeric value from a trailing LIMIT clause, if present.
///
/// Uses a token-aware scan so that `LIMIT` as a substring of a table name
/// (e.g. `tapp_appointment_message_event_limit`) is never misidentified.
pub fn extract_user_limit(query: &str) -> Option<u32> {
    let tokens = tokenize_sql(query.trim());
    let len = tokens.len();

    // Walk backwards past optional OFFSET <n>
    let mut end = len;
    if end >= 2 && tokens[end - 2].to_uppercase() == "OFFSET" {
        if tokens[end - 1].parse::<u64>().is_ok() {
            end -= 2;
        }
    }

    // Check for LIMIT <n>
    if end >= 2 && tokens[end - 2].to_uppercase() == "LIMIT" {
        return tokens[end - 1].parse().ok();
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
