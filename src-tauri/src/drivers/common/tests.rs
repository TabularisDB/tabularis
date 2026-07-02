use super::{
    build_paginated_query, decode_blob_wire_format, encode_blob, encode_blob_full, i64_to_json,
    is_explainable_query, is_select_query, parse_unsafe_bigint_string, strip_leading_sql_comments,
    strip_limit_offset, u64_to_json, DEFAULT_MAX_BLOB_SIZE, JS_MAX_SAFE_INTEGER, JS_MAX_SAFE_UINT,
    MAX_BLOB_PREVIEW_SIZE,
};

#[test]
fn test_decode_blob_wire_format_valid() {
    // Encode some known bytes, then verify decode round-trips correctly
    let original = b"hello blob";
    let encoded = encode_blob(original);
    let decoded = decode_blob_wire_format(&encoded, DEFAULT_MAX_BLOB_SIZE)
        .expect("should decode valid wire format");
    assert_eq!(decoded, original);
}

#[test]
fn test_decode_blob_wire_format_not_wire_format() {
    assert!(decode_blob_wire_format("plain string", DEFAULT_MAX_BLOB_SIZE).is_none());
    assert!(decode_blob_wire_format("BLOB_NOT_VALID", DEFAULT_MAX_BLOB_SIZE).is_none());
    assert!(decode_blob_wire_format("", DEFAULT_MAX_BLOB_SIZE).is_none());
    assert!(decode_blob_wire_format("__USE_DEFAULT__", DEFAULT_MAX_BLOB_SIZE).is_none());
}

#[test]
fn test_decode_blob_wire_format_truncated_preview() {
    // Even if the wire format contains only a truncated preview, the decoded
    // bytes should equal the preview portion (first MAX_BLOB_PREVIEW_SIZE bytes)
    let data: Vec<u8> = (0u8..=255u8).cycle().take(8192).collect();
    let wire = encode_blob(&data);
    let decoded = decode_blob_wire_format(&wire, DEFAULT_MAX_BLOB_SIZE)
        .expect("should decode truncated wire format");
    assert_eq!(decoded, &data[..MAX_BLOB_PREVIEW_SIZE]);
}

#[test]
fn test_decode_blob_wire_format_composite_mime() {
    // MIME types with plus signs (e.g. image/svg+xml) must be handled correctly
    let svg = b"<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>";
    let wire = encode_blob(svg);
    let decoded = decode_blob_wire_format(&wire, DEFAULT_MAX_BLOB_SIZE)
        .expect("should decode svg wire format");
    assert_eq!(decoded, svg);
}

#[test]
fn test_strip_leading_sql_comments_line() {
    assert_eq!(
        strip_leading_sql_comments("-- comment\nSELECT 1"),
        "SELECT 1"
    );
    assert_eq!(
        strip_leading_sql_comments("-- line1\n-- line2\nSELECT 1"),
        "SELECT 1"
    );
}

#[test]
fn test_strip_leading_sql_comments_block() {
    assert_eq!(
        strip_leading_sql_comments("/* block */ SELECT 1"),
        "SELECT 1"
    );
    assert_eq!(
        strip_leading_sql_comments("/* a */ /* b */ SELECT 1"),
        "SELECT 1"
    );
}

#[test]
fn test_strip_leading_sql_comments_mixed() {
    assert_eq!(
        strip_leading_sql_comments("-- line\n/* block */\nSELECT 1"),
        "SELECT 1"
    );
}

#[test]
fn test_strip_leading_sql_comments_no_comments() {
    assert_eq!(strip_leading_sql_comments("SELECT 1"), "SELECT 1");
    assert_eq!(strip_leading_sql_comments("  SELECT 1"), "SELECT 1");
}

#[test]
fn test_strip_leading_sql_comments_unterminated() {
    assert_eq!(strip_leading_sql_comments("-- only comment"), "");
    assert_eq!(strip_leading_sql_comments("/* never closed"), "");
}

#[test]
fn test_is_explainable_query_dml() {
    assert!(is_explainable_query("SELECT * FROM users"));
    assert!(is_explainable_query("  select * from users"));
    assert!(is_explainable_query("INSERT INTO users VALUES (1)"));
    assert!(is_explainable_query("UPDATE users SET name = 'test'"));
    assert!(is_explainable_query("DELETE FROM users WHERE id = 1"));
    assert!(is_explainable_query("REPLACE INTO users VALUES (1, 'a')"));
    assert!(is_explainable_query(
        "WITH cte AS (SELECT 1) SELECT * FROM cte"
    ));
    assert!(is_explainable_query("TABLE users"));
    assert!(is_explainable_query(
        "MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN UPDATE SET v = s.v"
    ));
}

#[test]
fn test_is_explainable_query_ddl() {
    assert!(!is_explainable_query("CREATE INDEX idx ON t(col)"));
    assert!(!is_explainable_query("CREATE TABLE users (id INT)"));
    assert!(!is_explainable_query("DROP TABLE users"));
    assert!(!is_explainable_query(
        "ALTER TABLE users ADD COLUMN name TEXT"
    ));
    assert!(!is_explainable_query("TRUNCATE TABLE users"));
    assert!(!is_explainable_query("GRANT SELECT ON users TO 'user'"));
    assert!(!is_explainable_query("REVOKE SELECT ON users FROM 'user'"));
}

#[test]
fn test_is_explainable_query_whitespace() {
    assert!(is_explainable_query("\n\t  SELECT 1"));
    assert!(!is_explainable_query("\n\t  CREATE INDEX idx ON t(col)"));
}

#[test]
fn test_is_explainable_query_with_comments() {
    assert!(is_explainable_query(
        "-- BEFORE index: full scan\nSELECT * FROM audit_log"
    ));
    assert!(is_explainable_query(
        "/* explain this */ SELECT * FROM users"
    ));
    assert!(is_explainable_query(
        "-- comment\n-- another\nDELETE FROM users WHERE id = 1"
    ));
    assert!(!is_explainable_query(
        "-- setup\nCREATE INDEX idx ON t(col)"
    ));
}

#[test]
fn test_is_select_query() {
    assert!(is_select_query("SELECT * FROM users"));
    assert!(is_select_query("  select * from users"));
    assert!(is_select_query("\n\tSELECT id FROM posts"));
    assert!(!is_select_query("UPDATE users SET name = 'test'"));
    assert!(!is_select_query("DELETE FROM users"));
    assert!(!is_select_query("INSERT INTO users VALUES (1)"));
}

#[test]
fn test_is_select_query_with_leading_comments() {
    assert!(is_select_query("-- header\nSELECT * FROM users"));
    assert!(is_select_query("-- l1\n-- l2\n\nSELECT id FROM posts"));
    assert!(is_select_query("/* block comment */SELECT * FROM users"));
    assert!(is_select_query(
        "-- ============\n-- title\n-- ============\n\nSELECT 1"
    ));
    assert!(!is_select_query("-- header\nUPDATE users SET name = 't'"));
    assert!(!is_select_query("/* sel */ INSERT INTO t VALUES (1)"));
}

#[test]
fn test_calculate_offset() {
    assert_eq!(super::calculate_offset(1, 100), 0);
    assert_eq!(super::calculate_offset(2, 100), 100);
    assert_eq!(super::calculate_offset(3, 50), 100);
    assert_eq!(super::calculate_offset(10, 25), 225);
}

#[test]
fn test_strip_limit_offset_with_limit() {
    assert_eq!(
        strip_limit_offset("SELECT * FROM t ORDER BY id LIMIT 50"),
        "SELECT * FROM t ORDER BY id"
    );
}

#[test]
fn test_strip_limit_offset_with_limit_and_offset() {
    assert_eq!(
        strip_limit_offset("SELECT * FROM t ORDER BY id LIMIT 50 OFFSET 10"),
        "SELECT * FROM t ORDER BY id"
    );
}

#[test]
fn test_strip_limit_offset_no_limit() {
    assert_eq!(
        strip_limit_offset("SELECT * FROM t ORDER BY id"),
        "SELECT * FROM t ORDER BY id"
    );
}

#[test]
fn test_strip_limit_offset_only_offset() {
    assert_eq!(
        strip_limit_offset("SELECT * FROM t OFFSET 5"),
        "SELECT * FROM t"
    );
}

#[test]
fn test_strip_limit_offset_table_name_contains_limit() {
    assert_eq!(
        strip_limit_offset("SELECT * FROM tapp_appointment_message_event_limit ORDER BY id"),
        "SELECT * FROM tapp_appointment_message_event_limit ORDER BY id"
    );
}

#[test]
fn test_strip_limit_offset_table_name_contains_limit_with_real_limit() {
    assert_eq!(
        strip_limit_offset("SELECT * FROM tapp_appointment_message_event_limit ORDER BY id LIMIT 10"),
        "SELECT * FROM tapp_appointment_message_event_limit ORDER BY id"
    );
}

#[test]
fn test_strip_limit_offset_quoted_identifier() {
    assert_eq!(
        strip_limit_offset(r#"SELECT * FROM "order_limit_table" WHERE x > 1 LIMIT 5 OFFSET 10"#),
        r#"SELECT * FROM "order_limit_table" WHERE x > 1"#
    );
}

#[test]
fn test_strip_limit_offset_string_literal_with_limit() {
    assert_eq!(
        strip_limit_offset("SELECT * FROM t WHERE name LIKE '%limit%' LIMIT 10"),
        "SELECT * FROM t WHERE name LIKE '%limit%'"
    );
}

#[test]
fn test_extract_user_limit_present() {
    assert_eq!(
        super::extract_user_limit("SELECT * FROM t LIMIT 50"),
        Some(50)
    );
}

#[test]
fn test_extract_user_limit_with_offset() {
    assert_eq!(
        super::extract_user_limit("SELECT * FROM t LIMIT 100 OFFSET 20"),
        Some(100)
    );
}

#[test]
fn test_extract_user_limit_absent() {
    assert_eq!(
        super::extract_user_limit("SELECT * FROM t ORDER BY id"),
        None
    );
}

#[test]
fn test_extract_user_limit_table_name_contains_limit() {
    assert_eq!(
        super::extract_user_limit("SELECT * FROM tapp_appointment_message_event_limit"),
        None
    );
}

#[test]
fn test_extract_user_limit_table_name_contains_limit_with_real_limit() {
    assert_eq!(
        super::extract_user_limit("SELECT * FROM tapp_appointment_message_event_limit LIMIT 10"),
        Some(10)
    );
}

#[test]
fn test_build_paginated_query_no_user_limit() {
    let q = "SELECT o.id FROM orders o ORDER BY o.created_at DESC";
    let result = build_paginated_query(q, 100, 1);
    assert_eq!(
        result,
        "SELECT o.id FROM orders o ORDER BY o.created_at DESC LIMIT 101 OFFSET 0"
    );
}

#[test]
fn test_build_paginated_query_strips_trailing_semicolon() {
    let q = "SELECT DATABASE() AS current_db;";
    let result = build_paginated_query(q, 1, 1);
    assert_eq!(result, "SELECT DATABASE() AS current_db LIMIT 2 OFFSET 0");
}

#[test]
fn test_build_paginated_query_strips_trailing_semicolon_with_whitespace() {
    let q = "SELECT ROUTINE_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE() ORDER BY ROUTINE_NAME;   ";
    let result = build_paginated_query(q, 50, 1);
    assert_eq!(
        result,
        "SELECT ROUTINE_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE() ORDER BY ROUTINE_NAME LIMIT 51 OFFSET 0"
    );
}

#[test]
fn test_build_paginated_query_strips_semicolon_before_line_comment() {
    let q = "SELECT DATABASE() AS current_db; -- current schema";
    let result = build_paginated_query(q, 1, 1);
    assert_eq!(result, "SELECT DATABASE() AS current_db LIMIT 2 OFFSET 0");
}

#[test]
fn test_build_paginated_query_strips_semicolon_before_hash_comment() {
    let q = "SELECT DATABASE() AS current_db; # current schema";
    let result = build_paginated_query(q, 1, 1);
    assert_eq!(result, "SELECT DATABASE() AS current_db LIMIT 2 OFFSET 0");
}

#[test]
fn test_build_paginated_query_strips_semicolon_before_block_comment() {
    let q = "SELECT DATABASE() AS current_db; /* current schema */";
    let result = build_paginated_query(q, 1, 1);
    assert_eq!(result, "SELECT DATABASE() AS current_db LIMIT 2 OFFSET 0");
}

#[test]
fn test_build_paginated_query_keeps_line_comment_marker_inside_string() {
    let q = "SELECT '--'; -- trailing comment";
    let result = build_paginated_query(q, 1, 1);
    assert_eq!(result, "SELECT '--' LIMIT 2 OFFSET 0");
}

#[test]
fn test_build_paginated_query_keeps_line_comment_marker_after_backslash_quote() {
    let q = r"SELECT 'it\'s -- not a comment'; -- trailing comment";
    let result = build_paginated_query(q, 1, 1);
    assert_eq!(result, r"SELECT 'it\'s -- not a comment' LIMIT 2 OFFSET 0");
}

#[test]
fn test_build_paginated_query_preserves_newline_after_inline_comment_before_semicolon() {
    let q = "SELECT 1 -- inline comment\n;";
    let result = build_paginated_query(q, 1, 1);
    assert_eq!(result, "SELECT 1 -- inline comment\nLIMIT 2 OFFSET 0");
}

#[test]
fn test_build_paginated_query_preserves_trailing_line_comment_without_semicolon() {
    let q = "SELECT 1 -- inline comment";
    let result = build_paginated_query(q, 1, 1);
    assert_eq!(result, "SELECT 1 -- inline comment\nLIMIT 2 OFFSET 0");
}

#[test]
fn test_build_paginated_query_preserves_trailing_hash_comment_without_semicolon() {
    let q = "SELECT 1 # inline comment";
    let result = build_paginated_query(q, 1, 1);
    assert_eq!(result, "SELECT 1 # inline comment\nLIMIT 2 OFFSET 0");
}

#[test]
fn test_build_paginated_query_honors_user_limit_before_trailing_line_comment() {
    let q = "SELECT * FROM t ORDER BY id LIMIT 50 -- cap";
    let result = build_paginated_query(q, 100, 1);
    assert_eq!(result, "SELECT * FROM t ORDER BY id LIMIT 50 OFFSET 0");
}

#[test]
fn test_build_paginated_query_honors_user_limit_before_trailing_hash_comment() {
    let q = "SELECT * FROM t ORDER BY id LIMIT 50 # cap";
    let result = build_paginated_query(q, 100, 1);
    assert_eq!(result, "SELECT * FROM t ORDER BY id LIMIT 50 OFFSET 0");
}

#[test]
fn test_build_paginated_query_honors_user_limit_offset_before_trailing_comment() {
    let q = "SELECT * FROM t ORDER BY id LIMIT 50 OFFSET 10 -- cap";
    let result = build_paginated_query(q, 100, 1);
    assert_eq!(result, "SELECT * FROM t ORDER BY id LIMIT 50 OFFSET 10");
}

#[test]
fn test_build_paginated_query_honors_user_limit_after_backslash_quoted_string() {
    let q = r"SELECT 'it\'s LIMIT 5' AS label FROM t LIMIT 50 -- cap";
    let result = build_paginated_query(q, 100, 1);
    assert_eq!(result, r"SELECT 'it\'s LIMIT 5' AS label FROM t LIMIT 50 OFFSET 0");
}

#[test]
fn test_build_paginated_query_keeps_mysql_minus_expression() {
    let q = "SELECT 1--2;";
    let result = build_paginated_query(q, 1, 1);
    assert_eq!(result, "SELECT 1--2 LIMIT 2 OFFSET 0");
}

#[test]
fn test_build_paginated_query_keeps_hash_marker_inside_string() {
    let q = "SELECT '# not a comment'; # trailing comment";
    let result = build_paginated_query(q, 1, 1);
    assert_eq!(result, "SELECT '# not a comment' LIMIT 2 OFFSET 0");
}

#[test]
fn test_build_paginated_query_keeps_block_comment_marker_inside_string() {
    let q = "SELECT '/* not a comment */'; /* trailing comment */";
    let result = build_paginated_query(q, 1, 1);
    assert_eq!(result, "SELECT '/* not a comment */' LIMIT 2 OFFSET 0");
}

#[test]
fn test_build_paginated_query_honors_user_limit_before_trailing_semicolon() {
    let q = "SELECT * FROM t ORDER BY id LIMIT 50;";
    let result = build_paginated_query(q, 100, 1);
    assert_eq!(result, "SELECT * FROM t ORDER BY id LIMIT 50 OFFSET 0");
}

#[test]
fn test_build_paginated_query_honors_user_limit_offset_before_trailing_semicolon() {
    let q = "SELECT * FROM t ORDER BY id LIMIT 50 OFFSET 10;";
    let result = build_paginated_query(q, 100, 1);
    assert_eq!(result, "SELECT * FROM t ORDER BY id LIMIT 50 OFFSET 10");
}

#[test]
fn test_build_paginated_query_replaces_user_limit() {
    let q = "SELECT * FROM t ORDER BY id LIMIT 50";
    let result = build_paginated_query(q, 100, 1);
    // User wanted 50 rows. page_size=100, so remaining=50, fetch = min(50, 101) = 50
    assert_eq!(result, "SELECT * FROM t ORDER BY id LIMIT 50 OFFSET 0");
}

#[test]
fn test_build_paginated_query_user_limit_second_page() {
    let q = "SELECT * FROM t ORDER BY id LIMIT 250";
    let result = build_paginated_query(q, 100, 2);
    // offset=100, remaining=150, fetch = min(150, 101) = 101
    assert_eq!(result, "SELECT * FROM t ORDER BY id LIMIT 101 OFFSET 100");
}

#[test]
fn test_build_paginated_query_user_limit_exhausted() {
    let q = "SELECT * FROM t LIMIT 50";
    let result = build_paginated_query(q, 100, 2);
    // offset=100, remaining=0 (50-100 saturates to 0), fetch = min(0, 101) = 0
    assert_eq!(result, "SELECT * FROM t LIMIT 0 OFFSET 100");
}

#[test]
fn test_build_paginated_query_table_name_contains_limit() {
    let q = "SELECT * FROM tapp_appointment_message_event_limit ORDER BY id";
    let result = build_paginated_query(q, 100, 1);
    assert_eq!(
        result,
        "SELECT * FROM tapp_appointment_message_event_limit ORDER BY id LIMIT 101 OFFSET 0"
    );
}

#[test]
fn test_build_paginated_query_table_name_contains_limit_with_user_limit() {
    let q = "SELECT * FROM tapp_appointment_message_event_limit ORDER BY id LIMIT 10";
    let result = build_paginated_query(q, 100, 1);
    assert_eq!(
        result,
        "SELECT * FROM tapp_appointment_message_event_limit ORDER BY id LIMIT 10 OFFSET 0"
    );
}

#[test]
fn test_extract_user_offset_present() {
    assert_eq!(
        super::extract_user_offset("SELECT * FROM t LIMIT 1 OFFSET 1"),
        Some(1)
    );
}

#[test]
fn test_extract_user_offset_only_offset() {
    assert_eq!(
        super::extract_user_offset("SELECT * FROM t ORDER BY id OFFSET 5"),
        Some(5)
    );
}

#[test]
fn test_extract_user_offset_absent() {
    assert_eq!(
        super::extract_user_offset("SELECT * FROM t LIMIT 50"),
        None
    );
}

#[test]
fn test_build_paginated_query_preserves_user_offset() {
    // Regression for #273: `LIMIT 1 OFFSET 1` must keep OFFSET 1 on page 1,
    // not collapse to OFFSET 0 (which returned the 1st row instead of the 2nd).
    let q = "SELECT DISTINCT salary FROM employees ORDER BY salary DESC LIMIT 1 OFFSET 1";
    let result = build_paginated_query(q, 100, 1);
    assert_eq!(
        result,
        "SELECT DISTINCT salary FROM employees ORDER BY salary DESC LIMIT 1 OFFSET 1"
    );
}

#[test]
fn test_build_paginated_query_user_offset_no_limit() {
    let q = "SELECT * FROM t ORDER BY id OFFSET 5";
    let result = build_paginated_query(q, 100, 1);
    assert_eq!(result, "SELECT * FROM t ORDER BY id LIMIT 101 OFFSET 5");
}

#[test]
fn test_build_paginated_query_user_offset_second_page() {
    // page offset (100) is added on top of the user's OFFSET (5).
    let q = "SELECT * FROM t ORDER BY id OFFSET 5";
    let result = build_paginated_query(q, 100, 2);
    assert_eq!(result, "SELECT * FROM t ORDER BY id LIMIT 101 OFFSET 105");
}

#[test]
fn test_build_paginated_query_subquery_with_limit() {
    let q = "SELECT * FROM (SELECT id FROM t ORDER BY id LIMIT 100) sub ORDER BY id LIMIT 5";
    let result = build_paginated_query(q, 100, 1);
    assert_eq!(
        result,
        "SELECT * FROM (SELECT id FROM t ORDER BY id LIMIT 100) sub ORDER BY id LIMIT 5 OFFSET 0"
    );
}

#[test]
fn test_build_paginated_query_with_leading_comments() {
    let q = "-- header\nSELECT * FROM t ORDER BY id";
    let result = build_paginated_query(q, 100, 1);
    assert_eq!(
        result,
        "-- header\nSELECT * FROM t ORDER BY id LIMIT 101 OFFSET 0"
    );
}

#[test]
fn test_build_paginated_query_multiline_comments_with_user_limit() {
    // Leading-comment newlines must survive `strip_limit_offset` so the
    // appended `LIMIT … OFFSET …` lands on its own line rather than
    // being swallowed into the `--` header as comment text.
    let q = "-- ============\n-- title\n-- ============\n\nSELECT * FROM t ORDER BY id LIMIT 50";
    let result = build_paginated_query(q, 100, 1);
    assert_eq!(
        result,
        "-- ============\n-- title\n-- ============\n\nSELECT * FROM t ORDER BY id LIMIT 50 OFFSET 0"
    );
}

#[test]
fn test_strip_limit_offset_preserves_leading_comments() {
    assert_eq!(
        strip_limit_offset("-- header\nSELECT * FROM t LIMIT 10"),
        "-- header\nSELECT * FROM t"
    );
    assert_eq!(
        strip_limit_offset("-- l1\n-- l2\nSELECT * FROM t"),
        "-- l1\n-- l2\nSELECT * FROM t"
    );
}

#[test]
fn test_encode_blob_full_preserves_all_data() {
    // 8KB of data — encode_blob would truncate, encode_blob_full must not
    let data: Vec<u8> = (0u8..=255u8).cycle().take(8192).collect();
    let wire = encode_blob_full(&data);
    let decoded = decode_blob_wire_format(&wire, DEFAULT_MAX_BLOB_SIZE)
        .expect("should decode full wire format");
    assert_eq!(decoded.len(), 8192);
    assert_eq!(decoded, data);
}

#[test]
fn test_encode_blob_full_small_data_matches_encode_blob() {
    // For data smaller than MAX_BLOB_PREVIEW_SIZE both functions must produce
    // identical output since no truncation occurs.
    let data = b"small payload";
    assert_eq!(encode_blob_full(data), encode_blob(data));
}

#[test]
fn test_encode_blob_full_roundtrip_large() {
    // Simulate a real file upload: 50KB of pseudo-random data
    let data: Vec<u8> = (0..50_000).map(|i| (i % 256) as u8).collect();
    let wire = encode_blob_full(&data);

    // Wire format header must report the real size
    assert!(wire.starts_with(&format!("BLOB:{}:", data.len())));

    // Round-trip through decode must yield identical bytes
    let decoded = decode_blob_wire_format(&wire, DEFAULT_MAX_BLOB_SIZE)
        .expect("should decode 50KB wire format");
    assert_eq!(decoded, data);
}

#[test]
fn test_i64_to_json_small_values_stay_numbers() {
    assert_eq!(i64_to_json(0), serde_json::json!(0));
    assert_eq!(i64_to_json(42), serde_json::json!(42));
    assert_eq!(i64_to_json(-42), serde_json::json!(-42));
    assert_eq!(i64_to_json(1_000_000), serde_json::json!(1_000_000));
}

#[test]
fn test_i64_to_json_at_safe_boundary_stays_number() {
    assert_eq!(
        i64_to_json(JS_MAX_SAFE_INTEGER),
        serde_json::json!(JS_MAX_SAFE_INTEGER)
    );
    assert_eq!(
        i64_to_json(-JS_MAX_SAFE_INTEGER),
        serde_json::json!(-JS_MAX_SAFE_INTEGER)
    );
}

#[test]
fn test_i64_to_json_above_safe_becomes_string() {
    // The snowflake id from issue #210 — it must come back exactly.
    let snowflake: i64 = 844_197_938_335_842_304;
    assert_eq!(
        i64_to_json(snowflake),
        serde_json::Value::String("844197938335842304".to_string())
    );

    // One past the safe boundary on both sides.
    assert_eq!(
        i64_to_json(JS_MAX_SAFE_INTEGER + 1),
        serde_json::Value::String("9007199254740992".to_string())
    );
    assert_eq!(
        i64_to_json(-JS_MAX_SAFE_INTEGER - 1),
        serde_json::Value::String("-9007199254740992".to_string())
    );

    // Extremes of i64.
    assert_eq!(
        i64_to_json(i64::MAX),
        serde_json::Value::String(i64::MAX.to_string())
    );
    assert_eq!(
        i64_to_json(i64::MIN),
        serde_json::Value::String(i64::MIN.to_string())
    );
}

#[test]
fn test_u64_to_json_small_values_stay_numbers() {
    assert_eq!(u64_to_json(0), serde_json::json!(0));
    assert_eq!(u64_to_json(123), serde_json::json!(123));
}

#[test]
fn test_u64_to_json_at_safe_boundary_stays_number() {
    assert_eq!(
        u64_to_json(JS_MAX_SAFE_UINT),
        serde_json::json!(JS_MAX_SAFE_UINT)
    );
}

#[test]
fn test_u64_to_json_above_safe_becomes_string() {
    assert_eq!(
        u64_to_json(JS_MAX_SAFE_UINT + 1),
        serde_json::Value::String("9007199254740992".to_string())
    );
    assert_eq!(
        u64_to_json(u64::MAX),
        serde_json::Value::String(u64::MAX.to_string())
    );
}

#[test]
fn test_parse_unsafe_bigint_string_ignores_safe_values() {
    // Inside JS safe range — caller should keep these as JSON numbers,
    // not coerce text-looking-like-int into an integer bind.
    assert_eq!(parse_unsafe_bigint_string("42"), None);
    assert_eq!(parse_unsafe_bigint_string("-42"), None);
    assert_eq!(parse_unsafe_bigint_string("0"), None);
    assert_eq!(
        parse_unsafe_bigint_string(&JS_MAX_SAFE_INTEGER.to_string()),
        None
    );
}

#[test]
fn test_parse_unsafe_bigint_string_returns_outside_safe_range() {
    // The snowflake id from issue #210.
    assert_eq!(
        parse_unsafe_bigint_string("844197938335842304"),
        Some(844_197_938_335_842_304)
    );
    assert_eq!(
        parse_unsafe_bigint_string("9007199254740992"),
        Some(JS_MAX_SAFE_INTEGER + 1)
    );
    assert_eq!(
        parse_unsafe_bigint_string("-9007199254740992"),
        Some(-JS_MAX_SAFE_INTEGER - 1)
    );
    assert_eq!(parse_unsafe_bigint_string(&i64::MAX.to_string()), Some(i64::MAX));
}

#[test]
fn test_parse_unsafe_bigint_string_ignores_non_integer_strings() {
    assert_eq!(parse_unsafe_bigint_string(""), None);
    assert_eq!(parse_unsafe_bigint_string("hello"), None);
    assert_eq!(parse_unsafe_bigint_string("3.14"), None);
    assert_eq!(parse_unsafe_bigint_string("1e10"), None);
    // u64 values that overflow i64 stay strings — they exist in MySQL
    // (BIGINT UNSIGNED) but write-back to such columns is rare and the
    // driver-level cast still handles them via implicit conversion.
    assert_eq!(parse_unsafe_bigint_string("18446744073709551615"), None);
}
