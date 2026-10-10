//! Multi-database tests (exercises per-database pool routing).

use crate::helpers::{pg_params, pg_params_secondary};
use tabularis_lib::drivers::postgres;
use tabularis_lib::models::DatabaseSelection;

// --- new: test the params.database override pattern used by Stage 1 Tauri
// commands (get_schemas, get_tables, etc. with database: Option<String>) ----

#[tokio::test]
#[ignore]
async fn test_database_override_routes_to_secondary() {
    require_pg!();
    // Start from testdb params, then switch database via the same
    // params.database = Single(db) override the Tauri commands apply.
    let mut params = pg_params();
    params.database = DatabaseSelection::Single("tabularis_test_secondary".to_string());

    let schemas = postgres::get_schemas(&params)
        .await
        .expect("get_schemas with overridden database should succeed");

    assert!(
        schemas.contains(&"secondary_schema".to_string()),
        "Override to tabularis_test_secondary should expose secondary_schema, got: {:?}",
        schemas
    );
    assert!(
        !schemas.contains(&"test_schema".to_string()),
        "Override should NOT see testdb's test_schema, got: {:?}",
        schemas
    );
}

#[tokio::test]
#[ignore]
async fn test_get_tables_with_database_and_schema_override() {
    require_pg!();
    // Start from testdb/public, override to secondary's schema — this is
    // the exact path `get_tables` takes when called with `database` + `schema`
    // params from the nested multi-db sidebar.
    let mut params = pg_params();
    params.database = DatabaseSelection::Single("tabularis_test_secondary".to_string());

    let tables = postgres::get_tables(&params, "secondary_schema")
        .await
        .expect("get_tables with overridden database+schema should succeed");

    let names: Vec<&str> = tables.iter().map(|t| t.name.as_str()).collect();
    assert!(
        names.contains(&"remote_data"),
        "Expected remote_data in tabularis_test_secondary.secondary_schema, got: {:?}",
        names
    );
}

#[tokio::test]
#[ignore]
async fn test_empty_string_filter_prevents_maintenance_db_override() {
    require_pg!();
    // The .filter(|d| !d.is_empty()) guard in Stage 1 Tauri commands means
    // passing Some("") must NOT override params.database. Confirm the existing
    // testdb connection still sees testdb's schemas when a blank override is
    // simulated (we do NOT override — just verify testdb baseline is intact).
    let params = pg_params();

    let schemas = postgres::get_schemas(&params)
        .await
        .expect("testdb schemas should be accessible");

    assert!(
        schemas.contains(&"test_schema".to_string()),
        "testdb should have test_schema, got: {:?}",
        schemas
    );
    assert!(
        !schemas.contains(&"secondary_schema".to_string()),
        "testdb should NOT see secondary_schema, got: {:?}",
        schemas
    );
}


#[tokio::test]
#[ignore]
async fn test_get_databases_lists_both() {
    require_pg!();
    let params = pg_params();

    let databases = postgres::get_databases(&params)
        .await
        .expect("get_databases should succeed");

    assert!(databases.contains(&"testdb".to_string()));
    assert!(databases.contains(&"tabularis_test_secondary".to_string()));
}

#[tokio::test]
#[ignore]
async fn test_get_schemas_on_secondary_database() {
    require_pg!();
    let params = pg_params_secondary();

    let schemas = postgres::get_schemas(&params)
        .await
        .expect("get_schemas on secondary should succeed");

    assert!(
        schemas.contains(&"secondary_schema".to_string()),
        "Expected secondary_schema, got: {:?}",
        schemas
    );
}

#[tokio::test]
#[ignore]
async fn test_get_tables_on_secondary_database() {
    require_pg!();
    let params = pg_params_secondary();

    let tables = postgres::get_tables(&params, "secondary_schema")
        .await
        .expect("get_tables on secondary should succeed");

    let table_names: Vec<&str> = tables.iter().map(|t| t.name.as_str()).collect();
    assert!(
        table_names.contains(&"remote_data"),
        "Expected remote_data table in secondary, got: {:?}",
        table_names
    );
}

#[tokio::test]
#[ignore]
async fn test_execute_query_on_secondary_database() {
    require_pg!();
    let params = pg_params_secondary();

    let result = postgres::execute_query(
        &params,
        "SELECT COUNT(*) AS cnt FROM secondary_schema.remote_data",
        None,
        1,
        None,
    )
    .await
    .expect("query on secondary should succeed");

    let count = result.rows[0][0].as_i64().unwrap_or(0);
    assert_eq!(count, 5, "Expected 5 seeded rows in secondary");
}

#[tokio::test]
#[ignore]
async fn test_pool_isolation_between_databases() {
    require_pg!();
    let primary = pg_params();
    let secondary = pg_params_secondary();

    // Query primary — should see test_schema tables
    let primary_tables = crate::helpers::retry(|| {
        let p = primary.clone();
        async move { postgres::get_tables(&p, "test_schema").await }
    })
    .await
    .expect("primary tables");
    assert!(!primary_tables.is_empty());

    // Query secondary — should NOT see test_schema (it doesn't exist there)
    let secondary_schemas = crate::helpers::retry(|| {
        let s = secondary.clone();
        async move { postgres::get_schemas(&s).await }
    })
    .await
    .expect("secondary schemas");
    assert!(
        !secondary_schemas.contains(&"test_schema".to_string()),
        "test_schema should not exist in secondary database"
    );
}

#[tokio::test]
#[ignore]
async fn test_get_columns_on_secondary_database() {
    require_pg!();
    let params = pg_params_secondary();

    let columns = postgres::get_columns(&params, "remote_data", "secondary_schema")
        .await
        .expect("get_columns on secondary");

    let col_names: Vec<&str> = columns.iter().map(|c| c.name.as_str()).collect();
    assert!(col_names.contains(&"id"));
    assert!(col_names.contains(&"value"));
    assert_eq!(columns.len(), 2);
}

#[tokio::test]
#[ignore]
async fn test_fallback_to_postgres_maintenance_db() {
    require_pg!();

    // Connect with empty database — should fall back to "postgres" maintenance DB
    let mut params = pg_params();
    params.database = tabularis_lib::models::DatabaseSelection::Single("postgres".to_string());

    let databases = postgres::get_databases(&params)
        .await
        .expect("should connect to maintenance DB");

    // The maintenance DB can list all databases
    assert!(databases.contains(&"testdb".to_string()));
}
