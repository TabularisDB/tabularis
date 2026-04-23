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

/// Which pagination SQL syntax a driver wants to emit.
///
/// Added in support of SQL Server, which does not speak `LIMIT` / `OFFSET`
/// and uses `OFFSET n ROWS FETCH NEXT m ROWS ONLY` instead (since SQL Server
/// 2012). The legacy `build_paginated_query` keeps its exact shape and is
/// implemented in terms of `LimitOffset`, so no existing driver is affected.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PaginationDialect {
    /// `LIMIT n OFFSET m` (MySQL, PostgreSQL, SQLite).
    LimitOffset,
    /// `ORDER BY ... OFFSET m ROWS FETCH NEXT n ROWS ONLY` (SQL Server 2012+).
    OffsetFetch,
}

/// Build a paginated query by stripping any user-supplied LIMIT/OFFSET and
/// appending pagination clauses directly. ORDER BY is left in place so that
/// table-qualified column references (e.g. `o.created_at`) remain valid —
/// wrapping the original query in a subquery would move those references out
/// of scope and cause "unknown column" errors.
///
/// When the user wrote an explicit LIMIT, it is honoured as a cap on the total
/// number of rows returned across all pages.
///
/// This is the legacy entry point (MySQL / PostgreSQL / SQLite). It preserves
/// its exact historical behaviour by delegating to
/// [`build_paginated_query_dialect`] with [`PaginationDialect::LimitOffset`].
pub fn build_paginated_query(query: &str, page_size: u32, page: u32) -> String {
    build_paginated_query_dialect(query, page_size, page, PaginationDialect::LimitOffset)
}

/// Dialect-aware paginated query builder. See [`PaginationDialect`].
///
/// The function always fetches `page_size + 1` rows (or the clamped remainder
/// when a user LIMIT is present) so the caller can detect `has_more` without
/// issuing a `SELECT COUNT(*)`.
pub fn build_paginated_query_dialect(
    query: &str,
    page_size: u32,
    page: u32,
    dialect: PaginationDialect,
) -> String {
    let offset = calculate_offset(page, page_size);
    let user_limit = extract_user_limit(query);
    let base = strip_limit_offset(query);

    let fetch_count = match user_limit {
        Some(ul) => {
            let remaining = ul.saturating_sub(offset);
            remaining.min(page_size + 1)
        }
        None => page_size + 1,
    };

    match dialect {
        PaginationDialect::LimitOffset => {
            format!("{} LIMIT {} OFFSET {}", base, fetch_count, offset)
        }
        PaginationDialect::OffsetFetch => {
            // SQL Server requires ORDER BY before OFFSET/FETCH. Synthesize a
            // no-op ORDER BY when the user hasn't provided one at top level.
            let trimmed = base.trim().trim_end_matches(';').trim_end();
            let ordered = if contains_top_level_order_by(trimmed) {
                trimmed.to_string()
            } else {
                format!("{} ORDER BY (SELECT NULL)", trimmed)
            };
            format!(
                "{} OFFSET {} ROWS FETCH NEXT {} ROWS ONLY",
                ordered, offset, fetch_count
            )
        }
    }
}

/// Heuristic check: does the query already end with a top-level `ORDER BY`?
///
/// Conservative matcher used by the `OffsetFetch` dialect to decide whether
/// to synthesise `ORDER BY (SELECT NULL)`. Walks the string with a
/// paren-depth counter and matches `ORDER BY` only at depth zero, bounded
/// by non-identifier characters. This handles common cases without doing
/// full SQL parsing; string literals are *not* stripped (documented
/// false-positive — safe because the worst case is suppressing the
/// synthesised clause, never breaking the query).
pub(super) fn contains_top_level_order_by(query: &str) -> bool {
    let upper = query.to_ascii_uppercase();
    let bytes = upper.as_bytes();
    let n = bytes.len();
    let mut depth: i32 = 0;
    let mut i = 0;
    let mut found = false;
    while i < n {
        let c = bytes[i] as char;
        match c {
            '(' => depth += 1,
            ')' => {
                if depth > 0 {
                    depth -= 1;
                }
            }
            _ => {
                if depth == 0 && matches_token_at(&upper, i, "ORDER BY") {
                    found = true;
                    i += "ORDER BY".len();
                    continue;
                }
            }
        }
        i += 1;
    }
    found
}

/// Token-boundary-aware `haystack.starts_with(needle, at: pos)`. Ensures
/// `needle` is preceded and followed by non-identifier characters (or
/// start/end of string), so `"ORDER BY"` doesn't match inside `"REORDER_BY"`
/// or `"ORDERBY"`.
fn matches_token_at(haystack: &str, pos: usize, needle: &str) -> bool {
    if !haystack[pos..].starts_with(needle) {
        return false;
    }
    let is_ident = |c: char| c.is_alphanumeric() || c == '_';
    let left_ok = pos == 0
        || !haystack[..pos]
            .chars()
            .next_back()
            .map(is_ident)
            .unwrap_or(false);
    let right_ok = haystack[pos + needle.len()..]
        .chars()
        .next()
        .map(|c| !is_ident(c))
        .unwrap_or(true);
    left_ok && right_ok
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- Dialect dispatch ------------------------------------------------

    #[test]
    fn legacy_build_paginated_query_matches_limit_offset_dialect() {
        let a = build_paginated_query("SELECT * FROM t", 10, 1);
        let b = build_paginated_query_dialect(
            "SELECT * FROM t",
            10,
            1,
            PaginationDialect::LimitOffset,
        );
        assert_eq!(a, b);
    }

    #[test]
    fn limit_offset_dialect_emits_classic_syntax() {
        let out = build_paginated_query_dialect(
            "SELECT * FROM t",
            25,
            2,
            PaginationDialect::LimitOffset,
        );
        assert!(out.contains("LIMIT 26 OFFSET 25"), "got {}", out);
        assert!(!out.contains("FETCH NEXT"));
    }

    // --- OffsetFetch dialect ---------------------------------------------

    #[test]
    fn offset_fetch_appends_order_by_select_null_when_missing() {
        let out =
            build_paginated_query_dialect("SELECT * FROM t", 10, 1, PaginationDialect::OffsetFetch);
        assert!(out.contains("ORDER BY (SELECT NULL)"), "got {}", out);
        assert!(out.contains("OFFSET 0 ROWS"), "got {}", out);
        assert!(out.contains("FETCH NEXT 11 ROWS ONLY"), "got {}", out);
    }

    #[test]
    fn offset_fetch_computes_offset_for_second_page() {
        let out =
            build_paginated_query_dialect("SELECT * FROM t", 50, 2, PaginationDialect::OffsetFetch);
        assert!(out.contains("OFFSET 50 ROWS"), "got {}", out);
        assert!(out.contains("FETCH NEXT 51 ROWS ONLY"), "got {}", out);
    }

    #[test]
    fn offset_fetch_preserves_user_order_by() {
        let out = build_paginated_query_dialect(
            "SELECT * FROM t ORDER BY name",
            10,
            1,
            PaginationDialect::OffsetFetch,
        );
        // We must not inject a second ORDER BY.
        let count = out.matches("ORDER BY").count();
        assert_eq!(count, 1, "got {}", out);
        assert!(out.contains("ORDER BY name"), "got {}", out);
    }

    #[test]
    fn offset_fetch_ignores_order_by_inside_subquery() {
        let q = "SELECT * FROM (SELECT * FROM t ORDER BY x) sub";
        let out = build_paginated_query_dialect(q, 10, 1, PaginationDialect::OffsetFetch);
        assert!(out.contains("ORDER BY (SELECT NULL)"), "got {}", out);
    }

    #[test]
    fn offset_fetch_respects_user_limit_clamp() {
        let q = "SELECT * FROM t LIMIT 20";
        let out = build_paginated_query_dialect(q, 10, 2, PaginationDialect::OffsetFetch);
        assert!(out.contains("OFFSET 10 ROWS"), "got {}", out);
        // remaining=10, page_size+1=11 -> fetch=min(10,11)=10
        assert!(out.contains("FETCH NEXT 10 ROWS ONLY"), "got {}", out);
    }

    #[test]
    fn offset_fetch_respects_user_limit_when_offset_exceeds_it() {
        let q = "SELECT * FROM t LIMIT 5";
        let out = build_paginated_query_dialect(q, 10, 2, PaginationDialect::OffsetFetch);
        assert!(out.contains("OFFSET 10 ROWS"));
        assert!(out.contains("FETCH NEXT 0 ROWS ONLY"));
    }

    #[test]
    fn offset_fetch_strips_trailing_semicolon_and_whitespace() {
        let out = build_paginated_query_dialect(
            "SELECT * FROM t;   ",
            10,
            1,
            PaginationDialect::OffsetFetch,
        );
        assert!(!out.contains(";  "), "no trailing semicolon chain: {}", out);
        assert!(out.contains("ORDER BY (SELECT NULL)"), "got {}", out);
        assert!(out.contains("OFFSET 0 ROWS"), "got {}", out);
    }

    // --- contains_top_level_order_by --------------------------------------

    #[test]
    fn detects_plain_order_by() {
        assert!(contains_top_level_order_by("SELECT * FROM t ORDER BY a"));
        assert!(contains_top_level_order_by(
            "SELECT a,b FROM t WHERE x=1 ORDER BY a, b"
        ));
    }

    #[test]
    fn detects_case_insensitive_order_by() {
        assert!(contains_top_level_order_by("select * from t order by a"));
        assert!(contains_top_level_order_by("SELECT * FROM t Order By a"));
    }

    #[test]
    fn ignores_order_by_inside_subquery() {
        assert!(!contains_top_level_order_by(
            "SELECT * FROM (SELECT * FROM t ORDER BY x) sub"
        ));
        assert!(!contains_top_level_order_by(
            "SELECT * FROM (SELECT * FROM t ORDER BY x) sub WHERE sub.n=1"
        ));
    }

    #[test]
    fn rejects_word_boundary_false_positives() {
        assert!(!contains_top_level_order_by("SELECT ORDERBY FROM t"));
        assert!(!contains_top_level_order_by("SELECT reorder_by FROM t"));
    }

    #[test]
    fn returns_false_when_absent() {
        assert!(!contains_top_level_order_by("SELECT * FROM t"));
        assert!(!contains_top_level_order_by(""));
    }

    #[test]
    fn documents_known_false_positives_in_string_literals() {
        // Matcher doesn't strip literals — accepted trade-off. Worst case:
        // we *skip* the synthesised no-op ORDER BY. The server still runs.
        assert!(contains_top_level_order_by(
            "SELECT * FROM t WHERE note = 'ORDER BY x'"
        ));
    }

    #[test]
    fn handles_unbalanced_parens_without_panic() {
        // No assertion on result; we just require no crash.
        let _ = contains_top_level_order_by("SELECT * FROM ((( t");
        let _ = contains_top_level_order_by("SELECT * FROM ))) t ORDER BY x");
        let _ = contains_top_level_order_by(")))");
    }

    // --- matches_token_at ------------------------------------------------

    #[test]
    fn matches_token_at_boundaries() {
        assert!(matches_token_at("ORDER BY x", 0, "ORDER BY"));
        assert!(matches_token_at("SELECT a ORDER BY b", 9, "ORDER BY"));
        assert!(!matches_token_at("REORDER_BYX", 2, "ORDER BY"));
        assert!(!matches_token_at("ORDERBYX", 0, "ORDER BY"));
    }
}
