use super::*;

#[test]
fn connection_mode_overrides_every_global_mode_for_every_query_kind() {
    use McpApprovalMode::{All, Off, WritesOnly};
    use QueryApproval::{Disabled, ProtectedRead, Required};

    let queries = [
        ("SELECT 1", "select"),
        ("INSERT INTO items VALUES (1)", "write"),
        ("UPDATE items SET id = 2", "write"),
        ("DELETE FROM items", "write"),
        ("CREATE TABLE items (id INT)", "ddl"),
        ("SELECT 1; DELETE FROM items", "unknown"),
        ("SELECT 1; SELECT 2", "unknown"),
        ("", "unknown"),
    ];

    for (global, inherited) in [
        (None, WritesOnly),
        (Some("writes_only"), WritesOnly),
        (Some("all"), All),
        (Some("off"), Off),
        (Some("old_invalid_value"), WritesOnly),
    ] {
        for connection in [None, Some(All), Some(WritesOnly), Some(Off)] {
            for (sql, expected_kind) in queries {
                let kind = crate::ai_activity::classify_query_kind(sql);
                assert_eq!(kind, expected_kind, "{sql}");
                let expected = match (connection.unwrap_or(inherited), expected_kind) {
                    (Off, _) => Disabled,
                    (WritesOnly, "select") => ProtectedRead,
                    _ => Required,
                };
                assert_eq!(
                    query_approval(global, connection, kind),
                    expected,
                    "{global:?}, {connection:?}, {sql}"
                );
            }
        }
    }
}
