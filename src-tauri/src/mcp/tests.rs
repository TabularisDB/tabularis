//! Dispatch-level tests for MCP tool discovery, argument validation, and
//! connection-resolution error paths.

use super::*;
use crate::models::DatabaseSelection;
use serde_json::{json, Map, Value};

#[test]
fn every_tool_advertises_optional_json_or_toon_output() {
    let result =
        handle_list_tools(&AppConfig::default()).expect("tool discovery should succeed");
    let tools = result["tools"].as_array().expect("tools must be an array");

    assert_eq!(tools.len(), 5);
    for tool in tools {
        let output_format = &tool["inputSchema"]["properties"]["output_format"];
        assert_eq!(output_format["type"], "string");
        assert_eq!(output_format["enum"], json!(["json", "toon"]));
        assert_eq!(output_format["default"], "json");
        assert!(tool["inputSchema"]["required"]
            .as_array()
            .map_or(true, |required| !required
                .iter()
                .any(|name| name == "output_format")));
    }
}

#[tokio::test]
async fn invalid_output_format_fails_before_tool_execution() {
    let config = AppConfig::default();
    let mut audit = CallAudit::for_tool("run_query");
    let args = json!({
        "connection_id": "does-not-matter",
        "query": "SELECT 1",
        "output_format": "xml"
    });
    let err = dispatch_tool(
        "run_query",
        args.as_object(),
        &config,
        "test-session",
        &mut audit,
    )
    .await
    .expect_err("unsupported output formats must be rejected");

    assert_eq!(err.code, -32602);
    assert_eq!(
        err.message,
        "Invalid output_format: expected 'json' or 'toon'"
    );
    assert_eq!(audit.connection_id, None);
}

#[test]
fn tool_schema_advertises_configured_output_preference() {
    let config = AppConfig {
        mcp_output_format: Some("toon".to_string()),
        ..AppConfig::default()
    };
    let result = handle_list_tools(&config).expect("tool discovery should succeed");

    for tool in result["tools"].as_array().unwrap() {
        assert_eq!(
            tool["inputSchema"]["properties"]["output_format"]["default"],
            "toon"
        );
    }
}

#[test]
fn call_argument_overrides_app_output_preference() {
    let config = AppConfig {
        mcp_output_format: Some("toon".to_string()),
        ..AppConfig::default()
    };
    let args = serde_json::from_value::<serde_json::Map<String, Value>>(json!({
        "output_format": "json"
    }))
    .unwrap();

    assert_eq!(
        requested_output_format(Some(&args), &config).unwrap(),
        ToolOutputFormat::Json
    );
}

/// `list_databases` with no arguments object should surface the JSON-RPC
/// "Missing arguments" error (-32602) before any connection lookup happens.
#[tokio::test]
async fn list_databases_missing_arguments_errors() {
    let config = AppConfig::default();
    let mut audit = CallAudit::for_tool("list_databases");
    let err = dispatch_tool("list_databases", None, &config, "test-session", &mut audit)
        .await
        .expect_err("expected an error when arguments are missing");
    assert_eq!(err.code, -32602);
    assert_eq!(err.message, "Missing arguments");
}

/// `list_databases` with an arguments object that omits `connection_id`
/// should surface the "Missing connection_id" error (-32602).
#[tokio::test]
async fn list_databases_missing_connection_id_errors() {
    let config = AppConfig::default();
    let mut audit = CallAudit::for_tool("list_databases");
    let args: Map<String, Value> = Map::new();
    let err = dispatch_tool(
        "list_databases",
        Some(&args),
        &config,
        "test-session",
        &mut audit,
    )
    .await
    .expect_err("expected an error when connection_id is missing");
    assert_eq!(err.code, -32602);
    assert_eq!(err.message, "Missing connection_id");
}

/// `list_databases` pointed at a connection that does not exist should surface
/// the -32000 "Connection not found" error from resolution, and still record
/// the attempted connection id on the audit trail.
#[tokio::test]
async fn list_databases_unknown_connection_errors() {
    let config = AppConfig::default();
    let mut audit = CallAudit::for_tool("list_databases");
    let mut args: Map<String, Value> = Map::new();
    args.insert(
        "connection_id".to_string(),
        json!("__tabularis_nonexistent_mcp_test_connection__"),
    );
    let err = dispatch_tool(
        "list_databases",
        Some(&args),
        &config,
        "test-session",
        &mut audit,
    )
    .await
    .expect_err("expected an error for an unknown connection");
    assert_eq!(err.code, -32000);
    assert!(
        err.message.contains("Connection not found"),
        "unexpected error message: {}",
        err.message
    );
    assert_eq!(
        audit.connection_id.as_deref(),
        Some("__tabularis_nonexistent_mcp_test_connection__")
    );
}

/// `resolve_default_schema` (issue #614): the schema default used to key off
/// `driver == "postgres"` literally, so a postgres-compatible driver
/// registered under a different id (e.g. the standalone PostgreSQL plugin)
/// never got the `"public"` default. Exercised against the real concrete
/// driver types — not a mock — so a manifest change on any of them would
/// actually be caught here.
#[test]
fn resolve_default_schema_defaults_postgres_to_public() {
    let driver: Arc<dyn DatabaseDriver> = Arc::new(postgres::PostgresDriver::new());
    assert_eq!(resolve_default_schema(&driver, None), Some("public"));
}

#[test]
fn resolve_default_schema_prefers_a_caller_supplied_schema_on_postgres() {
    let driver: Arc<dyn DatabaseDriver> = Arc::new(postgres::PostgresDriver::new());
    assert_eq!(
        resolve_default_schema(&driver, Some("analytics")),
        Some("analytics"),
    );
}

#[test]
fn resolve_default_schema_passes_through_unchanged_on_non_postgres_drivers() {
    let mysql: Arc<dyn DatabaseDriver> = Arc::new(mysql::MysqlDriver::new());
    assert_eq!(resolve_default_schema(&mysql, None), None);
    assert_eq!(
        resolve_default_schema(&mysql, Some("whatever")),
        Some("whatever"),
    );

    let sqlite: Arc<dyn DatabaseDriver> = Arc::new(sqlite::SqliteDriver::new());
    assert_eq!(resolve_default_schema(&sqlite, None), None);
}

/// `resolve_driver_for_params` used to treat any `Err` from
/// `get_connection_driver` as a registry miss, including a `for_connection`
/// failure on a driver that *is* registered (e.g. a `get_connection_metadata`
/// RPC error). That triggered a pointless plugin rescan and repeated the
/// same failing RPC call. It should instead recognize the driver is
/// registered and surface the error straight away.
#[tokio::test]
async fn resolve_driver_for_params_does_not_retry_on_a_registered_drivers_own_failure() {
    // Registers into the process-global driver registry — hold the same lock
    // `drivers::registry`'s own tests use for that, so a concurrently-running
    // `reconcile_active_drivers` test elsewhere can't sweep this driver away
    // mid-test (it removes anything absent from its allowlist by design).
    let _guard = driver_registry::REGISTRY_TEST_LOCK.lock().await;
    let driver_id = "test-mcp-issue784-for-connection-failure";
    let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let calls_for_driver = calls.clone();
    let driver = plugins::driver::with_test_driver_id(
        plugins::driver::test_driver_result(move |_request| {
            calls_for_driver.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Err("simulated connection metadata discovery failure".to_string())
        })
        .with_connection_metadata(true),
        driver_id,
    );
    driver_registry::register_driver(driver).await;

    let db_params = ConnectionParams {
        driver: driver_id.to_string(),
        ..Default::default()
    };
    let err = match resolve_driver_for_params(&db_params, None).await {
        Ok(_) => panic!("expected the for_connection failure to surface"),
        Err(err) => err,
    };

    assert!(
        err.message
            .contains("simulated connection metadata discovery failure"),
        "unexpected error message: {}",
        err.message
    );
    assert_eq!(
        calls.load(std::sync::atomic::Ordering::SeqCst),
        1,
        "a registered driver's own for_connection failure should not be retried"
    );
}

/// Issue #1082: on a connection with several databases selected, every tool
/// ran against the first one. The tools that touch data take an optional
/// `database` to pick another.
#[test]
fn data_tools_advertise_an_optional_database() {
    let result =
        handle_list_tools(&AppConfig::default()).expect("tool discovery should succeed");
    let tools = result["tools"].as_array().expect("tools must be an array");

    for name in ["list_tables", "describe_table", "run_query"] {
        let tool = tools
            .iter()
            .find(|tool| tool["name"] == name)
            .unwrap_or_else(|| panic!("{name} must be advertised"));
        assert_eq!(
            tool["inputSchema"]["properties"]["database"]["type"],
            "string"
        );
        assert!(!tool["inputSchema"]["required"]
            .as_array()
            .expect("required must be an array")
            .iter()
            .any(|field| field == "database"));
    }
}

#[test]
fn database_arg_reads_a_named_database() {
    let args = json!({ "database": "analytics" });
    assert_eq!(database_arg(args.as_object().unwrap()), Some("analytics"));
}

#[test]
fn database_arg_ignores_a_missing_blank_or_non_string_value() {
    for args in [
        json!({}),
        json!({ "database": "" }),
        json!({ "database": 3 }),
    ] {
        assert_eq!(database_arg(args.as_object().unwrap()), None);
    }
}

#[test]
fn database_override_replaces_a_multi_database_selection() {
    let mut params = ConnectionParams {
        driver: "postgres".to_string(),
        database: DatabaseSelection::Multiple(vec!["main".to_string(), "analytics".to_string()]),
        ..Default::default()
    };

    apply_database_override(
        &mut params,
        Some("analytics"),
        &postgres::PostgresDriver::new().manifest().capabilities,
    )
    .unwrap();

    assert!(matches!(params.database, DatabaseSelection::Single(ref db) if db == "analytics"));
}

#[test]
fn database_override_keeps_the_saved_selection_without_a_database() {
    let mut params = ConnectionParams {
        driver: "postgres".to_string(),
        database: DatabaseSelection::Multiple(vec!["main".to_string(), "analytics".to_string()]),
        ..Default::default()
    };

    apply_database_override(
        &mut params,
        None,
        &postgres::PostgresDriver::new().manifest().capabilities,
    )
    .unwrap();

    assert_eq!(params.database.as_vec(), vec!["main", "analytics"]);
}

/// Run dispatch in a child test process: MCP resolves saved connections from
/// a process-global storage location, which must never point at real user data.
#[tokio::test]
async fn database_scope_is_enforced_before_driver_access() {
    const CHILD_ENV: &str = "TABULARIS_MCP_DATABASE_SCOPE_TEST_CHILD";
    if std::env::var_os(CHILD_ENV).is_none() {
        let fixture = tempfile::tempdir().unwrap();
        let config_dir = fixture.path().join("config");
        std::fs::create_dir(&config_dir).unwrap();
        let saved_path = config_dir.join("sandbox.sqlite");
        let private_path = fixture.path().join("private.sqlite");
        for (path, table, value) in [
            (&saved_path, "visible", "public-data"),
            (&private_path, "secret_records", "private-data"),
        ] {
            let pool = sqlx::sqlite::SqlitePoolOptions::new()
                .connect_with(
                    sqlx::sqlite::SqliteConnectOptions::new()
                        .filename(path)
                        .create_if_missing(true),
                )
                .await
                .unwrap();
            sqlx::query(&format!("CREATE TABLE {table} (value TEXT)"))
                .execute(&pool)
                .await
                .unwrap();
            sqlx::query(&format!("INSERT INTO {table} VALUES (?)"))
                .bind(value)
                .execute(&pool)
                .await
                .unwrap();
            pool.close().await;
        }

        let mut connections = vec![];
        for (id, driver, database) in [
            (
                "saved-file",
                "sqlite",
                DatabaseSelection::Single(saved_path.to_str().unwrap().to_string()),
            ),
            (
                "saved-single",
                "postgres",
                DatabaseSelection::Single("sandbox".to_string()),
            ),
            (
                "saved-multiple",
                "mysql",
                DatabaseSelection::Multiple(vec!["sandbox".to_string(), "analytics".to_string()]),
            ),
            ("saved-empty", "postgres", DatabaseSelection::default()),
        ] {
            connections.push(json!({
                "id": id,
                "name": id,
                "params": ConnectionParams {
                    driver: driver.to_string(),
                    host: Some("127.0.0.1".to_string()),
                    port: Some(9),
                    database,
                    ..Default::default()
                }
            }));
        }
        std::fs::write(
            config_dir.join("connections.json"),
            serde_json::to_vec(&connections).unwrap(),
        )
        .unwrap();

        let output = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            tokio::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "mcp::tests::database_scope_is_enforced_before_driver_access",
                    "--nocapture",
                ])
                .env(CHILD_ENV, "1")
                .env(crate::storage_location::ENV_VAR, &config_dir)
                .current_dir(&config_dir)
                .kill_on_drop(true)
                .output(),
        )
        .await
        .expect("isolated MCP dispatch test must finish promptly")
        .unwrap();
        assert!(
            output.status.success(),
            "isolated MCP dispatch failed:\n{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr),
        );
        assert!(
            String::from_utf8_lossy(&output.stdout).contains("1 passed"),
            "the child process must execute the dispatch test",
        );
        return;
    }

    driver_registry::register_driver(sqlite::SqliteDriver::new()).await;
    driver_registry::register_driver(postgres::PostgresDriver::new()).await;
    driver_registry::register_driver(mysql::MysqlDriver::new()).await;
    let private_path = paths::get_app_config_dir()
        .parent()
        .unwrap()
        .join("private.sqlite");

    for readonly in [true, false] {
        let config = AppConfig {
            mcp_readonly_default: Some(readonly),
            mcp_approval_mode: Some("off".to_string()),
            active_external_drivers: Some(vec![]),
            ..Default::default()
        };
        for tool in ["list_tables", "describe_table", "run_query"] {
            for (connection_id, database) in [
                ("saved-file", private_path.to_str().unwrap()),
                ("saved-file", "../private.sqlite"),
                ("saved-file", "~/private.sqlite"),
                ("saved-single", "production"),
                ("saved-multiple", "production"),
                ("saved-empty", "production"),
            ] {
                let args = json!({
                    "connection_id": connection_id,
                    "database": database,
                    "table_name": "secret_records",
                    "query": "SELECT value FROM secret_records",
                });
                let mut audit = CallAudit::for_tool(tool);
                let error =
                    dispatch_tool(tool, args.as_object(), &config, "scope-test", &mut audit)
                        .await
                        .expect_err("unconfigured databases must be rejected before driver access");
                assert_eq!(error.code, -32602, "{tool}: {error:?}");
                assert_eq!(audit.database.as_deref(), Some(database));
            }

            let args = json!({
                "connection_id": "saved-file",
                "table_name": "visible",
                "query": "SELECT value FROM visible",
            });
            let mut audit = CallAudit::for_tool(tool);
            let result = dispatch_tool(tool, args.as_object(), &config, "scope-test", &mut audit)
                .await
                .expect("the saved file must remain accessible without an override");
            let text = result["content"][0]["text"].as_str().unwrap();
            assert!(
                text.contains(if tool == "run_query" {
                    "public-data"
                } else {
                    "visible"
                }),
                "{tool}: {text}",
            );
        }
    }
}
