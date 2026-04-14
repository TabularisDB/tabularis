/// Maximum size in bytes for BLOB data to include as base64 preview.
/// All blobs are serialised as "BLOB:<size>:<mime_type>:<base64_data>".
/// For blobs larger than this threshold only the first N bytes are included;
/// smaller blobs are encoded in full.
pub const MAX_BLOB_PREVIEW_SIZE: usize = 4096;

/// Default maximum size in bytes for a BLOB file that can be uploaded/loaded into memory.
/// Files larger than this limit will be rejected to prevent memory exhaustion.
/// Default limit: 100MB (104,857,600 bytes)
/// Can be overridden via config.json with "maxBlobSize" field.
pub const DEFAULT_MAX_BLOB_SIZE: u64 = 100 * 1024 * 1024;

/// Encodes a blob byte slice into the canonical wire format used by all drivers.
/// Format: "BLOB:<total_size_bytes>:<mime_type>:<base64_data>"
pub fn encode_blob(data: &[u8]) -> String {
    let total_size = data.len();
    let preview = if total_size > MAX_BLOB_PREVIEW_SIZE {
        &data[..MAX_BLOB_PREVIEW_SIZE]
    } else {
        data
    };

    let mime_type = infer::get(preview)
        .map(|k| k.mime_type())
        .unwrap_or("application/octet-stream");

    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, preview);

    format!("BLOB:{}:{}:{}", total_size, mime_type, b64)
}

/// Encodes a blob byte slice into the canonical wire format encoding ALL bytes.
/// Unlike `encode_blob` which truncates to MAX_BLOB_PREVIEW_SIZE for the read
/// path, this function preserves the complete data — used by upload / write paths
/// so that files larger than 4KB are not silently truncated.
pub fn encode_blob_full(data: &[u8]) -> String {
    let total_size = data.len();

    let mime_type = infer::get(data)
        .map(|k| k.mime_type())
        .unwrap_or("application/octet-stream");

    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, data);

    format!("BLOB:{}:{}:{}", total_size, mime_type, b64)
}

/// Resolves a BLOB_FILE_REF to actual bytes by reading from disk.
/// Format: "BLOB_FILE_REF:<size>:<mime>:<filepath>"
/// Returns the raw file bytes, or an error if the file cannot be read.
/// Enforces max_size limit to prevent memory exhaustion.
pub fn resolve_blob_file_ref(value: &str, max_size: u64) -> Result<Vec<u8>, String> {
    let rest = value
        .strip_prefix("BLOB_FILE_REF:")
        .ok_or_else(|| "Not a BLOB_FILE_REF".to_string())?;

    // Parse: <size>:<mime>:<filepath>
    let parts: Vec<&str> = rest.splitn(3, ':').collect();
    if parts.len() != 3 {
        return Err("Invalid BLOB_FILE_REF format".to_string());
    }

    let size_str = parts[0];
    let file_path = parts[2];

    // Parse and validate file size
    let file_size: u64 = size_str
        .parse()
        .map_err(|_| "Invalid file size in BLOB_FILE_REF".to_string())?;

    if file_size > max_size {
        return Err(format!(
            "File size ({} bytes) exceeds maximum allowed size ({} bytes / {}MB). Please choose a smaller file.",
            file_size,
            max_size,
            max_size / (1024 * 1024)
        ));
    }

    // Read file from disk
    std::fs::read(file_path).map_err(|e| format!("Failed to read BLOB file: {}", e))
}

/// Decodes the canonical blob wire format back to raw bytes.
///
/// Expected format: "BLOB:<total_size_bytes>:<mime_type>:<base64_data>"
/// or "BLOB_FILE_REF:<size>:<mime>:<filepath>"
///
/// Returns `Some(Vec<u8>)` with the decoded bytes if the string matches the
/// wire format, or `None` if it is a plain string that should be stored as-is.
/// This is used by all write paths (update_record / insert_record) so that the
/// database always receives raw binary data instead of the internal wire format
/// string, ensuring interoperability with other SQL editors.
pub fn decode_blob_wire_format(value: &str, max_size: u64) -> Option<Vec<u8>> {
    // Handle BLOB_FILE_REF first
    if value.starts_with("BLOB_FILE_REF:") {
        return resolve_blob_file_ref(value, max_size).ok();
    }

    // Format: "BLOB:<digits>:<mime_type>:<base64_data>"
    // MIME type can contain letters, digits, dots, plus, hyphens, slashes
    let rest = value.strip_prefix("BLOB:")?;

    // Skip the size field
    let after_size = rest.splitn(2, ':').nth(1)?;

    // Skip the mime field — split only on the first colon after mime
    let base64_data = after_size.splitn(2, ':').nth(1)?;

    base64::Engine::decode(&base64::engine::general_purpose::STANDARD, base64_data).ok()
}

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
/// appending pagination clauses directly.  ORDER BY is left in place so that
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

#[cfg(test)]
mod tests {
    use super::*;

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
        assert!(is_explainable_query("WITH cte AS (SELECT 1) SELECT * FROM cte"));
        assert!(is_explainable_query("TABLE users"));
    }

    #[test]
    fn test_is_explainable_query_ddl() {
        assert!(!is_explainable_query("CREATE INDEX idx ON t(col)"));
        assert!(!is_explainable_query("CREATE TABLE users (id INT)"));
        assert!(!is_explainable_query("DROP TABLE users"));
        assert!(!is_explainable_query("ALTER TABLE users ADD COLUMN name TEXT"));
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
        assert_eq!(calculate_offset(1, 100), 0);
        assert_eq!(calculate_offset(2, 100), 100);
        assert_eq!(calculate_offset(3, 50), 100);
        assert_eq!(calculate_offset(10, 25), 225);
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
            extract_user_limit("SELECT * FROM t LIMIT 50"),
            Some(50)
        );
    }

    #[test]
    fn test_extract_user_limit_with_offset() {
        assert_eq!(
            extract_user_limit("SELECT * FROM t LIMIT 100 OFFSET 20"),
            Some(100)
        );
    }

    #[test]
    fn test_extract_user_limit_absent() {
        assert_eq!(
            extract_user_limit("SELECT * FROM t ORDER BY id"),
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
        assert_eq!(
            result,
            "SELECT * FROM t ORDER BY id LIMIT 50 OFFSET 0"
        );
    }

    #[test]
    fn test_build_paginated_query_user_limit_second_page() {
        let q = "SELECT * FROM t ORDER BY id LIMIT 250";
        let result = build_paginated_query(q, 100, 2);
        // offset=100, remaining=150, fetch = min(150, 101) = 101
        assert_eq!(
            result,
            "SELECT * FROM t ORDER BY id LIMIT 101 OFFSET 100"
        );
    }

    #[test]
    fn test_build_paginated_query_user_limit_exhausted() {
        let q = "SELECT * FROM t LIMIT 50";
        let result = build_paginated_query(q, 100, 2);
        // offset=100, remaining=0 (50-100 saturates to 0), fetch = min(0, 101) = 0
        assert_eq!(
            result,
            "SELECT * FROM t LIMIT 0 OFFSET 100"
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
}
