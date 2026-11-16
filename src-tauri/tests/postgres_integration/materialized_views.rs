//! Materialized view tests.

use crate::helpers::pg_params;
use tabularis_lib::drivers::postgres;

#[tokio::test]
#[ignore]
async fn test_get_materialized_views() {
    require_pg!();
    let params = pg_params();

    let mvs = postgres::get_materialized_views(&params, "test_schema")
        .await
        .expect("get_materialized_views should succeed");

    let mv_names: Vec<&str> = mvs.iter().map(|v| v.name.as_str()).collect();
    assert!(
        mv_names.contains(&"user_stats"),
        "Expected user_stats MV, got: {:?}",
        mv_names
    );
}

#[tokio::test]
#[ignore]
async fn test_get_materialized_view_columns() {
    require_pg!();
    let params = pg_params();

    let columns = postgres::get_materialized_view_columns(&params, "user_stats", "test_schema")
        .await
        .expect("get_materialized_view_columns should succeed");

    let col_names: Vec<&str> = columns.iter().map(|c| c.name.as_str()).collect();
    assert!(col_names.contains(&"total"), "Expected total column");
    assert!(col_names.contains(&"max_id"), "Expected max_id column");
}

#[tokio::test]
#[ignore]
async fn test_get_materialized_view_definition() {
    require_pg!();
    let params = pg_params();

    let definition =
        postgres::get_materialized_view_definition(&params, "user_stats", "test_schema")
            .await
            .expect("get_materialized_view_definition should succeed");

    assert!(
        definition.contains("CREATE MATERIALIZED VIEW"),
        "Expected CREATE MATERIALIZED VIEW in definition, got: {}",
        definition
    );
}

#[tokio::test]
#[ignore]
async fn test_get_materialized_view_definition_rejects_regular_view() {
    require_pg!();
    let params = pg_params();

    // `active_users` is a regular view (relkind = 'v'), not a materialized
    // view. Passing it to get_materialized_view_definition must error instead
    // of returning the regular view's DDL labeled as a materialized view.
    let result =
        postgres::get_materialized_view_definition(&params, "active_users", "test_schema").await;
    assert!(
        result.is_err(),
        "get_materialized_view_definition should reject a regular view name, \
         but it returned: {:?}",
        result
    );
}

#[tokio::test]
#[ignore]
async fn test_refresh_materialized_view() {
    require_pg!();
    let params = pg_params();

    // Refresh should succeed without error
    postgres::refresh_materialized_view(&params, "user_stats", "test_schema")
        .await
        .expect("refresh_materialized_view should succeed");

    // Verify the MV still has data after refresh
    let result = postgres::execute_query(
        &params,
        "SELECT total FROM test_schema.user_stats",
        None,
        1,
        None,
    )
    .await
    .expect("SELECT from MV should work after refresh");

    assert_eq!(result.rows.len(), 1);
    // total should be >= 2 (we seeded 2 rows in all_types)
    let total = result.rows[0][0].as_i64().unwrap_or(0);
    assert!(total >= 2, "Expected total >= 2, got: {}", total);
}
