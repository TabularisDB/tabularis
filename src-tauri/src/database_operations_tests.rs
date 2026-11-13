use super::*;
use crate::drivers::driver_trait::DatabaseDriver;

#[test]
fn operations_are_independent_opt_ins_and_readonly_overrides_them() {
    let mut caps = crate::drivers::mysql::MysqlDriver::new()
        .manifest()
        .capabilities
        .clone();
    caps.empty_database = false;
    assert!(!DatabaseOperation::Empty.supported(&caps));
    assert!(DatabaseOperation::Truncate.supported(&caps));
    assert!(DatabaseOperation::Drop.supported(&caps));
    caps.readonly = true;
    assert!(!DatabaseOperation::Drop.supported(&caps));
    assert!(!DatabaseOperation::Truncate.supported(&caps));
}

#[test]
fn targets_and_operations_are_strict() {
    for name in ["", "mysql", "MySQL", "db\0other"] {
        assert!(validate_database(name, &["mysql"]).is_err());
    }
    assert!(validate_database("quoted\"` db", &["mysql"]).is_ok());
    assert!(serde_json::from_str::<DatabaseOperation>("\"drop table\"").is_err());
}

#[tokio::test]
async fn sqlite_operations_preserve_the_file_and_truncate_keeps_structure() {
    let file = tempfile::NamedTempFile::new().unwrap();
    let params: crate::models::ConnectionParams = serde_json::from_value(serde_json::json!({
        "driver":"sqlite", "database":file.path().to_str().unwrap()
    }))
    .unwrap();
    let driver = crate::drivers::sqlite::SqliteDriver::new();
    let pool = crate::pool_manager::get_sqlite_pool(&params).await.unwrap();
    sqlx::raw_sql("CREATE TABLE parent (id INTEGER PRIMARY KEY AUTOINCREMENT); CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id)); CREATE VIEW items AS SELECT * FROM parent; INSERT INTO parent DEFAULT VALUES; INSERT INTO child VALUES (1,1);")
        .execute(&pool).await.unwrap();
    driver
        .database_operation(&params, DatabaseOperation::Truncate)
        .await
        .unwrap();
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM parent")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
    let child_count: i64 = sqlx::query_scalar("SELECT count(*) FROM child")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(child_count, 0);
    sqlx::query("INSERT INTO parent DEFAULT VALUES")
        .execute(&pool)
        .await
        .unwrap();
    let id: i64 = sqlx::query_scalar("SELECT id FROM parent")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(id, 1);
    driver
        .database_operation(&params, DatabaseOperation::Empty)
        .await
        .unwrap();
    let objects: i64 =
        sqlx::query_scalar("SELECT count(*) FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(objects, 0);
    assert!(file.path().exists());
    assert!(driver
        .database_operation(&params, DatabaseOperation::Drop)
        .await
        .is_err());
    assert!(file.path().exists());
    crate::pool_manager::close_pool(&params).await;
}

#[tokio::test]
async fn plugin_operations_require_capabilities_and_forward_the_bound_target() {
    use crate::plugins::driver::{test_driver_with_manifest, test_manifest};
    let mut manifest = test_manifest();
    let disabled = test_driver_with_manifest(manifest.clone(), |_| {
        panic!("unsupported operation must not call RPC")
    });
    let params = crate::models::ConnectionParams {
        database: crate::models::DatabaseSelection::Single("quoted db".into()),
        ..Default::default()
    };
    assert!(disabled
        .database_operation(&params, DatabaseOperation::Drop)
        .await
        .is_err());
    manifest.capabilities.drop_database = true;
    let enabled = test_driver_with_manifest(manifest, |request| {
        assert_eq!(request.method, "database_operation");
        assert_eq!(request.params["operation"], "drop");
        assert_eq!(request.params["params"]["database"], "quoted db");
        Ok(serde_json::Value::Null)
    });
    enabled
        .database_operation(&params, DatabaseOperation::Drop)
        .await
        .unwrap();
    assert!(enabled
        .database_operation(&params, DatabaseOperation::Empty)
        .await
        .is_err());
}

#[test]
fn legacy_plugin_manifests_do_not_enable_destructive_operations() {
    let caps: crate::drivers::driver_trait::DriverCapabilities = serde_json::from_value(
        serde_json::json!({"schemas":false,"views":false,"routines":false,"file_based":false}),
    )
    .unwrap();
    for op in [
        DatabaseOperation::Drop,
        DatabaseOperation::Truncate,
        DatabaseOperation::Empty,
    ] {
        assert!(!op.supported(&caps));
    }
}

#[tokio::test]
async fn sqlite_trigger_failure_rolls_back_all_tables() {
    let file = tempfile::NamedTempFile::new().unwrap();
    let params = crate::models::ConnectionParams {
        driver: "sqlite".into(),
        database: crate::models::DatabaseSelection::Single(file.path().to_str().unwrap().into()),
        ..Default::default()
    };
    let pool = crate::pool_manager::get_sqlite_pool(&params).await.unwrap();
    sqlx::raw_sql("CREATE TABLE a (id INTEGER PRIMARY KEY); CREATE TABLE b (id INTEGER PRIMARY KEY); INSERT INTO a VALUES(1); INSERT INTO b VALUES(1); CREATE TRIGGER stop_delete BEFORE DELETE ON b BEGIN SELECT RAISE(ABORT, 'blocked'); END;").execute(&pool).await.unwrap();
    let driver = crate::drivers::sqlite::SqliteDriver::new();
    assert!(driver
        .database_operation(&params, DatabaseOperation::Truncate)
        .await
        .is_err());
    for table in ["a", "b"] {
        let count: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM {table}"))
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1);
    }
    crate::pool_manager::close_pool(&params).await;
}
