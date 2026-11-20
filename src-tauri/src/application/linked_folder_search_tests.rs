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
    // A second file with 1 match must still be searched after the first hits the per-file cap.
    let mut lines = Vec::new();
    for i in 1..=60 {
        lines.push(format!("SELECT {i} AS val, 'TARGET' AS t;"));
    }
    fs::write(root.join("a_big.sql"), lines.join("\n")).unwrap();
    fs::write(root.join("b_small.sql"), "SELECT 1 AS ok, 'TARGET' AS t;\n").unwrap();

    let res = search_linked_folder_root("folder-1", root, "TARGET", false).unwrap();
    assert_eq!(res.files_searched, 2);
    assert_eq!(res.matches.len(), MAX_MATCHES_PER_FILE + 1);
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

    // 4 files with exactly 50 matches each = 200 matches total, no further matches
    for f in 1..=4 {
        let mut lines = Vec::new();
        for i in 1..=50 {
            lines.push(format!("SELECT {i} AS val, 'BURST' AS b;"));
        }
        fs::write(root.join(format!("batch_{f}.sql")), lines.join("\n")).unwrap();
    }

    let res = search_linked_folder_root("folder-1", root, "BURST", false).unwrap();
    assert_eq!(res.matches.len(), MAX_SEARCH_RESULTS);
    assert!(!res.truncated);
}

#[test]
fn test_search_201st_match_sets_truncated() {
    let dir = tempdir().unwrap();
    let root = dir.path();

    for f in 1..=4 {
        let mut lines = Vec::new();
        for i in 1..=50 {
            lines.push(format!("SELECT {i} AS val, 'BURST' AS b;"));
        }
        fs::write(root.join(format!("batch_{f}.sql")), lines.join("\n")).unwrap();
    }
    fs::write(root.join("extra.sql"), "SELECT 'BURST';\n").unwrap();

    let res = search_linked_folder_root("folder-1", root, "BURST", false).unwrap();
    assert_eq!(res.matches.len(), MAX_SEARCH_RESULTS);
    assert!(res.truncated);
}

#[test]
fn test_search_depth_limit() {
    let dir = tempdir().unwrap();
    let root = dir.path();

    // MAX_RELATIVE_DEPTH is 16: 15 nested directories + file = 16 segments (allowed)
    let mut allowed_dir = root.to_path_buf();
    for i in 1..MAX_RELATIVE_DEPTH {
        allowed_dir = allowed_dir.join(format!("d{i}"));
    }
    fs::create_dir_all(&allowed_dir).unwrap();
    fs::write(allowed_dir.join("ok.sql"), "SELECT 'DEPTH_TARGET';\n").unwrap();

    // One level deeper: 16 directories + file = 17 segments (exceeds MAX_RELATIVE_DEPTH)
    let too_deep_dir = allowed_dir.join("d16");
    fs::create_dir_all(&too_deep_dir).unwrap();
    fs::write(too_deep_dir.join("too_deep.sql"), "SELECT 'DEPTH_TARGET';\n").unwrap();

    let res = search_linked_folder_root("folder-1", root, "DEPTH_TARGET", false).unwrap();
    assert_eq!(res.matches.len(), 1);
    assert!(res.matches[0].relative_path.ends_with("/ok.sql"));
}

#[test]
fn test_search_empty_file() {
    let dir = tempdir().unwrap();
    let root = dir.path();
    fs::write(root.join("empty.sql"), "").unwrap();

    let res = search_linked_folder_root("folder-1", root, "SELECT", false).unwrap();
    assert_eq!(res.files_searched, 1);
    assert_eq!(res.files_skipped, 0);
    assert!(res.matches.is_empty());
    assert!(!res.truncated);
}

#[test]
fn test_search_non_utf8_file_skipped() {
    let dir = tempdir().unwrap();
    let root = dir.path();
    fs::write(root.join("bad.sql"), b"\xff\xfe\x00\x80SELECT 1;\n").unwrap();
    fs::write(root.join("good.sql"), "SELECT 1;\n").unwrap();

    let res = search_linked_folder_root("folder-1", root, "SELECT", false).unwrap();
    assert_eq!(res.files_searched, 1);
    assert_eq!(res.files_skipped, 1);
    assert_eq!(res.matches.len(), 1);
    assert_eq!(res.matches[0].relative_path, "good.sql");
}

#[test]
fn test_search_cancellation() {
    use std::sync::atomic::{AtomicUsize, Ordering};

    let dir = tempdir().unwrap();
    let root = dir.path();
    fs::write(root.join("a.sql"), "SELECT 'CANCEL_TARGET';\n").unwrap();
    fs::write(root.join("b.sql"), "SELECT 'CANCEL_TARGET';\n").unwrap();

    let checks = AtomicUsize::new(0);
    let err = search_linked_folder_root_with_cancel("folder-1", root, "CANCEL_TARGET", false, || {
        checks.fetch_add(1, Ordering::SeqCst) >= 2
    })
    .unwrap_err();
    assert_eq!(err, LINKED_SEARCH_CANCELLED);
}

#[cfg(unix)]
mod symlinks {
    use super::*;
    use std::os::unix::fs::symlink;

    #[test]
    fn test_search_visited_dirs_deduplication() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        let sub = root.join("sub");
        fs::create_dir(&sub).unwrap();
        fs::write(sub.join("test.sql"), "SELECT 'DEDUP_TARGET';\n").unwrap();
        symlink(&sub, root.join("sub_alias")).unwrap();

        let res = search_linked_folder_root("folder-1", root, "DEDUP_TARGET", false).unwrap();
        assert_eq!(res.matches.len(), 1);
        assert_eq!(res.files_searched, 1);
    }

    #[test]
    fn test_search_symlink_escape_blocked() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("root");
        let outside = dir.path().join("outside");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();

        fs::write(outside.join("secret.sql"), "SELECT 'ESCAPE_TARGET';\n").unwrap();
        fs::write(root.join("local.sql"), "SELECT 'LOCAL_TARGET';\n").unwrap();
        symlink(&outside, root.join("escape_dir")).unwrap();
        symlink(outside.join("secret.sql"), root.join("escape_file.sql")).unwrap();

        let res = search_linked_folder_root("folder-1", &root, "ESCAPE_TARGET", false).unwrap();
        assert!(res.matches.is_empty());
        assert_eq!(res.files_searched, 1);
    }

    #[test]
    fn test_search_symlink_cycles_terminate() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        let a = root.join("a");
        fs::create_dir(&a).unwrap();
        fs::write(a.join("ok.sql"), "SELECT 'CYCLE_TARGET';\n").unwrap();
        symlink(root, a.join("loop")).unwrap();

        let res = search_linked_folder_root("folder-1", root, "CYCLE_TARGET", false).unwrap();
        assert_eq!(res.matches.len(), 1);
        assert_eq!(res.files_searched, 1);
    }

    #[test]
    fn test_search_symlink_non_sql_and_hidden_targets_skipped() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        let hidden_dir = root.join(".hidden_dir");
        fs::create_dir(&hidden_dir).unwrap();
        fs::write(hidden_dir.join("secret.sql"), "SELECT 'TARGET';\n").unwrap();
        fs::write(root.join("notes.txt"), "SELECT 'TARGET';\n").unwrap();

        symlink(root.join("notes.txt"), root.join("x.sql")).unwrap();
        symlink(&hidden_dir, root.join("visible_alias")).unwrap();

        let res = search_linked_folder_root("folder-1", root, "TARGET", false).unwrap();
        assert!(res.matches.is_empty());
        assert_eq!(res.files_searched, 0);
    }
}
