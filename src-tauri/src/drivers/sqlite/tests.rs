use super::explain::{build_sqlite_tree, parse_sqlite_detail};
use super::{alter_view, create_view, drop_view, get_view_columns, get_view_definition, get_views};
use crate::models::{ConnectionParams, DatabaseSelection};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use tempfile::NamedTempFile;

async fn setup_test_db() -> (ConnectionParams, NamedTempFile) {
    let file = NamedTempFile::new().expect("Failed to create temp file");
    let path = file
        .path()
        .to_str()
        .expect("temp path should be UTF-8")
        .to_string();

    let params = ConnectionParams {
        driver: "sqlite".to_string(),
        database: DatabaseSelection::Single(path.clone()),
        host: None,
        port: None,
        username: None,
        password: None,
        ssl_mode: None,
        ssl_ca: None,
        ssl_cert: None,
        ssl_key: None,
        ssh_enabled: None,
        ssh_connection_id: None,
        ssh_host: None,
        ssh_port: None,
        ssh_user: None,
        ssh_password: None,
        ssh_key_file: None,
        ssh_key_passphrase: None,
        save_in_keychain: None,
        connection_id: None,
        ..Default::default()
    };

    // Initialize DB with a table
    // Use .filename() to handle Windows paths correctly (avoids backslash issues in URLs)
    let options = SqliteConnectOptions::new()
        .filename(&path)
        .create_if_missing(true);

    let pool = SqlitePoolOptions::new()
        .connect_with(options)
        .await
        .expect("Failed to connect to test DB");

    sqlx::query("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)")
        .execute(&pool)
        .await
        .expect("Failed to create table");

    sqlx::query("INSERT INTO users (name) VALUES ('Alice'), ('Bob')")
        .execute(&pool)
        .await
        .expect("Failed to insert data");

    // Close this pool so the file isn't locked (though SQLite handles concurrent reads usually)
    pool.close().await;

    // We return the file handle too so it doesn't get deleted until the test ends
    (params, file)
}

#[test]
fn test_parse_sqlite_detail_search_with_primary_key() {
    let (node_type, relation, index_condition) =
        parse_sqlite_detail("SEARCH users USING INTEGER PRIMARY KEY (rowid=?)");

    assert_eq!(node_type, "Search");
    assert_eq!(relation.as_deref(), Some("users"));
    assert_eq!(index_condition.as_deref(), Some("PRIMARY KEY"));
}

#[test]
fn test_parse_sqlite_detail_scan_with_covering_index() {
    let (node_type, relation, index_condition) =
        parse_sqlite_detail("SCAN users USING COVERING INDEX idx_users_name");

    assert_eq!(node_type, "Scan");
    assert_eq!(relation.as_deref(), Some("users"));
    assert_eq!(index_condition.as_deref(), Some("idx_users_name"));
}

#[test]
fn test_build_sqlite_tree_nested_entries() {
    let entries = vec![
        (0, 0, "SCAN users".to_string()),
        (
            1,
            0,
            "SEARCH posts USING INDEX idx_posts_user_id".to_string(),
        ),
        (2, 1, "USE TEMP B-TREE FOR ORDER BY".to_string()),
    ];

    let mut counter = 0;
    let root = build_sqlite_tree(&entries, 0, &mut counter);

    assert_eq!(root.node_type, "Scan");
    assert_eq!(root.relation.as_deref(), Some("users"));
    assert_eq!(root.children.len(), 1);
    assert_eq!(root.children[0].node_type, "Search");
    assert_eq!(root.children[0].relation.as_deref(), Some("posts"));
    assert_eq!(
        root.children[0].index_condition.as_deref(),
        Some("idx_posts_user_id")
    );
    assert_eq!(root.children[0].children.len(), 1);
    assert_eq!(root.children[0].children[0].node_type, "Sort");
}

#[tokio::test]
async fn test_view_lifecycle() {
    let (params, _file) = setup_test_db().await;

    // 1. Create View
    let view_name = "view_users";
    // Note: SQLite view definitions are stored as written
    let definition = "SELECT name FROM users";
    create_view(&params, view_name, definition)
        .await
        .expect("Failed to create view");

    // 2. Get Views
    let views = get_views(&params).await.expect("Failed to get views");
    assert_eq!(views.len(), 1);
    assert_eq!(views[0].name, view_name);

    // 3. Get View Definition
    let def = get_view_definition(&params, view_name)
        .await
        .expect("Failed to get definition");
    // SQLite stores the full "CREATE VIEW ..." statement in 'sql' column usually,
    // OR just the definition depending on normalization.
    // The get_view_definition implementation returns 'sql' column from sqlite_master.
    // It usually is "CREATE VIEW view_users AS SELECT name FROM users"
    assert!(def.to_uppercase().contains("CREATE VIEW"));
    assert!(def.to_uppercase().contains("SELECT NAME FROM USERS"));

    // 4. Get View Columns
    let cols = get_view_columns(&params, view_name)
        .await
        .expect("Failed to get columns");
    assert_eq!(cols.len(), 1);
    assert_eq!(cols[0].name, "name");

    // 5. Alter View (Drop & Recreate)
    let new_def = "SELECT id, name FROM users";
    alter_view(&params, view_name, new_def)
        .await
        .expect("Failed to alter view");

    let cols_after = get_view_columns(&params, view_name)
        .await
        .expect("Failed to get columns after alter");
    assert_eq!(cols_after.len(), 2);

    // 6. Drop View
    drop_view(&params, view_name)
        .await
        .expect("Failed to drop view");
    let views_final = get_views(&params).await.expect("Failed to get views final");
    assert_eq!(views_final.len(), 0);

    // Cleanup: Close the pool created by the functions (via pool_manager)
    crate::pool_manager::close_pool(&params).await;
}

// --- Trait default fallback: composite-PK delegation (issue #145) ---------
//
// The default `delete_record_composite` / `update_record_composite` impls in
// `DatabaseDriver` are supposed to forward to the legacy single-key methods
// when `pk_cols.len() == 1`, so MySQL / Postgres / SQLite keep working
// without overriding anything. We exercise that contract here against the
// real SQLite driver — if the fallback ever stops calling through, these
// tests will catch the regression.

#[tokio::test]
async fn composite_delete_single_key_falls_back_to_single_key_path() {
    use crate::drivers::driver_trait::DatabaseDriver;
    use crate::drivers::sqlite::SqliteDriver;

    let (params, _file) = setup_test_db().await;
    let drv = SqliteDriver::new();

    let affected = drv
        .delete_record_composite(
            &params,
            "users",
            &["id".to_string()],
            vec![serde_json::json!(1)],
            None,
        )
        .await
        .expect("composite delete with single PK should delegate to delete_record");
    assert_eq!(affected, 1, "exactly one row should be deleted via fallback");

    let drv2 = SqliteDriver::new();
    let rows = drv2
        .execute_query(&params, "SELECT id FROM users ORDER BY id", None, 0, None)
        .await
        .expect("select after delete");
    let remaining: Vec<i64> = rows
        .rows
        .iter()
        .filter_map(|row| row.first().and_then(|v| v.as_i64()))
        .collect();
    assert_eq!(remaining, vec![2], "only Bob (id=2) should remain");

    crate::pool_manager::close_pool(&params).await;
}

#[tokio::test]
async fn composite_update_single_key_falls_back_to_single_key_path() {
    use crate::drivers::driver_trait::DatabaseDriver;
    use crate::drivers::sqlite::SqliteDriver;

    let (params, _file) = setup_test_db().await;
    let drv = SqliteDriver::new();

    let affected = drv
        .update_record_composite(
            &params,
            "users",
            &["id".to_string()],
            vec![serde_json::json!(2)],
            "name",
            serde_json::json!("Robert"),
            None,
            1024 * 1024,
        )
        .await
        .expect("composite update with single PK should delegate to update_record");
    assert_eq!(affected, 1, "exactly one row should be updated via fallback");

    let drv2 = SqliteDriver::new();
    let rows = drv2
        .execute_query(
            &params,
            "SELECT name FROM users WHERE id = 2",
            None,
            0,
            None,
        )
        .await
        .expect("select after update");
    let name = rows
        .rows
        .first()
        .and_then(|row| row.first())
        .and_then(|v| v.as_str())
        .map(str::to_string);
    assert_eq!(name.as_deref(), Some("Robert"));

    crate::pool_manager::close_pool(&params).await;
}

#[tokio::test]
async fn composite_delete_real_composite_returns_descriptive_error() {
    use crate::drivers::driver_trait::DatabaseDriver;
    use crate::drivers::sqlite::SqliteDriver;

    let (params, _file) = setup_test_db().await;
    let drv = SqliteDriver::new();

    let err = drv
        .delete_record_composite(
            &params,
            "users",
            &["a".to_string(), "b".to_string()],
            vec![serde_json::json!(1), serde_json::json!(2)],
            None,
        )
        .await
        .expect_err("driver without override must reject genuine composite PKs");
    assert!(
        err.to_lowercase().contains("composite"),
        "error should mention composite PKs, got: {err}"
    );

    crate::pool_manager::close_pool(&params).await;
}

#[tokio::test]
async fn composite_update_real_composite_returns_descriptive_error() {
    use crate::drivers::driver_trait::DatabaseDriver;
    use crate::drivers::sqlite::SqliteDriver;

    let (params, _file) = setup_test_db().await;
    let drv = SqliteDriver::new();

    let err = drv
        .update_record_composite(
            &params,
            "users",
            &["a".to_string(), "b".to_string()],
            vec![serde_json::json!(1), serde_json::json!(2)],
            "name",
            serde_json::json!("x"),
            None,
            1024 * 1024,
        )
        .await
        .expect_err("driver without override must reject genuine composite PKs");
    assert!(
        err.to_lowercase().contains("composite"),
        "error should mention composite PKs, got: {err}"
    );

    crate::pool_manager::close_pool(&params).await;
}

#[tokio::test]
async fn composite_pk_cols_pk_vals_length_mismatch_errors() {
    use crate::drivers::driver_trait::DatabaseDriver;
    use crate::drivers::sqlite::SqliteDriver;

    let (params, _file) = setup_test_db().await;
    let drv = SqliteDriver::new();

    let err = drv
        .delete_record_composite(
            &params,
            "users",
            &["id".to_string(), "name".to_string()],
            vec![serde_json::json!(1)],
            None,
        )
        .await
        .expect_err("length mismatch must surface as an error");
    assert!(
        err.contains("length mismatch"),
        "expected length-mismatch error, got: {err}"
    );

    crate::pool_manager::close_pool(&params).await;
}
