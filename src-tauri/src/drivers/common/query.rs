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

/// Remove trailing LIMIT and OFFSET clauses from a SQL query.
///
/// Uses `rfind` to locate the last `LIMIT` keyword and strips everything from
/// there onwards (which includes any subsequent OFFSET). Falls back to looking
/// for a standalone `OFFSET` when no LIMIT is present.
pub fn strip_limit_offset(query: &str) -> &str {
    let upper = query.to_uppercase();
    if let Some(pos) = upper.rfind("LIMIT") {
        query[..pos].trim()
    } else if let Some(pos) = upper.rfind("OFFSET") {
        query[..pos].trim()
    } else {
        query.trim()
    }
}

/// Extract the numeric value from a trailing LIMIT clause, if present.
pub fn extract_user_limit(query: &str) -> Option<u32> {
    let upper = query.to_uppercase();
    let pos = upper.rfind("LIMIT")?;
    let after = query[pos + 5..].trim();
    let num_str: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
    num_str.parse().ok()
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
