use super::*;
use crate::models::DatabaseSelection;

fn column(name: &str) -> ColumnDefinition {
    ColumnDefinition {
        name: name.into(),
        data_type: "INT64".into(),
        is_nullable: true,
        is_pk: false,
        is_auto_increment: false,
        default_value: None,
        comment: None,
    }
}

fn browsed_params() -> ConnectionParams {
    ConnectionParams {
        driver: "test-plugin".into(),
        connection_id: Some("conn-1".into()),
        database: DatabaseSelection::Single("analytics-project".into()),
        ..Default::default()
    }
}

/// Every SQL builder whose trait signature has no params must forward the
/// bound connection context, even for plugins without connection metadata.
fn assert_bound(request: &JsonRpcRequest) {
    assert_eq!(request.params["params"]["database"], "analytics-project");
    assert_eq!(request.params["params"]["connection_id"], "conn-1");
}

#[tokio::test]
async fn bound_driver_forwards_params_to_every_sql_builder() {
    let driver = test_driver(|request| {
        assert_bound(&request);
        match request.method.as_str() {
            "routine_create_template" => json!("CREATE PROCEDURE p() BEGIN END"),
            _ => json!(["SQL"]),
        }
    });
    let bound = driver
        .bind_connection_params(&browsed_params())
        .expect("plugin drivers always bind");

    bound
        .get_create_table_sql("t", vec![column("id")], Some("ds"))
        .await
        .unwrap();
    bound
        .get_add_column_sql("t", column("c"), Some("ds"))
        .await
        .unwrap();
    bound
        .get_alter_column_sql("t", column("c"), column("d"), Some("ds"))
        .await
        .unwrap();
    bound
        .get_create_index_sql("t", "idx", vec!["c".into()], false, Some("ds"))
        .await
        .unwrap();
    bound
        .routine_create_template("PROCEDURE", Some("ds"))
        .await
        .unwrap();
}

#[tokio::test]
async fn unbound_driver_keeps_legacy_request_shape() {
    let driver = test_driver(|request| {
        assert!(request.params.get("params").is_none());
        json!(["SQL"])
    });
    driver
        .get_create_table_sql("t", vec![column("id")], None)
        .await
        .unwrap();
}

#[tokio::test]
async fn bind_connection_params_coerces_multi_database_selection() {
    let mut driver = test_driver(|request| {
        assert_eq!(request.params["params"]["database"], "first");
        json!(["SQL"])
    });
    Arc::get_mut(&mut driver.process)
        .unwrap()
        .route_selected_database = false;
    let params = ConnectionParams {
        database: DatabaseSelection::Multiple(vec!["first".into(), "second".into()]),
        ..Default::default()
    };
    driver
        .bind_connection_params(&params)
        .unwrap()
        .get_add_column_sql("t", column("c"), None)
        .await
        .unwrap();
}

#[tokio::test]
async fn bound_driver_keeps_manifest_and_metadata_flag() {
    let driver = test_driver(|_| json!(null)).with_connection_metadata(true);
    let bound = driver.bind_connection_params(&browsed_params()).unwrap();
    assert_eq!(bound.manifest().id, "test-plugin");
    assert!(bound.has_connection_metadata());
}

#[tokio::test]
async fn column_comment_reaches_the_plugin_only_when_set() {
    let driver = test_driver(|request| {
        assert!(request.params["old_column"].get("comment").is_none());
        assert_eq!(request.params["new_column"]["comment"], "Primary contact");
        json!(["ALTER TABLE t ALTER COLUMN c SET OPTIONS (description = 'Primary contact')"])
    });
    let mut described = column("c");
    described.comment = Some("Primary contact".into());
    driver
        .get_alter_column_sql("t", column("c"), described, None)
        .await
        .unwrap();
}

#[test]
fn legacy_column_payload_without_comment_still_deserializes() {
    let parsed: ColumnDefinition = serde_json::from_value(json!({
        "name": "c", "data_type": "INT", "is_nullable": true, "is_pk": false,
        "is_auto_increment": false, "default_value": null
    }))
    .unwrap();
    assert_eq!(parsed.comment, None);
}

#[test]
fn column_comments_capability_is_opt_in_and_omitted_when_false() {
    use crate::drivers::driver_trait::DriverCapabilities;
    let legacy = json!({ "schemas": true, "views": true, "routines": false, "file_based": false });
    let capabilities: DriverCapabilities = serde_json::from_value(legacy.clone()).unwrap();
    assert!(!capabilities.column_comments);
    assert!(serde_json::to_value(&capabilities)
        .unwrap()
        .get("column_comments")
        .is_none());
    let mut enabled = legacy;
    enabled["column_comments"] = json!(true);
    let capabilities: DriverCapabilities = serde_json::from_value(enabled).unwrap();
    assert!(capabilities.column_comments);
}
