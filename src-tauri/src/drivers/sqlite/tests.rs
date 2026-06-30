use super::explain::{build_sqlite_tree, parse_sqlite_detail};
use super::sqlite_push_pk_where;
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

mod sqlite_push_pk_where_tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn single_column_generates_correct_predicate() {
        let mut pk_map = HashMap::new();
        pk_map.insert("id".to_string(), serde_json::json!(42));
        let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new("");
        sqlite_push_pk_where(&mut qb, &pk_map).unwrap();
        assert_eq!(qb.sql(), "\"id\" = ?");
    }

    #[test]
    fn composite_pk_columns_are_sorted_alphabetically() {
        let mut pk_map = HashMap::new();
        pk_map.insert("z_col".to_string(), serde_json::json!(1));
        pk_map.insert("a_col".to_string(), serde_json::json!(2));
        let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new("");
        sqlite_push_pk_where(&mut qb, &pk_map).unwrap();
        assert_eq!(qb.sql(), "\"a_col\" = ? AND \"z_col\" = ?");
    }

    #[test]
    fn empty_pk_map_is_rejected() {
        let pk_map: HashMap<String, serde_json::Value> = HashMap::new();
        let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new("");
        assert!(sqlite_push_pk_where(&mut qb, &pk_map).is_err());
    }

    #[test]
    fn double_quote_in_column_name_is_escaped() {
        let mut pk_map = HashMap::new();
        pk_map.insert("a\"b".to_string(), serde_json::json!(1));
        let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new("");
        sqlite_push_pk_where(&mut qb, &pk_map).unwrap();
        assert_eq!(qb.sql(), "\"a\"\"b\" = ?");
    }
}
