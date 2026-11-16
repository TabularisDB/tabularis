use super::*;

#[test]
fn protected_pool_keys_are_isolated_and_disconnect_collects_both_policies() {
    let params = ConnectionParams {
        driver: "sqlite".into(),
        database: crate::models::DatabaseSelection::Single("db".into()),
        ..Default::default()
    };
    let ordinary_key = build_connection_key(&params, Some("test"));
    let mut protected = params.clone();
    protected.read_only = true;
    protected.startup_script = Some("DELETE FROM items".into());
    let protected_key = build_connection_key(&protected, Some("test"));
    assert_eq!(protected_key, format!("read_only:{ordinary_key}"));
    assert!(startup_script(&protected).is_none());
    let mut pools = HashMap::from([
        (ordinary_key, 1),
        (protected_key, 2),
        ("sqlite:conn:another:db".into(), 3),
    ]);
    let removed = remove_pools_with_prefix(&mut pools, &connection_pool_prefix("sqlite", "test"));
    assert_eq!(removed.len(), 2);
    assert_eq!(pools.len(), 1);
}

#[test]
fn postgres_read_only_is_installed_before_the_first_query() {
    let params = ConnectionParams {
        driver: "postgres".into(),
        read_only: true,
        ..Default::default()
    };
    let config = build_postgres_configurations(&params).unwrap();
    assert_eq!(
        config.get_options(),
        Some("-c default_transaction_read_only=on")
    );
    let config = build_postgres_configurations(&ConnectionParams {
        read_only: false,
        ..params
    })
    .unwrap();
    assert_eq!(config.get_options(), None);
}

#[tokio::test]
async fn sqlite_read_only_pool_protects_internal_reads_and_never_contaminates_writable_pools() {
    let temp = tempfile::NamedTempFile::new().unwrap();
    let params = ConnectionParams {
        driver: "sqlite".into(),
        database: crate::models::DatabaseSelection::Single(
            temp.path().to_string_lossy().into_owned(),
        ),
        ..Default::default()
    };
    let writable = get_sqlite_pool(&params).await.unwrap();
    sqlx::query("CREATE TABLE items (id INTEGER)")
        .execute(&writable)
        .await
        .unwrap();
    let mut protected = params.clone();
    protected.read_only = true;
    protected.startup_script = Some("INSERT INTO items VALUES (99)".into());
    let readonly = get_sqlite_pool(&protected).await.unwrap();
    assert!(sqlx::query("INSERT INTO items VALUES (1)")
        .execute(&readonly)
        .await
        .is_err());
    crate::drivers::sqlite::execute_read_only_query(&protected, "SELECT * FROM items", None, 1)
        .await
        .unwrap();
    let query_only: i64 = sqlx::query_scalar("PRAGMA query_only")
        .fetch_one(&readonly)
        .await
        .unwrap();
    assert_eq!(query_only, 1);
    sqlx::query("INSERT INTO items VALUES (2)")
        .execute(&writable)
        .await
        .unwrap();
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM items")
        .fetch_one(&readonly)
        .await
        .unwrap();
    assert_eq!(count, 1);
    readonly.close().await;
    writable.close().await;
}
