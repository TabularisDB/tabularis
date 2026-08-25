use super::sqlite_push_pk_where;
use super::{
    alter_view, create_view, drop_view, get_all_columns_batch, get_columns, get_indexes,
    get_view_columns, get_view_definition, get_views, insert_record, parse_sqlite_index_columns,
    update_record,
};
use crate::models::{ConnectionParams, DatabaseSelection};
use std::collections::HashMap;
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
fn test_parse_sqlite_index_columns() {
    assert_eq!(
        parse_sqlite_index_columns("CREATE INDEX i ON t (a, b, c)"),
        vec!["a", "b", "c"]
    );
    assert_eq!(
        parse_sqlite_index_columns("CREATE INDEX i ON t (lower(email))"),
        vec!["lower(email)"]
    );
    // Commas inside a function call are not split points.
    assert_eq!(
        parse_sqlite_index_columns("CREATE UNIQUE INDEX i ON t (id, coalesce(a, b), name)"),
        vec!["id", "coalesce(a, b)", "name"]
    );
    // A partial-index WHERE clause is not part of the column list.
    assert_eq!(
        parse_sqlite_index_columns("CREATE INDEX i ON t (a) WHERE a > 0"),
        vec!["a"]
    );
    // A parenthesis inside a quoted table name is not mistaken for the list.
    assert_eq!(
        parse_sqlite_index_columns("CREATE INDEX i ON \"weird(tbl\" (a, b)"),
        vec!["a", "b"]
    );
    assert!(parse_sqlite_index_columns("not an index statement").is_empty());
}

#[tokio::test]
async fn test_get_indexes_includes_expression_indexes() {
    let (params, _file) = setup_test_db().await;

    let path = params.database.primary().to_string();
    let options = SqliteConnectOptions::new().filename(&path);
    let pool = SqlitePoolOptions::new()
        .connect_with(options)
        .await
        .expect("connect to test DB");
    for stmt in [
        "CREATE INDEX idx_name ON users (name)",
        "CREATE INDEX idx_lower_name ON users (lower(name))",
        "CREATE INDEX idx_mixed ON users (id, lower(name))",
    ] {
        sqlx::query(stmt)
            .execute(&pool)
            .await
            .expect("create index");
    }
    pool.close().await;

    let indexes = get_indexes(&params, "users")
        .await
        .expect("get_indexes should succeed");

    let find = |name: &str, seq: i32| {
        indexes
            .iter()
            .find(|i| i.name == name && i.seq_in_index == seq)
            .unwrap_or_else(|| panic!("missing index {name} at seq {seq}"))
    };

    // Plain column: rendered as its name, not flagged as an expression.
    let plain = find("idx_name", 0);
    assert_eq!(plain.column_name, "name");
    assert!(!plain.is_expression);

    // All-expression index is present with its expression text.
    let expr = find("idx_lower_name", 0);
    assert_eq!(expr.column_name, "lower(name)");
    assert!(expr.is_expression);

    // Mixed index keeps both the plain column and the expression column.
    let mixed_plain = find("idx_mixed", 0);
    assert_eq!(mixed_plain.column_name, "id");
    assert!(!mixed_plain.is_expression);
    let mixed_expr = find("idx_mixed", 1);
    assert_eq!(mixed_expr.column_name, "lower(name)");
    assert!(mixed_expr.is_expression);
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

#[tokio::test]
async fn test_get_columns_includes_generated_table_columns() {
    let (params, _file) = setup_test_db().await;

    let path = params.database.primary().to_string();
    let options = SqliteConnectOptions::new().filename(&path);
    let pool = SqlitePoolOptions::new()
        .connect_with(options)
        .await
        .expect("connect to test DB");

    sqlx::query(
        "CREATE TABLE generated_dates (
            udate INTEGER,
            display_date TEXT GENERATED ALWAYS AS (date(udate, 'unixepoch', '+12:00')) STORED
        )",
    )
    .execute(&pool)
    .await
    .expect("create generated column table");

    pool.close().await;

    let cols = get_columns(&params, "generated_dates")
        .await
        .expect("get table columns");

    let generated = cols
        .iter()
        .find(|col| col.name == "display_date")
        .expect("generated column should be visible through table metadata");
    assert_eq!(generated.data_type, "TEXT");
    assert!(generated.is_generated);

    let batch = get_all_columns_batch(&params, &["generated_dates".to_string()])
        .await
        .expect("get batch columns");
    let batch_generated = batch["generated_dates"]
        .iter()
        .find(|col| col.name == "display_date")
        .expect("generated column should be visible through batch metadata");
    assert!(batch_generated.is_generated);

    crate::pool_manager::close_pool(&params).await;
}

#[tokio::test]
async fn test_get_columns_excludes_hidden_virtual_table_columns() {
    let (params, _file) = setup_test_db().await;

    let path = params.database.primary().to_string();
    let options = SqliteConnectOptions::new().filename(&path);
    let pool = SqlitePoolOptions::new()
        .connect_with(options)
        .await
        .expect("connect to test DB");

    sqlx::query("CREATE VIRTUAL TABLE docs USING fts5(title, body)")
        .execute(&pool)
        .await
        .expect("create fts5 table");

    pool.close().await;

    let cols = get_columns(&params, "docs")
        .await
        .expect("get virtual table columns");
    let col_names: Vec<&str> = cols.iter().map(|col| col.name.as_str()).collect();
    assert_eq!(col_names, vec!["title", "body"]);

    let batch = get_all_columns_batch(&params, &["docs".to_string()])
        .await
        .expect("get batch columns");
    let batch_col_names: Vec<&str> = batch["docs"]
        .iter()
        .map(|col| col.name.as_str())
        .collect();
    assert_eq!(batch_col_names, vec!["title", "body"]);

    crate::pool_manager::close_pool(&params).await;
}

#[tokio::test]
async fn test_generated_table_columns_are_not_inserted_or_updated() {
    let (params, _file) = setup_test_db().await;

    let path = params.database.primary().to_string();
    let options = SqliteConnectOptions::new().filename(&path);
    let pool = SqlitePoolOptions::new()
        .connect_with(options)
        .await
        .expect("connect to test DB");

    sqlx::query(
        "CREATE TABLE generated_dates (
            id INTEGER PRIMARY KEY,
            udate INTEGER,
            display_date TEXT GENERATED ALWAYS AS (date(udate, 'unixepoch', '+12:00')) STORED
        )",
    )
    .execute(&pool)
    .await
    .expect("create generated column table");

    sqlx::query("INSERT INTO generated_dates (id, udate) VALUES (1, 0)")
        .execute(&pool)
        .await
        .expect("insert base row");

    pool.close().await;

    let mut data = HashMap::new();
    data.insert("udate".to_string(), serde_json::json!(0));
    data.insert(
        "display_date".to_string(),
        serde_json::json!("1970-01-01"),
    );
    let insert_err = insert_record(&params, "generated_dates", data, 1024)
        .await
        .expect_err("generated columns should be rejected on insert");
    assert!(insert_err.contains("Cannot insert into generated column: display_date"));

    let mut pk_map = HashMap::new();
    pk_map.insert("id".to_string(), serde_json::json!(1));
    let update_err = update_record(
        &params,
        "generated_dates",
        &pk_map,
        "display_date",
        serde_json::json!("1970-01-01"),
        1024,
    )
    .await
    .expect_err("generated columns should be rejected on update");
    assert!(update_err.contains("Cannot update generated column: display_date"));

    crate::pool_manager::close_pool(&params).await;
}

mod sqlite_push_pk_where_tests {
    use super::*;

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

    // Keyless tables (#598) identify rows by all comparable columns, so a
    // pk_map entry may legitimately be NULL and must render as IS NULL.
    #[test]
    fn null_value_renders_is_null_without_binding() {
        let mut pk_map = HashMap::new();
        pk_map.insert("a_col".to_string(), serde_json::Value::Null);
        pk_map.insert("b_col".to_string(), serde_json::json!("alice"));
        let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new("");
        sqlite_push_pk_where(&mut qb, &pk_map).unwrap();
        assert_eq!(qb.sql(), "\"a_col\" IS NULL AND \"b_col\" = ?");
    }

    #[test]
    fn bool_value_binds_with_equality() {
        let mut pk_map = HashMap::new();
        pk_map.insert("flag".to_string(), serde_json::json!(true));
        let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new("");
        sqlite_push_pk_where(&mut qb, &pk_map).unwrap();
        assert_eq!(qb.sql(), "\"flag\" = ?");
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
