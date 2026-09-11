use super::*;
use crate::drivers::driver_trait::DatabaseDriver;
use crate::models::RoutineCallArg;
use crate::plugins::driver::RpcDriver;
use crate::plugins::manager::ConfigManifest;
use serde_json::json;

fn manifest() -> PluginManifest {
    serde_json::from_value(json!({
        "id": "jdbc-test", "name": "JDBC test", "version": "1.0.0",
        "description": "", "default_port": null,
        "capabilities": {
            "schemas": true, "views": true, "routines": false,
            "file_based": false, "identifier_quote": "\"", "alter_primary_key": false
        },
        "type_mappings": { "JSON": "TEXT" }
    }))
    .unwrap()
}

fn types() -> Vec<DataTypeInfo> {
    serde_json::from_value(json!([{
        "name": "TEXT", "category": "string", "requires_length": false,
        "requires_precision": false
    }]))
    .unwrap()
}

fn params(uri: &str) -> ConnectionParams {
    ConnectionParams {
        driver: "jdbc-test".into(),
        connection_id: Some("connection-one".into()),
        connection_uri: Some(uri.into()),
        ..Default::default()
    }
}

#[test]
fn omitted_fields_preserve_static_metadata() {
    let base = manifest();
    let resolved = ConnectionMetadataOverrides::default()
        .resolve(&base, &types())
        .unwrap();
    assert_eq!(
        serde_json::to_value(&resolved.capabilities).unwrap(),
        serde_json::to_value(&base.capabilities).unwrap()
    );
    assert_eq!(resolved.data_types[0].name, "TEXT");
    assert_eq!(resolved.type_mappings["JSON"], "TEXT");
}

#[test]
fn explicit_false_and_empty_collections_replace_defaults() {
    let overrides: ConnectionMetadataOverrides = serde_json::from_value(json!({
        "capabilities": { "schemas": false, "views": false, "manage_tables": false },
        "data_types": [], "type_mappings": {}
    }))
    .unwrap();
    let base = manifest();
    let resolved = overrides.resolve(&base, &types()).unwrap();
    assert!(!resolved.capabilities.schemas);
    assert!(!resolved.capabilities.views);
    assert!(!resolved.capabilities.manage_tables);
    assert!(resolved.data_types.is_empty());
    assert!(resolved.type_mappings.is_empty());
    assert!(base.capabilities.schemas);
}

#[test]
fn metadata_cannot_change_connection_setup_or_lift_readonly() {
    for field in [
        "file_based",
        "connection_uri",
        "supports_ssl",
        "no_connection_required",
    ] {
        let mut capabilities = serde_json::Map::new();
        capabilities.insert(field.into(), json!(true));
        assert!(serde_json::from_value::<ConnectionMetadataOverrides>(
            json!({"capabilities": capabilities})
        )
        .is_err());
    }
    let mut base = manifest();
    base.capabilities.readonly = true;
    let overrides: ConnectionMetadataOverrides =
        serde_json::from_value(json!({"capabilities": {"readonly": false}})).unwrap();
    assert!(
        overrides
            .resolve(&base, &types())
            .unwrap()
            .capabilities
            .readonly
    );
}

#[test]
fn invalid_types_quotes_and_dialects_are_rejected() {
    for payload in [
        json!({"capabilities": {"schemas": "yes"}}),
        json!({"capabilities": {"sql_dialect": "unknown"}}),
        json!({"data_types": [{}]}),
        json!(null),
    ] {
        assert!(serde_json::from_value::<ConnectionMetadataOverrides>(payload).is_err());
    }
    for payload in [
        json!({"capabilities": {"identifier_quote": " "}}),
        json!({"data_types": [{"name": "", "category": "string", "requires_length": false, "requires_precision": false}]}),
    ] {
        let overrides: ConnectionMetadataOverrides = serde_json::from_value(payload).unwrap();
        assert!(overrides.resolve(&manifest(), &types()).is_err());
    }
}

#[test]
fn static_manifest_wire_shape_and_opt_in_default_are_unchanged() {
    let base = manifest();
    let details = DriverManifestDetails {
        manifest: base.clone(),
        connection_metadata: None,
    };
    assert_eq!(
        serde_json::to_value(details).unwrap(),
        serde_json::to_value(base).unwrap()
    );
    let config: ConfigManifest = serde_json::from_value(json!({
        "name": "old-plugin", "version": "1.0.0", "description": "", "executable": "driver"
    }))
    .unwrap();
    assert!(!config.connection_metadata);
}

#[tokio::test]
async fn cache_distinguishes_connection_parameters_and_canonicalizes_extras() {
    let cache = ConnectionMetadataCache::default();
    let original = params("jdbc:postgresql://localhost/one");
    let first = cache.entry(&original).await.unwrap();
    assert!(Arc::ptr_eq(&first, &cache.entry(&original).await.unwrap()));
    let mut changed = original.clone();
    changed.password = Some("changed".into());
    assert!(!Arc::ptr_eq(&first, &cache.entry(&changed).await.unwrap()));
    changed = original.clone();
    changed.connection_id = Some("another-connection".into());
    let other_connection = cache.entry(&changed).await.unwrap();
    assert!(!Arc::ptr_eq(&first, &other_connection));
    let mut a = original.clone();
    a.extra.insert("a".into(), "1".into());
    a.extra.insert("b".into(), "2".into());
    let mut b = original.clone();
    b.extra.insert("b".into(), "2".into());
    b.extra.insert("a".into(), "1".into());
    assert!(Arc::ptr_eq(
        &cache.entry(&a).await.unwrap(),
        &cache.entry(&b).await.unwrap()
    ));
    cache.invalidate(Some("connection-one")).await;
    assert!(!Arc::ptr_eq(&first, &cache.entry(&original).await.unwrap()));
    assert!(Arc::ptr_eq(
        &other_connection,
        &cache.entry(&changed).await.unwrap()
    ));
}

#[tokio::test]
async fn clearing_cache_detaches_inflight_results_and_bounds_temporary_connections() {
    let cache = ConnectionMetadataCache::default();
    let params = params("jdbc:postgresql://localhost/one");
    let old = cache.entry(&params).await.unwrap();
    cache.invalidate(Some("connection-one")).await;
    let current = cache.entry(&params).await.unwrap();
    old.set(
        ConnectionMetadataOverrides::default()
            .resolve(&manifest(), &types())
            .unwrap(),
    )
    .unwrap();
    assert!(current.get().is_none());
    for i in 0..200 {
        let mut next = params.clone();
        next.connection_id = Some(i.to_string());
        cache.entry(&next).await.unwrap();
    }
    assert!(cache.entries.lock().await.len() <= 128);
}

async fn rpc_driver(enabled: bool) -> RpcDriver {
    RpcDriver::new(
        manifest(),
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/connection_metadata_plugin.py"),
        Some(if cfg!(windows) { "python" } else { "python3" }.into()),
        types(),
        HashMap::new(),
    )
    .await
    .unwrap()
    .with_connection_metadata(enabled)
}

#[tokio::test]
async fn static_plugin_receives_no_discovery_rpc() {
    let driver = rpc_driver(false).await;
    let params = params("jdbc:postgresql://localhost/one");
    assert!(driver.for_connection(&params).await.unwrap().is_none());
    assert_eq!(driver.get_databases(&params).await.unwrap(), ["0"]);
    assert_eq!(
        driver
            .get_create_table_sql("example", Vec::new(), None)
            .await
            .unwrap(),
        ["no-connection-params"]
    );
    driver.shutdown().await;
}

#[tokio::test]
async fn rpc_snapshots_isolate_types_dialect_and_sql_fallbacks() {
    let driver = rpc_driver(true).await;
    let pg = params("jdbc:postgresql://localhost/one");
    let mysql = params("jdbc:mysql://localhost/two");
    let (one, two) = tokio::join!(driver.for_connection(&pg), driver.for_connection(&mysql));
    let one = one.unwrap().unwrap();
    let two = two.unwrap().unwrap();
    assert!(one.manifest().capabilities.schemas);
    assert!(!two.manifest().capabilities.schemas);
    assert_eq!(
        one.manifest().capabilities.sql_dialect,
        Some(SqlDialect::Postgres)
    );
    assert_eq!(
        two.manifest().capabilities.sql_dialect,
        Some(SqlDialect::Mysql)
    );
    assert_eq!(one.get_data_types()[0].name, "JSONB");
    assert_eq!(two.get_data_types()[0].name, "JSON");
    assert_eq!(one.map_inferred_type("json"), "JSONB");
    assert_eq!(driver.get_data_types()[0].name, "TEXT");
    assert_eq!(
        one.get_create_table_sql("example", Vec::new(), None)
            .await
            .unwrap(),
        [pg.connection_uri.clone().unwrap()]
    );
    assert_eq!(
        two.get_create_table_sql("example", Vec::new(), None)
            .await
            .unwrap(),
        [mysql.connection_uri.clone().unwrap()]
    );
    // The command supplies saved parameters; discovery resolved the runtime URI.
    let unresolved = ConnectionParams::default();
    assert_eq!(
        one.get_create_foreign_key_sql(
            &unresolved,
            "example",
            "fk",
            "parent_id",
            "parent",
            "id",
            None,
            None,
            None,
        )
        .await
        .unwrap(),
        [pg.connection_uri.clone().unwrap()]
    );
    let args: Vec<RoutineCallArg> = Vec::new();
    let sql = two
        .build_routine_call_sql(&mysql, "example", "PROCEDURE", &args, None)
        .await
        .unwrap();
    assert!(sql.contains("`example`"), "{sql}");
    driver.shutdown().await;
}

#[tokio::test]
async fn concurrent_discovery_is_shared_and_reconnect_refreshes() {
    let driver = rpc_driver(true).await;
    let params = params("jdbc:postgresql://localhost/one");
    let (a, b) = tokio::join!(
        driver.for_connection(&params),
        driver.for_connection(&params)
    );
    a.unwrap();
    b.unwrap();
    assert_eq!(driver.get_databases(&params).await.unwrap(), ["1"]);
    driver
        .invalidate_connection_metadata(params.connection_id.as_deref())
        .await;
    driver.for_connection(&params).await.unwrap();
    assert_eq!(driver.get_databases(&params).await.unwrap(), ["2"]);
    driver.shutdown().await;
}

#[tokio::test]
async fn only_remote_method_not_found_falls_back() {
    let driver = rpc_driver(true).await;
    let mut params = params("jdbc:postgresql://localhost/one");
    params.extra.insert("case".into(), "missing".into());
    let snapshot = driver.for_connection(&params).await.unwrap().unwrap();
    assert_eq!(snapshot.get_data_types()[0].name, "TEXT");
    for case in ["failure", "malformed", "null"] {
        params.extra.insert("case".into(), case.into());
        assert!(driver.for_connection(&params).await.is_err(), "{case}");
    }
    // Failures are retried, rather than poisoning the cache with defaults.
    driver.for_connection(&params).await.err().unwrap();
    assert_eq!(driver.get_databases(&params).await.unwrap(), ["5"]);
    driver.shutdown().await;
}
