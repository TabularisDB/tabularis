use super::{
    build_paginated_query, decode_blob_wire_format, encode_blob, encode_blob_full,
    is_explainable_query, is_select_query, strip_leading_sql_comments, strip_limit_offset,
    DEFAULT_MAX_BLOB_SIZE, MAX_BLOB_PREVIEW_SIZE,
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
fn test_build_paginated_query_no_user_limit() {
    let q = "SELECT o.id FROM orders o ORDER BY o.created_at DESC";
    let result = build_paginated_query(q, 100, 1);
    assert_eq!(
        result,
        "SELECT o.id FROM orders o ORDER BY o.created_at DESC LIMIT 101 OFFSET 0"
    );
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
