#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use tempfile::TempDir;

    use crate::connection_migrations::{
        connections_file_changed_concurrently, migrate_connection_ssl_mode_in_place,
        migrate_postgres_ssl_mode_spelling_at_path, stale_postgres_ssl_mode_replacement,
    };
    use crate::drivers::driver_trait::SqlDialect;
    use crate::models::{ConnectionParams, ConnectionsFile, DatabaseSelection, SavedConnection};
    use crate::persistence;

    fn base_params() -> ConnectionParams {
        ConnectionParams {
            driver: "mysql".to_string(),
            host: Some("localhost".to_string()),
            port: Some(3306),
            username: Some("root".to_string()),
            database: DatabaseSelection::Single("testdb".to_string()),
            ..Default::default()
        }
    }

    fn saved_connection(driver: &str, ssl_mode: Option<&str>) -> SavedConnection {
        SavedConnection {
            id: "conn-1".to_string(),
            name: "test".to_string(),
            params: ConnectionParams {
                driver: driver.to_string(),
                ssl_mode: ssl_mode.map(str::to_string),
                ..base_params()
            },
            group_id: None,
            sort_order: None,
            detect_json_in_text_columns: None,
            appearance: None,
            tag_ids: None,
            environment: None,
            shared: None,
        }
    }

    #[test]
    fn stale_postgres_ssl_mode_replacement_maps_every_mysql_style_value() {
        assert_eq!(
            stale_postgres_ssl_mode_replacement("disabled"),
            Some("disable")
        );
        assert_eq!(
            stale_postgres_ssl_mode_replacement("preferred"),
            Some("prefer")
        );
        assert_eq!(
            stale_postgres_ssl_mode_replacement("required"),
            Some("require")
        );
        assert_eq!(
            stale_postgres_ssl_mode_replacement("verify_ca"),
            Some("verify-ca")
        );
        assert_eq!(
            stale_postgres_ssl_mode_replacement("verify_identity"),
            Some("verify-full"),
        );
    }

    #[test]
    fn stale_postgres_ssl_mode_replacement_leaves_already_correct_values_alone() {
        for already_correct in [
            "disable",
            "allow",
            "prefer",
            "require",
            "verify-ca",
            "verify-full",
        ] {
            assert_eq!(
                stale_postgres_ssl_mode_replacement(already_correct),
                None,
                "{already_correct} should not be rewritten",
            );
        }
    }

    #[test]
    fn stale_postgres_ssl_mode_replacement_ignores_unrecognized_values() {
        assert_eq!(stale_postgres_ssl_mode_replacement(""), None);
        assert_eq!(stale_postgres_ssl_mode_replacement("not-a-real-mode"), None);
    }

    #[test]
    fn migrate_connection_ssl_mode_rewrites_a_plugin_postgres_connection() {
        let mut dialects = HashMap::new();
        dialects.insert("postgresql".to_string(), Some(SqlDialect::Postgres));
        let mut conn = saved_connection("postgresql", Some("required"));

        let rewrote = migrate_connection_ssl_mode_in_place(&mut conn, &dialects);

        assert!(rewrote);
        assert_eq!(conn.params.ssl_mode.as_deref(), Some("require"));
    }

    #[test]
    fn migrate_connection_ssl_mode_leaves_a_mysql_connection_alone() {
        // "required" is the CORRECT spelling for mysql — this is the case
        // that makes the migration driver-aware rather than a blanket
        // string-remap. A dialect map that (incorrectly) resolved mysql to
        // Postgres would also demonstrate the bug this guards against, so
        // this test exercises the real decision, not just the dialect map.
        let mut dialects = HashMap::new();
        dialects.insert("mysql".to_string(), Some(SqlDialect::Mysql));
        let mut conn = saved_connection("mysql", Some("required"));

        let rewrote = migrate_connection_ssl_mode_in_place(&mut conn, &dialects);

        assert!(!rewrote);
        assert_eq!(conn.params.ssl_mode.as_deref(), Some("required"));
    }

    #[test]
    fn migrate_connection_ssl_mode_leaves_the_builtin_postgres_driver_alone() {
        // The builtin driver's own dropdown was always correct — even if it
        // somehow ended up with a stale value, this migration is scoped to
        // plugin-driven connections only (driver id != "postgres").
        let mut dialects = HashMap::new();
        dialects.insert("postgres".to_string(), Some(SqlDialect::Postgres));
        let mut conn = saved_connection("postgres", Some("required"));

        let rewrote = migrate_connection_ssl_mode_in_place(&mut conn, &dialects);

        assert!(!rewrote);
        assert_eq!(conn.params.ssl_mode.as_deref(), Some("required"));
    }

    #[test]
    fn migrate_connection_ssl_mode_leaves_an_unresolved_driver_alone() {
        // No entry in `dialects` (e.g. the driver failed to resolve from the
        // registry) must not be treated as postgres-dialect by default.
        let dialects = HashMap::new();
        let mut conn = saved_connection("postgresql", Some("required"));

        let rewrote = migrate_connection_ssl_mode_in_place(&mut conn, &dialects);

        assert!(!rewrote);
        assert_eq!(conn.params.ssl_mode.as_deref(), Some("required"));
    }

    #[test]
    fn migrate_connection_ssl_mode_leaves_a_resolved_driver_with_no_declared_dialect_alone() {
        // A driver that resolves from the registry but whose manifest omits
        // `sql_dialect` entirely (e.g. the Oracle plugin, which sets
        // supports_ssl but declares no dialect) must be treated as NOT
        // postgres-dialect — `None`, not defaulted to `Some(Postgres)`.
        // Getting this wrong would rewrite that driver's legitimately-spelled
        // SSL value based on a guess, exactly the bug this test guards
        // against.
        let mut dialects = HashMap::new();
        dialects.insert("oracle".to_string(), None);
        let mut conn = saved_connection("oracle", Some("required"));

        let rewrote = migrate_connection_ssl_mode_in_place(&mut conn, &dialects);

        assert!(!rewrote);
        assert_eq!(conn.params.ssl_mode.as_deref(), Some("required"));
    }

    #[test]
    fn migrate_connection_ssl_mode_is_idempotent() {
        let mut dialects = HashMap::new();
        dialects.insert("postgresql".to_string(), Some(SqlDialect::Postgres));
        let mut conn = saved_connection("postgresql", Some("required"));

        assert!(migrate_connection_ssl_mode_in_place(&mut conn, &dialects));
        assert_eq!(conn.params.ssl_mode.as_deref(), Some("require"));
        // Second pass: the value is already correct, nothing to rewrite.
        assert!(!migrate_connection_ssl_mode_in_place(&mut conn, &dialects));
        assert_eq!(conn.params.ssl_mode.as_deref(), Some("require"));
    }

    #[test]
    fn connections_file_changed_concurrently_detects_any_byte_difference() {
        assert!(!connections_file_changed_concurrently("{}", "{}"));
        assert!(connections_file_changed_concurrently("{}", "{ }"));
        assert!(connections_file_changed_concurrently("", "{}"));
    }

    // --- migrate_postgres_ssl_mode_spelling_at_path: path-based core ---
    //
    // These exercise only the two no-op paths (missing file; a file whose
    // one connection is builtin "postgres", always skipped) without a
    // registered driver — the dialect-resolution decision itself is already
    // fully covered above by migrate_connection_ssl_mode_in_place's tests,
    // which take a `dialects` map directly.
    //
    // NOT covered here: the actual rewrite-and-save success path (Ok(true))
    // and the concurrent-change skip branch inside this function. Both
    // require a driver registered under a non-"postgres" id resolving to
    // Postgres dialect, which needs either a live plugin process or a full
    // DatabaseDriver mock (62 required methods, only 5 with default bodies)
    // — judged disproportionate for this test. The pure concurrency-guard
    // logic itself (`connections_file_changed_concurrently`) is fully
    // covered above in isolation.

    #[tokio::test]
    async fn migrate_postgres_ssl_mode_spelling_at_path_is_a_noop_for_a_missing_file() {
        let dir = TempDir::new().expect("create temp dir");
        let path = dir.path().join("connections.json");

        let migrated = migrate_postgres_ssl_mode_spelling_at_path(&path)
            .await
            .expect("missing file is not an error");

        assert!(!migrated);
    }

    #[tokio::test]
    async fn migrate_postgres_ssl_mode_spelling_at_path_is_a_noop_when_nothing_needs_migrating() {
        let dir = TempDir::new().expect("create temp dir");
        let path = dir.path().join("connections.json");
        let file = ConnectionsFile {
            groups: Vec::new(),
            // Builtin "postgres" is always skipped, regardless of ssl_mode.
            connections: vec![saved_connection("postgres", Some("required"))],
            tags: Vec::new(),
        };
        persistence::save_connections_file(&path, &file).expect("seed fixture");
        let content_before = std::fs::read_to_string(&path).expect("read fixture");

        let migrated = migrate_postgres_ssl_mode_spelling_at_path(&path)
            .await
            .expect("no migration needed is not an error");

        assert!(!migrated);
        let content_after = std::fs::read_to_string(&path).expect("read after");
        assert_eq!(
            content_before, content_after,
            "a no-op run must not rewrite the file at all"
        );
    }
}
