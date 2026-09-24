use super::*;
use crate::drivers::driver_trait::DriverCapabilities;
use crate::models::{TableQueryTemplateKind, TableQueryTemplateRequest};
use crate::plugins::rpc::JsonRpcError;

fn request() -> TableQueryTemplateRequest {
    TableQueryTemplateRequest {
        table: "orders".into(),
        schema: Some("sales".into()),
        kind: TableQueryTemplateKind::Select,
        columns: vec!["order id".into()],
        limit: Some(100),
    }
}

fn reply(result: Result<Value, PluginCallError>) -> RpcDriver {
    let mut driver = test_driver(|_| panic!("unexpected request"));
    driver.manifest.capabilities.table_query_templates = true;
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
fn table_query_templates_are_opt_in_and_do_not_change_legacy_serialization() {
    let legacy = json!({
        "schemas": true, "views": true, "routines": false, "file_based": false
    });
    let capabilities: DriverCapabilities = serde_json::from_value(legacy.clone()).unwrap();
    assert!(!capabilities.table_query_templates);
    assert!(serde_json::to_value(&capabilities)
        .unwrap()
        .get("table_query_templates")
        .is_none());
    let mut enabled = legacy;
    enabled["table_query_templates"] = json!(true);
    let capabilities: DriverCapabilities = serde_json::from_value(enabled).unwrap();
    assert!(capabilities.table_query_templates);
    assert_eq!(
        serde_json::to_value(capabilities).unwrap()["table_query_templates"],
        true
    );
}

#[tokio::test]
async fn legacy_plugins_are_not_called_for_table_query_templates() {
    let driver = test_driver(|_| panic!("legacy plugins must not receive the new RPC"));
    assert_eq!(
        driver
            .get_table_query_template(&ConnectionParams::default(), &request())
            .await
            .unwrap(),
        None
    );
}

#[tokio::test]
async fn table_query_template_request_preserves_connection_and_structured_identifiers() {
    let mut driver = test_driver(|rpc| {
        assert_eq!(rpc.method, "get_table_query_template");
        assert_eq!(rpc.params["params"]["connection_id"], "target-connection");
        assert_eq!(
            rpc.params["request"],
            json!({
                "table": "orders", "schema": "sales", "kind": "select",
                "columns": ["order id"], "limit": 100
            })
        );
        json!("SELECT TOP (100) [order id] FROM [sales].[orders];")
    });
    driver.manifest.capabilities.table_query_templates = true;
    let params = ConnectionParams {
        connection_id: Some("target-connection".into()),
        ..Default::default()
    };
    assert_eq!(
        driver
            .get_table_query_template(&params, &request())
            .await
            .unwrap(),
        Some("SELECT TOP (100) [order id] FROM [sales].[orders];".into())
    );
}

#[tokio::test]
async fn table_query_template_fallback_requires_the_remote_method_not_found_code() {
    let driver = reply(Err(PluginCallError::Remote(JsonRpcError {
        code: -32601,
        message: "localized missing method".into(),
    })));
    assert_eq!(
        driver
            .get_table_query_template(&ConnectionParams::default(), &request())
            .await
            .unwrap(),
        None
    );
    for error in [
        PluginCallError::Remote(JsonRpcError {
            code: -32000,
            message: "method not found inside SQL".into(),
        }),
        PluginCallError::Transport("-32601 transport failure".into()),
    ] {
        assert!(reply(Err(error))
            .get_table_query_template(&ConnectionParams::default(), &request())
            .await
            .is_err());
    }
    for malformed in [Value::Null, json!({"sql": "SELECT 1"}), json!(42)] {
        assert!(reply(Ok(malformed))
            .get_table_query_template(&ConnectionParams::default(), &request())
            .await
            .is_err());
    }
}

#[tokio::test]
async fn built_in_drivers_keep_the_default_table_query_template_behavior() {
    let drivers: Vec<Box<dyn DatabaseDriver>> = vec![
        Box::new(crate::drivers::mysql::MysqlDriver::new()),
        Box::new(crate::drivers::postgres::PostgresDriver::new()),
        Box::new(crate::drivers::sqlite::SqliteDriver::new()),
    ];
    for driver in drivers {
        assert!(!driver.manifest().capabilities.table_query_templates);
        assert_eq!(
            driver
                .get_table_query_template(&ConnectionParams::default(), &request())
                .await
                .unwrap(),
            None
        );
    }
}
