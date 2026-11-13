use super::*;
use std::fs;
use tempfile::tempdir;

#[test]
fn test_search_empty_query() {
    let dir = tempdir().unwrap();
    let root = dir.path();
    let res = search_linked_folder_root("folder-1", root, "   ", false).unwrap();
    assert_eq!(res.matches.len(), 0);
    assert_eq!(res.files_searched, 0);
    assert!(!res.truncated);
}

#[test]
fn test_search_literal_match_and_line_column() {
    let dir = tempdir().unwrap();
    let root = dir.path();
    let sql_file = root.join("query.sql");
    fs::write(
        &sql_file,
        "SELECT * FROM users;\nSELECT legacy_status, id FROM orders;\n",
    )
    .unwrap();

    let res = search_linked_folder_root("folder-1", root, "legacy_status", false).unwrap();
    assert_eq!(res.files_searched, 1);
    assert_eq!(res.files_skipped, 0);
    assert_eq!(res.matches.len(), 1);

    let m = &res.matches[0];
    assert_eq!(m.relative_path, "query.sql");
    assert_eq!(m.line_number, 2);
    assert_eq!(m.column_number, 8); // "SELECT legacy_status..." -> col 8 (1-based)
    assert_eq!(m.match_length, 13);
    assert!(m.line_content.contains("legacy_status"));
}

#[test]
fn test_search_case_sensitivity() {
    let dir = tempdir().unwrap();
    let root = dir.path();
    let sql_file = root.join("test.sql");
    fs::write(&sql_file, "select Legacy_Status from t;\n").unwrap();

    // Case-insensitive (default)
    let res_ci = search_linked_folder_root("folder-1", root, "legacy_status", false).unwrap();
    assert_eq!(res_ci.matches.len(), 1);

    // Case-sensitive
    let res_cs_miss = search_linked_folder_root("folder-1", root, "legacy_status", true).unwrap();
    assert_eq!(res_cs_miss.matches.len(), 0);

    let res_cs_hit = search_linked_folder_root("folder-1", root, "Legacy_Status", true).unwrap();
    assert_eq!(res_cs_hit.matches.len(), 1);
}

#[test]
fn test_search_crlf_and_unicode() {
    let dir = tempdir().unwrap();
    let root = dir.path();
    let sql_file = root.join("unicode.sql");
    // CRLF and Cyrillic / Asian characters
    let content = "SELECT 'тест' FROM таблица;\r\nSELECT 'данные' FROM dual;\r\n";
    fs::write(&sql_file, content).unwrap();

    let res = search_linked_folder_root("folder-1", root, "таблица", false).unwrap();
    assert_eq!(res.matches.len(), 1);
    let m = &res.matches[0];
    assert_eq!(m.line_number, 1);
    // Ensure trailing \r is cleanly stripped
    assert!(!m.line_content.ends_with('\r'));
    assert!(m.line_content.contains("таблица"));
}

#[test]
fn test_search_case_insensitive_length_changing_unicode_no_panic() {
    let dir = tempdir().unwrap();
    let root = dir.path();
    let sql_file = root.join("turkish.sql");
    // 'İ' (U+0130, uppercase dotted I, 2 bytes) lowercases to 'i' + U+0307 (3 bytes).
    // Ensure case-insensitive search never panics on byte boundary slicing.
    let content = "SELECT 'İSTANBUL' AS city, 'istanbul' AS alt;\n";
    fs::write(&sql_file, content).unwrap();

    let res = search_linked_folder_root("folder-1", root, "İSTANBUL", false).unwrap();
    assert_eq!(res.matches.len(), 1);
    assert_eq!(res.matches[0].column_number, 9);
}

#[test]
fn test_search_skips_hidden_and_non_sql() {
    let dir = tempdir().unwrap();
    let root = dir.path();

    fs::write(root.join(".hidden.sql"), "legacy_status in hidden").unwrap();
    fs::write(root.join("notes.txt"), "legacy_status in txt").unwrap();
    fs::write(root.join("script.sql"), "legacy_status in sql").unwrap();

    let res = search_linked_folder_root("folder-1", root, "legacy_status", false).unwrap();
    assert_eq!(res.files_searched, 1);
    assert_eq!(res.matches.len(), 1);
    assert_eq!(res.matches[0].relative_path, "script.sql");
}

#[test]
fn test_search_subdirectory_traversal() {
    let dir = tempdir().unwrap();
    let root = dir.path();

    let sub = root.join("reports").join("monthly");
    fs::create_dir_all(&sub).unwrap();
    fs::write(sub.join("report.psql"), "SELECT 42 AS my_magic_num;").unwrap();

    let res = search_linked_folder_root("folder-1", root, "my_magic_num", false).unwrap();
    assert_eq!(res.files_searched, 1);
    assert_eq!(res.matches.len(), 1);
    // Relative path must always be forward-slash separated
    assert_eq!(res.matches[0].relative_path, "reports/monthly/report.psql");
}

#[test]
fn test_search_file_match_cap_triggers_truncation() {
    let dir = tempdir().unwrap();
    let root = dir.path();

    // Create a file with 60 occurrences of TARGET. MAX_MATCHES_PER_FILE is 50.
    let mut lines = Vec::new();
    for i in 1..=60 {
        lines.push(format!("SELECT {i} AS val, 'TARGET' AS t;"));
    }
    fs::write(root.join("capped.sql"), lines.join("\n")).unwrap();

    let res = search_linked_folder_root("folder-1", root, "TARGET", false).unwrap();
    assert_eq!(res.files_searched, 1);
    assert_eq!(res.matches.len(), MAX_MATCHES_PER_FILE);
    assert!(res.truncated);
}

#[test]
fn test_search_snippet_truncation() {
    let dir = tempdir().unwrap();
    let root = dir.path();

    let long_prefix = "a".repeat(300);
    let long_suffix = "b".repeat(300);
    let line = format!("{long_prefix}TARGET_WORD{long_suffix}\n");
    fs::write(root.join("wide.sql"), line).unwrap();

    let res = search_linked_folder_root("folder-1", root, "TARGET_WORD", false).unwrap();
    assert_eq!(res.matches.len(), 1);
    let m = &res.matches[0];
    assert!(m.line_content.contains("TARGET_WORD"));
    assert!(m.line_content.len() < 400); // Truncated with ellipsis
    assert!(m.line_content.starts_with("...") || m.line_content.ends_with("..."));
}

#[test]
fn test_search_exact_200_results_boundary() {
    let dir = tempdir().unwrap();
    let root = dir.path();

    // 4 files with exactly 50 matches each = 200 matches total
    for f in 1..=4 {
        let mut lines = Vec::new();
        for i in 1..=50 {
            lines.push(format!("SELECT {i} AS val, 'BURST' AS b;"));
        }
        fs::write(root.join(format!("batch_{f}.sql")), lines.join("\n")).unwrap();
    }

    let res = search_linked_folder_root("folder-1", root, "BURST", false).unwrap();
    assert_eq!(res.matches.len(), MAX_SEARCH_RESULTS);
    assert!(res.truncated);
}

#[test]
fn test_search_visited_dirs_deduplication() {
    let dir = tempdir().unwrap();
    let root = dir.path();

    let sub = root.join("sub");
    fs::create_dir(&sub).unwrap();
    fs::write(sub.join("test.sql"), "SELECT 'DEDUP_TARGET';\n").unwrap();

    let res = search_linked_folder_root("folder-1", root, "DEDUP_TARGET", false).unwrap();
    assert_eq!(res.matches.len(), 1);
    assert_eq!(res.files_searched, 1);
}
