use super::*;
use crate::drivers::driver_trait::DriverCapabilities;
use crate::plugins::rpc::JsonRpcError;

#[test]
fn read_only_capability_is_opt_in_and_legacy_manifests_keep_their_wire_shape() {
    let caps: DriverCapabilities = serde_json::from_value(json!({
        "schemas":false, "views":false, "routines":false, "file_based":false,
    }))
    .unwrap();
    assert!(!caps.read_only_queries);
    assert!(serde_json::to_value(caps)
        .unwrap()
        .get("read_only_queries")
        .is_none());
}

#[tokio::test]
async fn protected_query_uses_the_optional_rpc_with_connection_context() {
    let mut driver = test_driver(|rpc| {
        assert_eq!(rpc.method, "execute_read_only_query");
        assert_eq!(rpc.params["params"]["read_only"], true);
        assert_eq!(rpc.params["params"]["connection_id"], "protected");
        assert_eq!(rpc.params["params"]["database"], "analytics");
        assert_eq!(rpc.params["schema"], "sales");
        assert_eq!(rpc.params["query"], "SELECT 1");
        json!({"columns":["value"],"rows":[[1]],"affected_rows":0})
    });
    driver.manifest.capabilities.read_only_queries = true;
    Arc::get_mut(&mut driver.process)
        .unwrap()
        .route_selected_database = false;
    let params = ConnectionParams {
        read_only: true,
        connection_id: Some("protected".into()),
        database: DatabaseSelection::Multiple(vec!["analytics".into(), "other".into()]),
        ..Default::default()
    };
    let result = driver
        .execute_read_only_query(&params, "SELECT 1", Some(10), 1, Some("sales"))
        .await
        .unwrap();
    assert_eq!(result.rows[0][0], json!(1));
}

#[tokio::test]
async fn unsupported_plugins_never_receive_an_unprotected_request() {
    let driver = test_driver(|_| panic!("no unprotected request is allowed"));
    let params = ConnectionParams {
        read_only: true,
        ..Default::default()
    };
    assert!(driver
        .execute_read_only_query(&params, "SELECT 1", None, 1, None)
        .await
        .is_err());
}

#[tokio::test]
async fn missing_or_failed_protection_never_falls_back_to_execute_query() {
    for code in [-32601, -32000] {
        let mut driver = test_driver_detailed(move |rpc| {
            assert_eq!(rpc.method, "execute_read_only_query");
            Err(PluginCallError::Remote(JsonRpcError {
                code,
                message: "protection unavailable".into(),
            }))
        });
        driver.manifest.capabilities.read_only_queries = true;
        let params = ConnectionParams {
            read_only: true,
            ..Default::default()
        };
        assert!(driver
            .execute_read_only_query(&params, "SELECT 1", None, 1, None)
            .await
            .is_err());
    }
}

#[tokio::test]
async fn intrinsically_read_only_plugins_need_no_new_rpc() {
    let mut driver = test_driver(|rpc| {
        assert_eq!(rpc.method, "execute_query");
        json!({"columns":[],"rows":[],"affected_rows":0})
    });
    driver.manifest.capabilities.readonly = true;
    driver
        .execute_read_only_query(
            &ConnectionParams {
                read_only: true,
                ..Default::default()
            },
            "SELECT 1",
            None,
            1,
            None,
        )
        .await
        .unwrap();
}
