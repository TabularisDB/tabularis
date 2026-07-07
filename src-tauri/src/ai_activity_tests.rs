#[cfg(test)]
mod tests {
    use crate::ai_activity::{
        append_event_in, classify_query_kind, clear_in, compute_or_rotate_session_id_in,
        load_session_state_in, read_events_in, read_session_events_in, read_sessions_in,
        rotate_if_needed_in, save_session_state_in, set_client_hint_in,
        strip_strings_and_comments, to_local_rfc3339, AiActivityEvent, EventFilter, SessionState,
    };
    use std::path::Path;
    use tempfile::TempDir;

    fn make_event(id: &str, session_id: &str, tool: &str, ts: &str) -> AiActivityEvent {
        AiActivityEvent {
            id: id.to_string(),
            session_id: session_id.to_string(),
            timestamp: ts.to_string(),
            tool: tool.to_string(),
            connection_id: Some("conn-1".to_string()),
            connection_name: Some("local".to_string()),
            query: Some("SELECT 1".to_string()),
            query_kind: Some("select".to_string()),
            duration_ms: 5,
            status: "success".to_string(),
            rows: Some(1),
            error: None,
            client_hint: Some("claude-desktop".to_string()),
            approval_id: None,
        }
    }

    fn append(dir: &Path, ev: AiActivityEvent) {
        append_event_in(dir, &ev).expect("append");
    }

    // -----------------------------------------------------------------------
    // Append + read roundtrip
    // -----------------------------------------------------------------------

    #[test]
    fn append_then_read_returns_same_event() {
        let tmp = TempDir::new().unwrap();
        let ev = make_event("a", "sess-1", "list_tables", "2026-04-24T10:00:00Z");
        append(tmp.path(), ev.clone());
        let read = read_events_in(tmp.path(), &EventFilter::default()).unwrap();
        assert_eq!(read.len(), 1);
        assert_eq!(read[0], ev);
    }

    #[test]
    fn read_returns_events_in_chronological_order() {
        let tmp = TempDir::new().unwrap();
        append(tmp.path(), make_event("1", "s", "run_query", "2026-04-24T10:00:00Z"));
        append(tmp.path(), make_event("2", "s", "run_query", "2026-04-24T10:01:00Z"));
        append(tmp.path(), make_event("3", "s", "run_query", "2026-04-24T10:02:00Z"));
        let events = read_events_in(tmp.path(), &EventFilter::default()).unwrap();
        let ids: Vec<&str> = events.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids, vec!["1", "2", "3"]);
    }

    #[test]
    fn read_skips_unparsable_lines() {
        let tmp = TempDir::new().unwrap();
        append(tmp.path(), make_event("ok", "s", "list_tables", "2026-04-24T10:00:00Z"));
        let path = tmp.path().join("ai_activity.jsonl");
        let mut content = std::fs::read_to_string(&path).unwrap();
        content.push_str("not-json\n\n{}\n");
        std::fs::write(&path, content).unwrap();
        let events = read_events_in(tmp.path(), &EventFilter::default()).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].id, "ok");
    }

    // -----------------------------------------------------------------------
    // Filters
    // -----------------------------------------------------------------------

    #[test]
    fn filter_by_session_id() {
        let tmp = TempDir::new().unwrap();
        append(tmp.path(), make_event("a", "s1", "run_query", "2026-04-24T10:00:00Z"));
        append(tmp.path(), make_event("b", "s2", "run_query", "2026-04-24T10:01:00Z"));
        let f = EventFilter {
            session_id: Some("s2".into()),
            ..Default::default()
        };
        let events = read_events_in(tmp.path(), &f).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].id, "b");
    }

    #[test]
    fn filter_by_connection_id() {
        let tmp = TempDir::new().unwrap();
        let mut a = make_event("a", "s", "run_query", "2026-04-24T10:00:00Z");
        a.connection_id = Some("c1".into());
        let mut b = make_event("b", "s", "run_query", "2026-04-24T10:01:00Z");
        b.connection_id = Some("c2".into());
        append(tmp.path(), a);
        append(tmp.path(), b);
        let f = EventFilter {
            connection_id: Some("c2".into()),
            ..Default::default()
        };
        let events = read_events_in(tmp.path(), &f).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].id, "b");
    }

    #[test]
    fn filter_by_tool() {
        let tmp = TempDir::new().unwrap();
        append(tmp.path(), make_event("a", "s", "list_tables", "2026-04-24T10:00:00Z"));
        append(tmp.path(), make_event("b", "s", "run_query", "2026-04-24T10:01:00Z"));
        let f = EventFilter {
            tool: Some("run_query".into()),
            ..Default::default()
        };
        let events = read_events_in(tmp.path(), &f).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].id, "b");
    }

    #[test]
    fn filter_by_status() {
        let tmp = TempDir::new().unwrap();
        let mut a = make_event("a", "s", "run_query", "2026-04-24T10:00:00Z");
        a.status = "error".into();
        let b = make_event("b", "s", "run_query", "2026-04-24T10:01:00Z");
        append(tmp.path(), a);
        append(tmp.path(), b);
        let f = EventFilter {
            status: Some("error".into()),
            ..Default::default()
        };
        let events = read_events_in(tmp.path(), &f).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].id, "a");
    }

    #[test]
    fn filter_by_query_contains_is_case_insensitive() {
        let tmp = TempDir::new().unwrap();
        let mut a = make_event("a", "s", "run_query", "2026-04-24T10:00:00Z");
        a.query = Some("SELECT * FROM ORDERS".into());
        let mut b = make_event("b", "s", "run_query", "2026-04-24T10:01:00Z");
        b.query = Some("SELECT * FROM users".into());
        append(tmp.path(), a);
        append(tmp.path(), b);
        let f = EventFilter {
            query_contains: Some("orders".into()),
            ..Default::default()
        };
        let events = read_events_in(tmp.path(), &f).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].id, "a");
    }

    #[test]
    fn filter_by_since_until_range() {
        let tmp = TempDir::new().unwrap();
        append(tmp.path(), make_event("1", "s", "run_query", "2026-04-24T09:00:00Z"));
        append(tmp.path(), make_event("2", "s", "run_query", "2026-04-24T10:00:00Z"));
        append(tmp.path(), make_event("3", "s", "run_query", "2026-04-24T11:00:00Z"));
        let f = EventFilter {
            since: Some("2026-04-24T10:00:00Z".into()),
            until: Some("2026-04-24T10:30:00Z".into()),
            ..Default::default()
        };
        let events = read_events_in(tmp.path(), &f).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].id, "2");
    }

    // -----------------------------------------------------------------------
    // Sessions grouping
    // -----------------------------------------------------------------------

    #[test]
    fn read_sessions_groups_by_session_id() {
        let tmp = TempDir::new().unwrap();
        append(tmp.path(), make_event("1", "s1", "list_tables", "2026-04-24T10:00:00Z"));
        append(tmp.path(), make_event("2", "s1", "run_query", "2026-04-24T10:05:00Z"));
        append(tmp.path(), make_event("3", "s2", "run_query", "2026-04-24T11:00:00Z"));
        let sessions = read_sessions_in(tmp.path()).unwrap();
        assert_eq!(sessions.len(), 2);
        let s1 = sessions.iter().find(|s| s.session_id == "s1").unwrap();
        assert_eq!(s1.event_count, 2);
        assert_eq!(s1.run_query_count, 1);
        assert_eq!(s1.started_at, "2026-04-24T10:00:00Z");
        assert_eq!(s1.ended_at, "2026-04-24T10:05:00Z");
    }

    #[test]
    fn read_session_events_filters_and_sorts() {
        let tmp = TempDir::new().unwrap();
        append(tmp.path(), make_event("a", "x", "run_query", "2026-04-24T10:01:00Z"));
        append(tmp.path(), make_event("b", "x", "run_query", "2026-04-24T10:00:00Z"));
        append(tmp.path(), make_event("c", "y", "run_query", "2026-04-24T10:02:00Z"));
        let events = read_session_events_in(tmp.path(), "x").unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].id, "b");
        assert_eq!(events[1].id, "a");
    }

    // -----------------------------------------------------------------------
    // Rotation
    // -----------------------------------------------------------------------

    #[test]
    fn rotation_triggers_when_threshold_reached() {
        let tmp = TempDir::new().unwrap();
        for i in 0..5 {
            append(
                tmp.path(),
                make_event(&i.to_string(), "s", "run_query", "2026-04-24T10:00:00Z"),
            );
        }
        let rotated = rotate_if_needed_in(tmp.path(), 5).unwrap();
        assert!(rotated);
        assert!(tmp.path().join("ai_activity.1.jsonl").exists());
        assert!(!tmp.path().join("ai_activity.jsonl").exists());
    }

    #[test]
    fn rotation_no_op_below_threshold() {
        let tmp = TempDir::new().unwrap();
        append(
            tmp.path(),
            make_event("0", "s", "run_query", "2026-04-24T10:00:00Z"),
        );
        let rotated = rotate_if_needed_in(tmp.path(), 100).unwrap();
        assert!(!rotated);
        assert!(tmp.path().join("ai_activity.jsonl").exists());
        assert!(!tmp.path().join("ai_activity.1.jsonl").exists());
    }

    #[test]
    fn rotation_keeps_5_archived_files_max() {
        let tmp = TempDir::new().unwrap();
        // Trigger 7 rotations; only 5 archives should remain (1..=5).
        for cycle in 0..7 {
            for i in 0..3 {
                append(
                    tmp.path(),
                    make_event(
                        &format!("{}-{}", cycle, i),
                        "s",
                        "run_query",
                        "2026-04-24T10:00:00Z",
                    ),
                );
            }
            rotate_if_needed_in(tmp.path(), 3).unwrap();
        }
        for i in 1..=5 {
            assert!(
                tmp.path().join(format!("ai_activity.{}.jsonl", i)).exists(),
                "archive {} should exist",
                i
            );
        }
        assert!(!tmp.path().join("ai_activity.6.jsonl").exists());
    }

    #[test]
    fn read_includes_archived_events_oldest_first() {
        let tmp = TempDir::new().unwrap();
        for i in 0..3 {
            append(
                tmp.path(),
                make_event(
                    &format!("old-{}", i),
                    "s",
                    "run_query",
                    "2026-04-24T09:00:00Z",
                ),
            );
        }
        rotate_if_needed_in(tmp.path(), 3).unwrap();
        append(
            tmp.path(),
            make_event("new", "s", "run_query", "2026-04-24T10:00:00Z"),
        );
        let events = read_events_in(tmp.path(), &EventFilter::default()).unwrap();
        assert_eq!(events.len(), 4);
        assert_eq!(events.first().unwrap().id, "old-0");
        assert_eq!(events.last().unwrap().id, "new");
    }

    #[test]
    fn clear_removes_active_and_archived_files() {
        let tmp = TempDir::new().unwrap();
        for i in 0..3 {
            append(
                tmp.path(),
                make_event(&i.to_string(), "s", "run_query", "2026-04-24T10:00:00Z"),
            );
        }
        rotate_if_needed_in(tmp.path(), 3).unwrap();
        append(
            tmp.path(),
            make_event("z", "s", "run_query", "2026-04-24T11:00:00Z"),
        );
        clear_in(tmp.path()).unwrap();
        assert!(!tmp.path().join("ai_activity.jsonl").exists());
        assert!(!tmp.path().join("ai_activity.1.jsonl").exists());
        let events = read_events_in(tmp.path(), &EventFilter::default()).unwrap();
        assert!(events.is_empty());
    }

    // -----------------------------------------------------------------------
    // strip_strings_and_comments
    // -----------------------------------------------------------------------

    #[test]
    fn strip_removes_line_comments() {
        let s = strip_strings_and_comments("SELECT 1 -- DROP TABLE t\nFROM x");
        assert!(!s.to_uppercase().contains("DROP"));
        assert!(s.contains("FROM"));
    }

    #[test]
    fn strip_removes_block_comments() {
        let s = strip_strings_and_comments("SELECT /* DELETE FROM y */ 1");
        assert!(!s.to_uppercase().contains("DELETE"));
    }

    #[test]
    fn strip_handles_unterminated_block_comment() {
        let s = strip_strings_and_comments("SELECT 1 /* DELETE");
        assert!(!s.to_uppercase().contains("DELETE"));
    }

    #[test]
    fn strip_removes_single_quoted_strings() {
        let s = strip_strings_and_comments("SELECT 'DROP TABLE x' FROM t");
        assert!(!s.to_uppercase().contains("DROP TABLE"));
        assert!(s.contains("FROM"));
    }

    #[test]
    fn strip_handles_escaped_single_quote() {
        let s = strip_strings_and_comments("SELECT 'it''s ok DELETE' FROM t");
        assert!(!s.to_uppercase().contains("DELETE"));
    }

    #[test]
    fn strip_removes_double_quoted_identifiers() {
        let s = strip_strings_and_comments("SELECT \"DROP\" FROM t");
        assert!(!s.contains("\"DROP\""));
    }

    #[test]
    fn strip_removes_backtick_identifiers() {
        let s = strip_strings_and_comments("SELECT `DELETE` FROM t");
        assert!(!s.contains("`DELETE`"));
    }

    // -----------------------------------------------------------------------
    // classify_query_kind
    // -----------------------------------------------------------------------

    #[test]
    fn classify_select() {
        assert_eq!(classify_query_kind("SELECT 1"), "select");
        assert_eq!(classify_query_kind("  select * from t"), "select");
        assert_eq!(classify_query_kind("SHOW TABLES"), "select");
        assert_eq!(classify_query_kind("EXPLAIN SELECT 1"), "select");
        assert_eq!(classify_query_kind("DESCRIBE users"), "select");
        assert_eq!(classify_query_kind("DESC users"), "select");
        assert_eq!(classify_query_kind("PRAGMA table_info(t)"), "select");
        assert_eq!(classify_query_kind("VALUES (1), (2)"), "select");
    }

    #[test]
    fn classify_write() {
        assert_eq!(classify_query_kind("INSERT INTO t VALUES (1)"), "write");
        assert_eq!(classify_query_kind("UPDATE t SET x = 1"), "write");
        assert_eq!(classify_query_kind("DELETE FROM t"), "write");
        assert_eq!(classify_query_kind("MERGE INTO t USING s ON ..."), "write");
        assert_eq!(classify_query_kind("REPLACE INTO t VALUES (1)"), "write");
    }

    #[test]
    fn classify_ddl() {
        assert_eq!(classify_query_kind("CREATE TABLE t (id INT)"), "ddl");
        assert_eq!(
            classify_query_kind(
                "CREATE PROCEDURE tabularis_fix_test_proc()\n\
                 BEGIN\n\
                   SELECT 1 AS ok;\n\
                 END"
            ),
            "ddl"
        );
        assert_eq!(
            classify_query_kind(
                "CREATE FUNCTION tabularis_fix_test_fn() RETURNS INT\n\
                 BEGIN\n\
                   RETURN 1;\n\
                 END;"
            ),
            "ddl"
        );
        assert_eq!(
            classify_query_kind(
                "CREATE TRIGGER tabularis_fix_test_trigger BEFORE INSERT ON t\n\
                 FOR EACH ROW\n\
                 BEGIN\n\
                   SET NEW.id = NEW.id;\n\
                 END;"
            ),
            "ddl"
        );
        assert_eq!(
            classify_query_kind(
                "CREATE EVENT tabularis_fix_test_event\n\
                 ON SCHEDULE EVERY 1 DAY\n\
                 DO\n\
                 BEGIN\n\
                   SELECT 1;\n\
                 END;"
            ),
            "ddl"
        );
        assert_eq!(
            classify_query_kind(
                "CREATE PROCEDURE tabularis_fix_test_proc()\n\
                 BEGIN\n\
                   SELECT 1;\n\
                 END; DROP TABLE t"
            ),
            "unknown"
        );
        assert_eq!(
            classify_query_kind(
                "CREATE PROCEDURE tabularis_fix_test_proc()\n\
                 BEGIN\n\
                   SELECT 1;\n\
                 END; DROP TABLE t; END"
            ),
            "unknown"
        );
        assert_eq!(
            classify_query_kind(
                "CREATE PROCEDURE tabularis_fix_test_proc()\n\
                 BEGIN\n\
                   SELECT 1;\n\
                 END;; DROP TABLE t; END"
            ),
            "unknown"
        );
        assert_eq!(classify_query_kind("DROP TABLE t"), "ddl");
        assert_eq!(classify_query_kind("ALTER TABLE t ADD COLUMN x INT"), "ddl");
        assert_eq!(classify_query_kind("TRUNCATE t"), "ddl");
        assert_eq!(classify_query_kind("RENAME TABLE a TO b"), "ddl");
        assert_eq!(classify_query_kind("GRANT SELECT ON t TO user"), "ddl");
        assert_eq!(classify_query_kind("REVOKE SELECT ON t FROM user"), "ddl");
        assert_eq!(classify_query_kind("COMMENT ON TABLE t IS 'x'"), "ddl");
    }

    #[test]
    fn classify_unknown_for_empty_or_garbage() {
        assert_eq!(classify_query_kind(""), "unknown");
        assert_eq!(classify_query_kind("   "), "unknown");
        assert_eq!(classify_query_kind("-- only comment"), "unknown");
        assert_eq!(classify_query_kind("/* just a comment */"), "unknown");
        assert_eq!(classify_query_kind("EXEC sp_helpdb"), "unknown");
        assert_eq!(classify_query_kind("VACUUM"), "unknown");
        assert_eq!(classify_query_kind("BEGIN"), "unknown");
    }

    #[test]
    fn classify_cte_with_select() {
        assert_eq!(
            classify_query_kind("WITH u AS (SELECT 1) SELECT * FROM u"),
            "select"
        );
    }

    #[test]
    fn classify_cte_with_update_is_write() {
        assert_eq!(
            classify_query_kind(
                "WITH x AS (SELECT id FROM o) UPDATE orders SET status = 'x' FROM x"
            ),
            "write"
        );
    }

    #[test]
    fn classify_cte_with_delete_is_write() {
        assert_eq!(
            classify_query_kind("WITH x AS (SELECT 1) DELETE FROM o WHERE id IN x"),
            "write"
        );
    }

    #[test]
    fn classify_cte_with_create_is_ddl() {
        assert_eq!(
            classify_query_kind("WITH t AS (SELECT 1) CREATE TABLE x AS SELECT * FROM t"),
            "ddl"
        );
    }

    // -----------------------------------------------------------------------
    // Parenthesized query expressions. A `(SELECT ...) UNION ALL (SELECT ...)`
    // starts with `(`, so the first keyword would come back empty and fall
    // through to "unknown" — needlessly tripping the read-only / approval
    // gates for a pure read. The leading `(` (and whitespace) must be peeled
    // before reading the first keyword.
    // -----------------------------------------------------------------------

    #[test]
    fn classify_parenthesized_union_all_is_select() {
        assert_eq!(
            classify_query_kind(
                "(SELECT 'a' AS kw, content FROM t WHERE id IN (1, 2) ORDER BY id LIMIT 8) \
                 UNION ALL \
                 (SELECT 'b' AS kw, content FROM t WHERE id IN (3, 4) ORDER BY id LIMIT 8)"
            ),
            "select"
        );
    }

    #[test]
    fn classify_parenthesized_select_with_whitespace_is_select() {
        assert_eq!(classify_query_kind("(  SELECT 1 )"), "select");
        assert_eq!(classify_query_kind("( ( SELECT 1 ) )"), "select");
    }

    #[test]
    fn classify_parenthesized_then_drop_is_unknown() {
        // Peeling the leading `(` must not weaken multi-statement detection:
        // an injected trailing statement still fails closed.
        assert_eq!(
            classify_query_kind("(SELECT 1); DROP TABLE users"),
            "unknown"
        );
    }

    #[test]
    fn classify_empty_or_whitespace_parens_is_unknown() {
        // Peeling all leading `(` and whitespace can leave no keyword at all;
        // the classifier must fail closed rather than guess "select".
        assert_eq!(classify_query_kind("()"), "unknown");
        assert_eq!(classify_query_kind("(   )"), "unknown");
        assert_eq!(classify_query_kind("((()))"), "unknown");
    }

    #[test]
    fn classify_parenthesized_write_or_ddl_is_not_downgraded() {
        // The peel is greedy, but the inner keyword still drives the result:
        // a parenthesized write/DDL must never be downgraded to "select", or
        // the read-only and approval gates would let it through.
        assert_eq!(classify_query_kind("( DROP TABLE t )"), "ddl");
        assert_eq!(classify_query_kind("( DELETE FROM users )"), "write");
    }

    #[test]
    fn classify_parenthesized_cte_with_insert_is_write() {
        // classify_cte scans the whole body, not just the start, so a CTE
        // wrapped in parens whose tail writes is still classified "write".
        assert_eq!(
            classify_query_kind("(WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x)"),
            "write"
        );
    }

    #[test]
    fn classify_handles_leading_comment_then_select() {
        assert_eq!(
            classify_query_kind("-- audit\nSELECT 1"),
            "select"
        );
    }

    #[test]
    fn classify_keyword_in_string_literal_not_misread() {
        // The literal mentions DELETE but the query is a SELECT.
        assert_eq!(
            classify_query_kind("SELECT 'DELETE FROM users' AS msg"),
            "select"
        );
    }

    #[test]
    fn classify_keyword_in_quoted_identifier_not_misread() {
        assert_eq!(classify_query_kind("SELECT \"DROP\" FROM t"), "select");
        assert_eq!(classify_query_kind("SELECT `DELETE` FROM t"), "select");
    }

    #[test]
    fn classify_is_case_insensitive() {
        assert_eq!(classify_query_kind("Select 1"), "select");
        assert_eq!(classify_query_kind("update t set a = 1"), "write");
    }

    #[test]
    fn classify_word_boundary_avoids_false_positive() {
        // CREATETABLE shouldn't match CREATE; it's gibberish.
        assert_eq!(classify_query_kind("WITH x AS (SELECT createtable FROM y) SELECT * FROM x"), "select");
    }

    // -----------------------------------------------------------------------
    // Multi-statement payloads must NOT be tagged as a clean select just
    // because the leading keyword is SELECT. The read-only / approval gates
    // rely on `kind != "select"` to fail closed.
    // -----------------------------------------------------------------------

    #[test]
    fn classify_select_then_drop_is_unknown() {
        assert_eq!(
            classify_query_kind("SELECT 1; DROP TABLE users;"),
            "unknown"
        );
    }

    #[test]
    fn classify_select_then_delete_is_unknown() {
        assert_eq!(
            classify_query_kind("SELECT * FROM t; DELETE FROM t WHERE id = 1"),
            "unknown"
        );
    }

    #[test]
    fn classify_select_then_update_is_unknown() {
        assert_eq!(
            classify_query_kind("SELECT 1;\nUPDATE accounts SET balance = 0"),
            "unknown"
        );
    }

    #[test]
    fn classify_trailing_semicolon_keeps_kind() {
        // A single statement with a trailing `;` is still that kind — the
        // multi-statement gate only fires when content follows the semicolon.
        assert_eq!(classify_query_kind("SELECT 1;"), "select");
        assert_eq!(classify_query_kind("UPDATE t SET x = 1;"), "write");
        assert_eq!(classify_query_kind("DROP TABLE t;  "), "ddl");
    }

    #[test]
    fn classify_semicolon_inside_string_is_single_statement() {
        // Semicolons inside literals are stripped before scanning, so the
        // query is still a clean SELECT.
        assert_eq!(
            classify_query_kind("SELECT ';DROP TABLE users;' FROM dual"),
            "select"
        );
    }

    #[test]
    fn classify_semicolon_inside_comment_is_single_statement() {
        assert_eq!(
            classify_query_kind("SELECT 1 /* ; DROP TABLE u */ FROM dual"),
            "select"
        );
        assert_eq!(
            classify_query_kind("SELECT 1 -- ; DROP TABLE u\nFROM dual"),
            "select"
        );
    }

    #[test]
    fn classify_mysql_backslash_escape_cannot_hide_separator() {
        // MySQL/MariaDB read `'\''` as the one-character string `'`, so the
        // `;` that follows is a real statement separator. Under the SQL-
        // standard reading the `''` would be an escaped quote and the `;`
        // would stay inside the string. We fail closed to the multi-statement
        // interpretation so neither dialect can smuggle a write past the gate.
        assert_eq!(
            classify_query_kind("SELECT '\\''; DROP TABLE users"),
            "unknown"
        );
        assert_eq!(
            classify_query_kind("SELECT '\\'; DELETE FROM accounts"),
            "unknown"
        );
    }

    #[test]
    fn classify_escaped_quote_boundary_is_single_statement() {
        // `''` is a real escaped quote here, so the `;` lives inside the
        // literal and the query stays a clean SELECT under both readings.
        assert_eq!(
            classify_query_kind("SELECT 'it''s; DROP' FROM dual"),
            "select"
        );
    }

    // -----------------------------------------------------------------------
    // Session state / compute_or_rotate_session_id
    // -----------------------------------------------------------------------

    #[test]
    fn compute_session_id_first_call_creates_state() {
        let tmp = TempDir::new().unwrap();
        assert!(load_session_state_in(tmp.path()).is_none());
        let id = compute_or_rotate_session_id_in(tmp.path(), 10);
        assert!(!id.is_empty());
        let state = load_session_state_in(tmp.path()).unwrap();
        assert_eq!(state.session_id, id);
    }

    #[test]
    fn compute_session_id_within_gap_keeps_same() {
        let tmp = TempDir::new().unwrap();
        let id1 = compute_or_rotate_session_id_in(tmp.path(), 60);
        let id2 = compute_or_rotate_session_id_in(tmp.path(), 60);
        assert_eq!(id1, id2);
    }

    #[test]
    fn compute_session_id_over_gap_rotates() {
        let tmp = TempDir::new().unwrap();
        // Seed a state with last_activity 1 hour ago.
        let one_hour_ago = (chrono::Utc::now() - chrono::Duration::hours(1)).to_rfc3339();
        save_session_state_in(
            tmp.path(),
            &SessionState {
                session_id: "old-id".into(),
                last_activity_at: one_hour_ago,
                client_hint: None,
            },
        )
        .unwrap();
        let id = compute_or_rotate_session_id_in(tmp.path(), 10);
        assert_ne!(id, "old-id");
    }

    #[test]
    fn compute_session_id_corrupt_state_starts_fresh() {
        let tmp = TempDir::new().unwrap();
        std::fs::write(
            tmp.path().join(".mcp_session_state.json"),
            "not-valid-json",
        )
        .unwrap();
        let id = compute_or_rotate_session_id_in(tmp.path(), 10);
        assert!(!id.is_empty());
    }

    #[test]
    fn set_client_hint_persists_to_state() {
        let tmp = TempDir::new().unwrap();
        compute_or_rotate_session_id_in(tmp.path(), 10);
        set_client_hint_in(tmp.path(), Some("cursor".into()));
        let state = load_session_state_in(tmp.path()).unwrap();
        assert_eq!(state.client_hint.as_deref(), Some("cursor"));
    }

    #[test]
    fn set_client_hint_creates_state_if_missing() {
        let tmp = TempDir::new().unwrap();
        set_client_hint_in(tmp.path(), Some("windsurf".into()));
        let state = load_session_state_in(tmp.path()).unwrap();
        assert_eq!(state.client_hint.as_deref(), Some("windsurf"));
        assert!(!state.session_id.is_empty());
    }

    #[test]
    fn to_local_rfc3339_preserves_the_instant() {
        // The output is the same point in time as the input, regardless of the
        // machine's timezone — so we compare instants, not literal strings.
        let input = "2026-04-24T10:00:00Z";
        let out = to_local_rfc3339(input, None);
        let in_instant = chrono::DateTime::parse_from_rfc3339(input).unwrap();
        let out_instant = chrono::DateTime::parse_from_rfc3339(&out).unwrap();
        assert_eq!(in_instant, out_instant);
    }

    #[test]
    fn to_local_rfc3339_uses_an_explicit_iana_timezone() {
        // Asia/Tokyo is UTC+9 with no DST, so this is fully deterministic
        // regardless of the machine timezone.
        let out = to_local_rfc3339("2026-04-24T10:00:00Z", Some("Asia/Tokyo"));
        assert_eq!(out, "2026-04-24T19:00:00+09:00");
    }

    #[test]
    fn to_local_rfc3339_falls_back_to_local_for_auto_or_unknown_zone() {
        let input = "2026-04-24T10:00:00Z";
        let in_instant = chrono::DateTime::parse_from_rfc3339(input).unwrap();
        for tz in [Some("auto"), Some("Not/AZone"), Some(""), None] {
            let out = to_local_rfc3339(input, tz);
            let out_instant = chrono::DateTime::parse_from_rfc3339(&out).unwrap();
            assert_eq!(in_instant, out_instant, "tz={:?} should preserve instant", tz);
        }
    }

    #[test]
    fn to_local_rfc3339_returns_input_when_unparseable() {
        assert_eq!(to_local_rfc3339("not-a-date", Some("Asia/Tokyo")), "not-a-date");
    }
}
