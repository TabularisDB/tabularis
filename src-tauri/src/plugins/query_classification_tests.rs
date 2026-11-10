use super::*;
use crate::drivers::driver_trait::DriverCapabilities;
use crate::plugins::rpc::JsonRpcError;

const QUERY_RESULT: &str = r#"{"columns":["n"],"rows":[[1]],"affected_rows":0,"pagination":null}"#;

fn query_result() -> Value {
    serde_json::from_str(QUERY_RESULT).unwrap()
}

/// The failures a plugin call can end in. `PluginCallError` is not `Clone`, so
/// tests take constructors.
fn failures() -> [fn() -> PluginCallError; 3] {
    [
        || {
            PluginCallError::Remote(JsonRpcError {
                code: -32601,
                message: "localized missing method".into(),
            })
        },
        || {
            PluginCallError::Remote(JsonRpcError {
                code: -32000,
                message: "the plugin failed".into(),
            })
        },
        || PluginCallError::Transport("plugin process exited".into()),
    ]
}

#[test]
fn the_capabilities_are_opt_in_and_do_not_change_legacy_serialization() {
    let legacy = json!({
        "schemas": true, "views": true, "routines": false, "file_based": false
    });
    let capabilities: DriverCapabilities = serde_json::from_value(legacy.clone()).unwrap();
    assert!(!capabilities.query_classification);
    assert!(!capabilities.read_only_execution);
    let serialized = serde_json::to_value(&capabilities).unwrap();
    assert!(serialized.get("query_classification").is_none());
    assert!(serialized.get("read_only_execution").is_none());

    let mut enabled = legacy;
    enabled["query_classification"] = json!(true);
    enabled["read_only_execution"] = json!(true);
    let capabilities: DriverCapabilities = serde_json::from_value(enabled).unwrap();
    assert!(capabilities.query_classification);
    assert!(capabilities.read_only_execution);
    let serialized = serde_json::to_value(capabilities).unwrap();
    assert_eq!(serialized["query_classification"], true);
    assert_eq!(serialized["read_only_execution"], true);
}

#[test]
fn parse_query_kind_accepts_only_the_four_documented_kinds() {
    for kind in ["select", "write", "ddl", "unknown"] {
        assert_eq!(parse_query_kind(&json!({ "kind": kind })), kind);
    }
    // Fields added later must not make an old host misread the verdict.
    assert_eq!(
        parse_query_kind(&json!({ "kind": "write", "reason": "insertOne" })),
        "write"
    );
    for unreadable in [
        Value::Null,
        json!("select"),
        json!(["select"]),
        json!(42),
        json!({}),
        json!({ "kind": null }),
        json!({ "kind": 1 }),
        json!({ "kind": "" }),
        json!({ "kind": "SELECT" }),
        json!({ "kind": " select" }),
        json!({ "kind": "read" }),
        json!({ "Kind": "select" }),
    ] {
        assert_eq!(parse_query_kind(&unreadable), "unknown", "{unreadable}");
    }
}

#[tokio::test]
async fn a_plugin_that_did_not_opt_in_is_never_asked_to_classify() {
    let driver = test_driver(|_| panic!("legacy plugins must not receive classify_query"));
    assert_eq!(
        driver
            .classify_query(&ConnectionParams::default(), "db.users.find({})")
            .await
            .unwrap(),
        None
    );
}

#[tokio::test]
async fn classify_query_sends_the_connection_and_the_exact_query() {
    let query = "  db.users\n// note\n.find({})  ";
    let mut driver = test_driver(move |rpc| {
        assert_eq!(rpc.method, "classify_query");
        assert_eq!(rpc.params["params"]["connection_id"], "target-connection");
        assert_eq!(rpc.params["query"], query);
        json!({ "kind": "select" })
    });
    driver.manifest.capabilities.query_classification = true;
    let params = ConnectionParams {
        connection_id: Some("target-connection".into()),
        ..Default::default()
    };
    assert_eq!(
        driver.classify_query(&params, query).await.unwrap(),
        Some("select")
    );
}

#[tokio::test]
async fn classify_query_reports_what_the_plugin_said_and_nothing_else() {
    for (reply, expected) in [
        (json!({ "kind": "select" }), "select"),
        (json!({ "kind": "write" }), "write"),
        (json!({ "kind": "ddl" }), "ddl"),
        (json!({ "kind": "unknown" }), "unknown"),
        (json!({ "kind": "SELECT" }), "unknown"),
        (json!("select"), "unknown"),
        (Value::Null, "unknown"),
    ] {
        let mut driver = test_driver(move |_| reply.clone());
        driver.manifest.capabilities.query_classification = true;
        assert_eq!(
            driver
                .classify_query(&ConnectionParams::default(), "q")
                .await
                .unwrap(),
            Some(expected)
        );
    }
}

#[tokio::test]
async fn a_failed_classify_query_is_an_error_and_never_a_verdict() {
    // -32601 included: a plugin that declares the capability and lacks the
    // method is broken, which is not a reason to read its language as SQL.
    for failure in failures() {
        let mut driver = test_driver_detailed(move |_| Err(failure()));
        driver.manifest.capabilities.query_classification = true;
        assert!(driver
            .classify_query(&ConnectionParams::default(), "db.users.find({})")
            .await
            .is_err());
    }
}

#[tokio::test]
async fn a_plugin_without_the_guarantee_runs_read_only_queries_through_execute_query() {
    let driver = test_driver(|rpc| {
        assert_eq!(
            rpc.method, "execute_query",
            "a plugin that did not opt in sees no new RPC"
        );
        query_result()
    });
    let result = driver
        .execute_read_only_query(&ConnectionParams::default(), "SELECT 1", Some(10), 1, None)
        .await
        .unwrap();
    assert_eq!(result.rows.len(), 1);
}

#[tokio::test]
async fn execute_read_only_query_sends_the_execute_query_request_to_its_own_method() {
    let mut driver = test_driver(|rpc| {
        assert_eq!(rpc.method, "execute_read_only_query");
        assert_eq!(rpc.params["params"]["connection_id"], "target-connection");
        assert_eq!(rpc.params["query"], "db.users.find({})");
        assert_eq!(rpc.params["limit"], 10);
        assert_eq!(rpc.params["page"], 2);
        assert_eq!(rpc.params["schema"], "app");
        query_result()
    });
    driver.manifest.capabilities.read_only_execution = true;
    let params = ConnectionParams {
        connection_id: Some("target-connection".into()),
        ..Default::default()
    };
    let result = driver
        .execute_read_only_query(&params, "db.users.find({})", Some(10), 2, Some("app"))
        .await
        .unwrap();
    assert_eq!(result.rows.len(), 1);
}

#[tokio::test]
async fn a_failed_read_only_call_never_falls_back_to_execute_query() {
    for failure in failures() {
        let methods = Arc::new(Mutex::new(Vec::<String>::new()));
        let seen = methods.clone();
        let mut driver = test_driver_detailed(move |rpc| {
            seen.lock().unwrap().push(rpc.method);
            Err(failure())
        });
        driver.manifest.capabilities.read_only_execution = true;
        assert!(driver
            .execute_read_only_query(
                &ConnectionParams::default(),
                "db.users.drop()",
                None,
                1,
                None
            )
            .await
            .is_err());
        assert_eq!(
            *methods.lock().unwrap(),
            vec!["execute_read_only_query".to_string()],
            "the statement must not be sent through execute_query"
        );
    }
}

#[tokio::test]
async fn a_malformed_read_only_result_is_an_error() {
    let mut driver = test_driver(|_| json!("not a query result"));
    driver.manifest.capabilities.read_only_execution = true;
    assert!(driver
        .execute_read_only_query(&ConnectionParams::default(), "q", None, 1, None)
        .await
        .is_err());
}

#[tokio::test]
async fn built_in_drivers_do_not_classify_and_do_not_claim_the_guarantee() {
    let drivers: Vec<Box<dyn DatabaseDriver>> = vec![
        Box::new(crate::drivers::mysql::MysqlDriver::new()),
        Box::new(crate::drivers::postgres::PostgresDriver::new()),
        Box::new(crate::drivers::sqlite::SqliteDriver::new()),
    ];
    for driver in drivers {
        let capabilities = &driver.manifest().capabilities;
        assert!(!capabilities.query_classification);
        assert!(!capabilities.read_only_execution);
        assert_eq!(
            driver
                .classify_query(&ConnectionParams::default(), "SELECT 1")
                .await
                .unwrap(),
            None
        );
    }
}
