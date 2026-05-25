#[cfg(test)]
mod tests {
    use crate::ai_activity::{append_event_in, AiActivityEvent};
    use crate::ai_notebook_export::{derive_cell_name, export_session_in};
    use std::path::Path;
    use tempfile::TempDir;

    fn ev(
        id: &str,
        sess: &str,
        tool: &str,
        ts: &str,
        query: Option<&str>,
        conn_name: &str,
    ) -> AiActivityEvent {
        AiActivityEvent {
            id: id.to_string(),
            session_id: sess.to_string(),
            timestamp: ts.to_string(),
            tool: tool.to_string(),
            connection_id: Some("c1".to_string()),
            connection_name: Some(conn_name.to_string()),
            query: query.map(|s| s.to_string()),
            query_kind: query.map(|_| "select".to_string()),
            duration_ms: 1,
            status: "success".to_string(),
            rows: Some(0),
            error: None,
            client_hint: Some("claude-desktop".to_string()),
            approval_id: None,
        }
    }

    fn append(dir: &Path, e: AiActivityEvent) {
        append_event_in(dir, &e).unwrap();
    }

    #[test]
    fn export_single_query_session() {
        let tmp = TempDir::new().unwrap();
        append(
            tmp.path(),
            ev(
                "1",
                "s",
                "run_query",
                "2026-04-24T10:00:00Z",
                Some("SELECT 1"),
                "dev",
            ),
        );
        let nb = export_session_in(tmp.path(), "s", None).unwrap();
        // 1 header + 1 SQL cell.
        assert_eq!(nb.cells.len(), 2);
        assert_eq!(nb.cells[0].cell_type, "markdown");
        assert!(nb.cells[0].content.contains("AI Session s"));
        assert_eq!(nb.cells[1].cell_type, "sql");
        assert_eq!(nb.cells[1].content, "SELECT 1");
        assert_eq!(nb.cells[1].schema.as_deref(), Some("dev"));
    }

    #[test]
    fn header_renders_started_ended_in_requested_timezone() {
        let tmp = TempDir::new().unwrap();
        append(
            tmp.path(),
            ev(
                "1",
                "s",
                "run_query",
                "2026-04-24T10:00:00Z",
                Some("SELECT 1"),
                "dev",
            ),
        );
        // Asia/Tokyo is UTC+9 (no DST): 10:00Z renders as 19:00 local.
        let nb = export_session_in(tmp.path(), "s", Some("Asia/Tokyo")).unwrap();
        let header = &nb.cells[0].content;
        assert!(
            header.contains("2026-04-24T19:00:00+09:00"),
            "header should show Tokyo-local time, got:\n{header}"
        );
    }

    #[test]
    fn export_mixed_tools_creates_markdown_for_describe() {
        let tmp = TempDir::new().unwrap();
        append(
            tmp.path(),
            ev("1", "s", "list_tables", "2026-04-24T10:00:00Z", None, "dev"),
        );
        append(
            tmp.path(),
            ev(
                "2",
                "s",
                "describe_table",
                "2026-04-24T10:00:01Z",
                None,
                "dev",
            ),
        );
        append(
            tmp.path(),
            ev(
                "3",
                "s",
                "run_query",
                "2026-04-24T10:00:02Z",
                Some("SELECT 1"),
                "dev",
            ),
        );
        let nb = export_session_in(tmp.path(), "s", None).unwrap();
        // header + list_tables md + describe_table md + sql cell.
        assert_eq!(nb.cells.len(), 4);
        assert_eq!(nb.cells[1].cell_type, "markdown");
        assert!(nb.cells[1].content.contains("list_tables"));
        assert_eq!(nb.cells[2].cell_type, "markdown");
        assert!(nb.cells[2].content.contains("describe_table"));
        assert_eq!(nb.cells[3].cell_type, "sql");
    }

    #[test]
    fn export_unknown_session_returns_error() {
        let tmp = TempDir::new().unwrap();
        let err = export_session_in(tmp.path(), "missing", None).unwrap_err();
        assert!(err.contains("missing"));
    }

    #[test]
    fn export_orders_cells_chronologically() {
        let tmp = TempDir::new().unwrap();
        append(
            tmp.path(),
            ev(
                "later",
                "s",
                "run_query",
                "2026-04-24T10:00:02Z",
                Some("SELECT 2"),
                "dev",
            ),
        );
        append(
            tmp.path(),
            ev(
                "earlier",
                "s",
                "run_query",
                "2026-04-24T10:00:01Z",
                Some("SELECT 1"),
                "dev",
            ),
        );
        let nb = export_session_in(tmp.path(), "s", None).unwrap();
        // Skip header at index 0.
        assert_eq!(nb.cells[1].content, "SELECT 1");
        assert_eq!(nb.cells[2].content, "SELECT 2");
    }

    #[test]
    fn cell_name_uses_first_comment() {
        assert_eq!(
            derive_cell_name("-- top customers\nSELECT * FROM users", 1),
            "top customers"
        );
    }

    #[test]
    fn cell_name_falls_back_to_index_when_no_comment() {
        assert_eq!(derive_cell_name("SELECT 1", 7), "Query 7");
    }

    #[test]
    fn cell_name_truncates_long_comments() {
        let long = "x".repeat(200);
        let q = format!("-- {}", long);
        let name = derive_cell_name(&q, 1);
        // 60 chars + ellipsis.
        assert!(name.chars().count() <= 61);
        assert!(name.ends_with('…'));
    }

    #[test]
    fn cell_name_skips_blank_lines_before_comment() {
        assert_eq!(
            derive_cell_name("\n\n-- daily totals\nSELECT 1", 1),
            "daily totals"
        );
    }

    #[test]
    fn cell_name_does_not_use_inline_comment_after_sql() {
        assert_eq!(
            derive_cell_name("SELECT 1 -- not a name", 4),
            "Query 4"
        );
    }

    #[test]
    fn header_lists_distinct_connection_names() {
        let tmp = TempDir::new().unwrap();
        append(
            tmp.path(),
            ev(
                "1",
                "s",
                "run_query",
                "2026-04-24T10:00:00Z",
                Some("SELECT 1"),
                "dev",
            ),
        );
        append(
            tmp.path(),
            ev(
                "2",
                "s",
                "run_query",
                "2026-04-24T10:00:01Z",
                Some("SELECT 2"),
                "staging",
            ),
        );
        append(
            tmp.path(),
            ev(
                "3",
                "s",
                "run_query",
                "2026-04-24T10:00:02Z",
                Some("SELECT 3"),
                "dev",
            ),
        );
        let nb = export_session_in(tmp.path(), "s", None).unwrap();
        assert!(nb.cells[0].content.contains("dev, staging"));
    }
}
