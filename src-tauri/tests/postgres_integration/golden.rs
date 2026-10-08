//! Golden file capture tests.
//!
//! These tests capture the exact output of every driver method and compare against
//! committed golden files. To regenerate:
//!
//! ```bash
//! REGENERATE_GOLDEN=1 cargo test --test postgres_integration golden -- --include-ignored --test-threads=1
//! ```

use crate::golden_utils::{assert_golden, write_golden};
use crate::helpers::{pg_params, pg_params_secondary};
use tabularis_lib::drivers::driver_trait::DatabaseDriver;
use tabularis_lib::drivers::postgres;
use tabularis_lib::drivers::postgres::PostgresDriver;

#[tokio::test]
#[ignore]
async fn golden_get_schemas() {
    require_pg!();
    let params = pg_params();
    let result = postgres::get_schemas(&params).await.expect("get_schemas");
    write_golden("get_schemas.json", &result);
    assert_golden("get_schemas.json", &result);
}

#[tokio::test]
#[ignore]
async fn golden_get_databases() {
    require_pg!();
    let params = pg_params();
    let result = postgres::get_databases(&params)
        .await
        .expect("get_databases");
    write_golden("get_databases.json", &result);
    assert_golden("get_databases.json", &result);
}

#[tokio::test]
#[ignore]
async fn golden_get_tables() {
    require_pg!();
    let params = pg_params();
    let result = postgres::get_tables(&params, "test_schema")
        .await
        .expect("get_tables");
    write_golden("get_tables.json", &result);
    assert_golden("get_tables.json", &result);
}

#[tokio::test]
#[ignore]
async fn golden_get_columns_all_types() {
    require_pg!();
    let params = pg_params();
    let result = postgres::get_columns(&params, "all_types", "test_schema")
        .await
        .expect("get_columns");
    write_golden("get_columns_all_types.json", &result);
    assert_golden("get_columns_all_types.json", &result);
}

#[tokio::test]
#[ignore]
async fn golden_get_columns_with_enum() {
    require_pg!();
    let params = pg_params();
    let result = postgres::get_columns(&params, "with_enum", "test_schema")
        .await
        .expect("get_columns");
    write_golden("get_columns_with_enum.json", &result);
    assert_golden("get_columns_with_enum.json", &result);
}

#[tokio::test]
#[ignore]
async fn golden_get_indexes() {
    require_pg!();
    let params = pg_params();
    let result = postgres::get_indexes(&params, "all_types", "test_schema")
        .await
        .expect("get_indexes");
    write_golden("get_indexes_all_types.json", &result);
    assert_golden("get_indexes_all_types.json", &result);
}

#[tokio::test]
#[ignore]
async fn golden_get_foreign_keys_orders() {
    require_pg!();
    let params = pg_params();
    let result = postgres::get_foreign_keys(&params, "orders", "test_schema")
        .await
        .expect("get_foreign_keys");
    write_golden("get_foreign_keys_orders.json", &result);
    assert_golden("get_foreign_keys_orders.json", &result);
}

#[tokio::test]
#[ignore]
async fn golden_get_foreign_keys_cross_schema() {
    require_pg!();
    let params = pg_params();
    let result = postgres::get_foreign_keys(&params, "with_cross_schema_fk", "test_schema")
        .await
        .expect("get_foreign_keys");
    write_golden("get_foreign_keys_cross_schema.json", &result);
    assert_golden("get_foreign_keys_cross_schema.json", &result);
}

#[tokio::test]
#[ignore]
async fn golden_get_views() {
    require_pg!();
    let params = pg_params();
    let result = postgres::get_views(&params, "test_schema")
        .await
        .expect("get_views");
    write_golden("get_views.json", &result);
    assert_golden("get_views.json", &result);
}

#[tokio::test]
#[ignore]
async fn golden_get_view_definition() {
    require_pg!();
    let params = pg_params();
    let result = postgres::get_view_definition(&params, "active_users", "test_schema")
        .await
        .expect("get_view_definition");
    write_golden("get_view_definition_active_users.json", &result);
    assert_golden("get_view_definition_active_users.json", &result);
}

#[tokio::test]
#[ignore]
async fn golden_get_materialized_views() {
    require_pg!();
    let params = pg_params();
    let result = postgres::get_materialized_views(&params, "test_schema")
        .await
        .expect("get_materialized_views");
    write_golden("get_materialized_views.json", &result);
    assert_golden("get_materialized_views.json", &result);
}

#[tokio::test]
#[ignore]
async fn golden_get_routines() {
    require_pg!();
    let params = pg_params();
    let result = postgres::get_routines(&params, "test_schema")
        .await
        .expect("get_routines");
    write_golden("get_routines.json", &result);
    assert_golden("get_routines.json", &result);
}

#[tokio::test]
#[ignore]
async fn golden_get_triggers() {
    require_pg!();
    let params = pg_params();
    let result = postgres::get_triggers(&params, "test_schema")
        .await
        .expect("get_triggers");
    write_golden("get_triggers.json", &result);
    assert_golden("get_triggers.json", &result);
}

#[tokio::test]
#[ignore]
async fn golden_execute_query_all_types() {
    require_pg!();
    let params = pg_params();
    let result = postgres::execute_query(
        &params,
        "SELECT * FROM test_schema.all_types WHERE id = 1",
        None,
        1,
        None,
    )
    .await
    .expect("execute_query");
    write_golden("execute_query_all_types.json", &result);
    assert_golden("execute_query_all_types.json", &result);
}

#[tokio::test]
#[ignore]
async fn golden_explain_simple() {
    require_pg!();
    let params = pg_params();
    let result = PostgresDriver::new()
        .explain_query(
            &params,
            "SELECT * FROM test_schema.all_types WHERE id = 1",
            false,
            Some("test_schema"),
        )
        .await
        .expect("explain_query");
    // EXPLAIN output contains volatile cost/width values that change with table
    // statistics, PG version, and row count. Write golden for documentation only;
    // do NOT assert exact match. The structural assertions in explain.rs cover
    // correctness. The plugin parity test should verify the output SHAPE matches
    // (Plan vs Raw variant, key presence) rather than exact numeric values.
    write_golden("explain_simple.json", &result);
}

#[tokio::test]
#[ignore]
async fn golden_multi_db_get_tables_secondary() {
    require_pg!();
    let params = pg_params_secondary();
    let result = postgres::get_tables(&params, "secondary_schema")
        .await
        .expect("get_tables secondary");
    write_golden("multi_db/get_tables_secondary.json", &result);
    assert_golden("multi_db/get_tables_secondary.json", &result);
}

#[tokio::test]
#[ignore]
async fn golden_multi_db_get_schemas_secondary() {
    require_pg!();
    let params = pg_params_secondary();
    let result = postgres::get_schemas(&params)
        .await
        .expect("get_schemas secondary");
    write_golden("multi_db/get_schemas_secondary.json", &result);
    assert_golden("multi_db/get_schemas_secondary.json", &result);
}

// --- Missing golden captures below ---

#[tokio::test]
#[ignore]
async fn golden_get_view_columns_active_users() {
    require_pg!();
    let params = pg_params();
    let result = postgres::get_view_columns(&params, "active_users", "test_schema")
        .await
        .expect("get_view_columns");
    write_golden("get_view_columns_active_users.json", &result);
    assert_golden("get_view_columns_active_users.json", &result);
}

#[tokio::test]
#[ignore]
async fn golden_get_materialized_view_definition() {
    require_pg!();
    let params = pg_params();
    let result =
        postgres::get_materialized_view_definition(&params, "user_stats", "test_schema").await;
    // KNOWN BUG: Built-in driver errors with "error serializing parameter 0" on PG 16
    // due to regclass cast issue. Capture the error as the golden expectation — the
    // plugin must replicate this behavior until the driver is fixed.
    match result {
        Ok(def) => {
            write_golden("get_mv_definition.json", &def);
            assert_golden("get_mv_definition.json", &def);
        }
        Err(ref e) => {
            // Expected failure — record it as the golden expectation
            write_golden("get_mv_definition.json", e);
            assert_golden("get_mv_definition.json", e);
        }
    }
}

#[tokio::test]
#[ignore]
async fn golden_get_materialized_view_columns() {
    require_pg!();
    let params = pg_params();
    let result = postgres::get_materialized_view_columns(&params, "user_stats", "test_schema")
        .await
        .expect("get_materialized_view_columns");
    write_golden("get_mv_columns.json", &result);
    assert_golden("get_mv_columns.json", &result);
}

#[tokio::test]
#[ignore]
async fn golden_get_routine_parameters() {
    require_pg!();
    let params = pg_params();
    let result = postgres::get_routine_parameters(&params, "add_numbers", "test_schema", None)
        .await
        .expect("get_routine_parameters");
    write_golden("get_routine_parameters_add_numbers.json", &result);
    assert_golden("get_routine_parameters_add_numbers.json", &result);
}

#[tokio::test]
#[ignore]
async fn golden_get_routine_definition() {
    require_pg!();
    let params = pg_params();
    let result =
        postgres::get_routine_definition(&params, "add_numbers", "FUNCTION", "test_schema", None)
            .await
            .expect("get_routine_definition");
    write_golden("get_routine_definition_add_numbers.json", &result);
    assert_golden("get_routine_definition_add_numbers.json", &result);
}

#[tokio::test]
#[ignore]
async fn golden_get_trigger_definition() {
    require_pg!();
    let params = pg_params();
    let result = postgres::get_trigger_definition(&params, "trg_audit", "all_types", "test_schema")
        .await
        .expect("get_trigger_definition");
    write_golden("get_trigger_definition_audit.json", &result);
    assert_golden("get_trigger_definition_audit.json", &result);
}

#[tokio::test]
#[ignore]
async fn golden_execute_query_with_pagination() {
    require_pg!();
    let params = pg_params();
    let result = postgres::execute_query(
        &params,
        "SELECT id, col_text FROM test_schema.all_types ORDER BY id",
        Some(2),
        1,
        Some("test_schema"),
    )
    .await
    .expect("execute_query with pagination");
    write_golden("execute_query_with_pagination.json", &result);
    assert_golden("execute_query_with_pagination.json", &result);
}

#[tokio::test]
#[ignore]
async fn golden_explain_analyze() {
    require_pg!();
    let params = pg_params();
    let result = postgres::explain_query(
        &params,
        "SELECT * FROM test_schema.all_types WHERE id = 1",
        true,
        Some("test_schema"),
    )
    .await
    .expect("explain_query with analyze");
    // EXPLAIN ANALYZE output contains volatile timing and buffer values.
    // Write for documentation; do NOT assert exact match.
    write_golden("explain_analyze.json", &result);
}

#[tokio::test]
#[ignore]
async fn golden_count_query() {
    require_pg!();
    let params = pg_params();
    let result = postgres::execute_query(
        &params,
        "SELECT COUNT(*) AS cnt FROM test_schema.all_types",
        None,
        1,
        Some("test_schema"),
    )
    .await
    .expect("count query");
    write_golden("count_query.json", &result);
    assert_golden("count_query.json", &result);
}
