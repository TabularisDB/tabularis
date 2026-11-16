//! Query execution tests.

use crate::helpers::{pg_params, pg_params_secondary};
use tabularis_lib::drivers::postgres;

#[tokio::test]
#[ignore]
async fn test_execute_query_basic_select() {
    require_pg!();
    let params = pg_params();

    let result = postgres::execute_query(
        &params,
        "SELECT id, col_text, col_int FROM test_schema.all_types ORDER BY id LIMIT 1",
        Some(100),
        1,
        None,
    )
    .await
    .expect("execute_query should succeed");

    assert_eq!(result.columns, vec!["id", "col_text", "col_int"]);
    assert!(!result.rows.is_empty(), "Should have at least one row");

    // First row should have id=1 from seed
    let first_row = &result.rows[0];
    assert_eq!(first_row[0], serde_json::json!(1)); // id
    assert_eq!(first_row[1], serde_json::json!("hello")); // col_text
    assert_eq!(first_row[2], serde_json::json!(42)); // col_int
}

#[tokio::test]
#[ignore]
async fn test_execute_query_with_pagination() {
    require_pg!();
    let params = pg_params();

    // Page 1 with limit 1
    let page1 = postgres::execute_query(
        &params,
        "SELECT id FROM test_schema.all_types ORDER BY id",
        Some(1),
        1,
        None,
    )
    .await
    .expect("page 1");

    assert_eq!(page1.rows.len(), 1);
    assert_eq!(page1.rows[0][0], serde_json::json!(1));
    assert!(
        page1.pagination.as_ref().map_or(false, |p| p.has_more),
        "Should have more pages"
    );

    // Page 2
    let page2 = postgres::execute_query(
        &params,
        "SELECT id FROM test_schema.all_types ORDER BY id",
        Some(1),
        2,
        None,
    )
    .await
    .expect("page 2");

    assert_eq!(page2.rows.len(), 1);
    assert_eq!(page2.rows[0][0], serde_json::json!(2));
}

#[tokio::test]
#[ignore]
async fn test_execute_query_all_types_roundtrip() {
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
    .expect("execute_query should succeed");

    assert_eq!(result.rows.len(), 1, "Expected exactly 1 row");
    let row = &result.rows[0];

    // Verify key type extractions produce valid JSON values (not null for seeded data)
    let col_idx = |name: &str| result.columns.iter().position(|c| c == name).unwrap();

    assert!(!row[col_idx("col_text")].is_null());
    assert!(!row[col_idx("col_int")].is_null());
    assert!(!row[col_idx("col_bool")].is_null());
    assert!(!row[col_idx("col_uuid")].is_null());
    assert!(!row[col_idx("col_jsonb")].is_null());
    assert!(!row[col_idx("col_int_array")].is_null());
    assert!(!row[col_idx("col_timestamptz")].is_null());
}

#[tokio::test]
#[ignore]
async fn test_execute_query_null_handling() {
    require_pg!();
    let params = pg_params();

    // Row 2 was seeded with only col_text (NULL) — most columns are null
    // except col_uuid which has DEFAULT gen_random_uuid()
    let result = postgres::execute_query(
        &params,
        "SELECT col_text, col_int, col_bool, col_bytea FROM test_schema.all_types WHERE id = 2",
        None,
        1,
        None,
    )
    .await
    .expect("execute_query should succeed");

    assert_eq!(result.rows.len(), 1);
    let row = &result.rows[0];
    // These columns have no default and weren't set — should be null
    for (i, val) in row.iter().enumerate() {
        assert!(
            val.is_null(),
            "Column {} expected null, got: {:?}",
            result.columns[i],
            val
        );
    }
}

#[tokio::test]
#[ignore]
async fn test_execute_query_affected_rows_for_dml() {
    require_pg!();
    let params = pg_params();

    // Insert into scratch table
    let result = postgres::execute_query(
        &params,
        "INSERT INTO test_schema.crud_scratch (name, value) VALUES ('test', 1)",
        None,
        1,
        None,
    )
    .await
    .expect("INSERT should succeed");

    assert_eq!(result.affected_rows, 1);
    assert!(result.columns.is_empty(), "DML returns no columns");
    assert!(result.rows.is_empty(), "DML returns no rows");
}

#[tokio::test]
#[ignore]
async fn test_execute_batch_session_state() {
    require_pg!();
    let params = pg_params();

    // Batch with transaction + temp table — session state must persist
    let statements: Vec<String> = vec![
        "BEGIN".into(),
        "CREATE TEMP TABLE _batch_test (x INT)".into(),
        "INSERT INTO _batch_test VALUES (42)".into(),
        "SELECT x FROM _batch_test".into(),
        "COMMIT".into(),
    ];

    let results = postgres::execute_batch(&params, &statements, Some(100), 1, None, None)
        .await
        .expect("execute_batch should succeed");

    // The SELECT result (4th statement, index 3) should return the inserted value
    assert!(results.len() >= 4, "Expected at least 4 results");
    let select_result = results[3]
        .result
        .as_ref()
        .expect("SELECT should produce a result");
    assert_eq!(select_result.rows.len(), 1);
    assert_eq!(select_result.rows[0][0], serde_json::json!(42));
}

#[tokio::test]
#[ignore]
async fn test_pinned_session_rejects_database_mismatch() {
    // A transaction started on one database must not silently run on another
    // when the tab switches databases mid-transaction (#947).
    require_pg!();
    let primary = pg_params();
    let secondary = pg_params_secondary();
    let session = "test-pinned-session-db-mismatch";

    // Start a transaction on the primary database and leave it open.
    let (_results, pinned) = postgres::execute_batch_in_session(
        &primary,
        &["BEGIN".into()],
        None,
        1,
        None,
        Some(session),
        None,
    )
    .await
    .expect("BEGIN should succeed");
    assert!(pinned, "BEGIN should leave a pinned transaction");

    // The same session, now targeting the secondary database, must be rejected
    // rather than silently running on the primary connection.
    let err = postgres::execute_batch_in_session(
        &secondary,
        &["SELECT 1".into()],
        None,
        1,
        None,
        Some(session),
        None,
    )
    .await
    .expect_err("database mismatch should be rejected");
    assert!(
        err.contains("open transaction on database") && err.contains("testdb"),
        "error should name the pinned database, got: {err}"
    );
    assert!(
        err.contains("tabularis_test_secondary"),
        "error should name the requested database, got: {err}"
    );

    // Clean up: roll back the open transaction on the primary.
    postgres::execute_batch_in_session(
        &primary,
        &["ROLLBACK".into()],
        None,
        1,
        None,
        Some(session),
        None,
    )
    .await
    .expect("ROLLBACK should succeed");
}
