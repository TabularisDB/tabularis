use super::*;
use crate::drivers::driver_trait::DriverCapabilities;
use crate::models::{ColumnStatsParts, ColumnStatsRequest, ColumnStatsResult, ColumnTopValue};
use crate::plugins::rpc::JsonRpcError;

const ALL: ColumnStatsParts = ColumnStatsParts {
    distinct: true,
    min_max: true,
    top_values: true,
};

fn request() -> ColumnStatsRequest {
    ColumnStatsRequest {
        table: "orders".into(),
        schema: Some("sales".into()),
        column: "order total".into(),
        data_type: Some("decimal".into()),
        filter: Some("status = 'open'".into()),
        top_values_limit: 10,
        include: ALL,
    }
}

fn stats_json() -> Value {
    json!({
        "row_count": 4, "null_count": 1, "distinct_count": 2,
        "min": 5, "max": 9,
        "top_values": [{"value": 5, "count": 2}, {"value": 9, "count": 1}]
    })
}

fn reply(result: Result<Value, PluginCallError>) -> RpcDriver {
    let mut driver = test_driver(|_| panic!("unexpected request"));
    driver.manifest.capabilities.column_stats = true;
    let (sender, mut receiver) = mpsc::channel(1);
    Arc::get_mut(&mut driver.process).unwrap().sender = sender;
    tokio::spawn(async move {
        if let Some(PluginCommand::Call(_, response)) = receiver.recv().await {
            let _ = response.send(result);
        }
    });
    driver
}

#[test]
fn column_stats_are_opt_in_and_do_not_change_legacy_serialization() {
    let legacy = json!({
        "schemas": true, "views": true, "routines": false, "file_based": false
    });
    let capabilities: DriverCapabilities = serde_json::from_value(legacy.clone()).unwrap();
    assert!(!capabilities.column_stats);
    assert!(serde_json::to_value(&capabilities)
        .unwrap()
        .get("column_stats")
        .is_none());
    let mut enabled = legacy;
    enabled["column_stats"] = json!(true);
    let capabilities: DriverCapabilities = serde_json::from_value(enabled).unwrap();
    assert!(capabilities.column_stats);
    assert_eq!(
        serde_json::to_value(capabilities).unwrap()["column_stats"],
        true
    );
}

#[tokio::test]
async fn legacy_plugins_are_not_called_for_column_stats() {
    let driver = test_driver(|_| panic!("legacy plugins must not receive the new RPC"));
    assert_eq!(
        driver
            .get_column_stats(&ConnectionParams::default(), &request())
            .await
            .unwrap(),
        None
    );
}

#[tokio::test]
async fn column_stats_request_carries_identifiers_filter_limit_and_parts() {
    let mut driver = test_driver(|rpc| {
        assert_eq!(rpc.method, "get_column_stats");
        assert_eq!(rpc.params["params"]["connection_id"], "target-connection");
        assert_eq!(
            rpc.params["request"],
            json!({
                "table": "orders", "schema": "sales", "column": "order total",
                "data_type": "decimal", "filter": "status = 'open'",
                "top_values_limit": 10,
                "include": {"distinct": true, "min_max": true, "top_values": true}
            })
        );
        stats_json()
    });
    driver.manifest.capabilities.column_stats = true;
    let params = ConnectionParams {
        connection_id: Some("target-connection".into()),
        ..Default::default()
    };
    let stats = driver
        .get_column_stats(&params, &request())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        stats,
        ColumnStatsResult {
            row_count: 4,
            null_count: 1,
            distinct_count: Some(2),
            min: Some(json!(5)),
            max: Some(json!(9)),
            top_values: Some(vec![
                ColumnTopValue {
                    value: json!(5),
                    count: 2
                },
                ColumnTopValue {
                    value: json!(9),
                    count: 1
                },
            ]),
            sample_size: None,
        }
    );
}

#[tokio::test]
async fn column_stats_never_return_values_the_host_did_not_ask_for() {
    // A masked column: the plugin ignores the request and sends everything.
    let driver = reply(Ok(stats_json()));
    let mut masked = request();
    masked.include = ColumnStatsParts {
        distinct: true,
        min_max: false,
        top_values: false,
    };
    let stats = driver
        .get_column_stats(&ConnectionParams::default(), &masked)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(stats.distinct_count, Some(2));
    assert_eq!((stats.min, stats.max), (None, None));
    assert_eq!(stats.top_values, None);
}

#[tokio::test]
async fn column_stats_fallback_requires_the_remote_method_not_found_code() {
    let driver = reply(Err(PluginCallError::Remote(JsonRpcError {
        code: -32601,
        message: "localized missing method".into(),
    })));
    assert_eq!(
        driver
            .get_column_stats(&ConnectionParams::default(), &request())
            .await
            .unwrap(),
        None
    );
    for error in [
        PluginCallError::Remote(JsonRpcError {
            code: -32000,
            message: "method not found inside the query".into(),
        }),
        PluginCallError::Transport("-32601 transport failure".into()),
    ] {
        assert!(reply(Err(error))
            .get_column_stats(&ConnectionParams::default(), &request())
            .await
            .is_err());
    }
    for malformed in [
        Value::Null,
        json!("4 rows"),
        json!({"row_count": 4}),
        json!({"row_count": 1, "null_count": 2}),
    ] {
        assert!(reply(Ok(malformed))
            .get_column_stats(&ConnectionParams::default(), &request())
            .await
            .unwrap_err()
            .contains("Invalid column statistics"));
    }
}

#[tokio::test]
async fn column_stats_coerce_a_multi_database_selection_before_the_rpc() {
    let mut driver = test_driver(|rpc| {
        assert_eq!(rpc.params["params"]["database"], "tabularis_pr822_demo");
        json!({"row_count": 0, "null_count": 0})
    });
    driver.manifest.capabilities.column_stats = true;
    Arc::get_mut(&mut driver.process)
        .unwrap()
        .route_selected_database = false;
    let params = ConnectionParams {
        database: DatabaseSelection::Multiple(vec![
            "tabularis_pr822_demo".to_string(),
            "tabularis_test_secondary".to_string(),
        ]),
        ..Default::default()
    };
    let stats = driver
        .get_column_stats(&params, &request())
        .await
        .unwrap()
        .unwrap();
    assert_eq!((stats.row_count, stats.null_count), (0, 0));
}

#[tokio::test]
async fn built_in_drivers_keep_the_generic_sql_column_stats() {
    let drivers: Vec<Box<dyn DatabaseDriver>> = vec![
        Box::new(crate::drivers::mysql::MysqlDriver::new()),
        Box::new(crate::drivers::postgres::PostgresDriver::new()),
        Box::new(crate::drivers::sqlite::SqliteDriver::new()),
    ];
    for driver in drivers {
        assert!(!driver.manifest().capabilities.column_stats);
        assert!(driver.manifest().capabilities.sql_dialect.is_some());
        assert_eq!(
            driver
                .get_column_stats(&ConnectionParams::default(), &request())
                .await
                .unwrap(),
            None
        );
    }
}
