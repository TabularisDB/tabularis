//! `execute_read_only_query`: the database refuses writes that keyword
//! classification can miss (MCP read-only mode and approval gate).

use crate::helpers::pg_params;
use tabularis_lib::drivers::postgres;

async fn table_exists(name: &str) -> bool {
    let result = postgres::execute_query(
        &pg_params(),
        &format!("SELECT to_regclass('public.{name}') IS NOT NULL"),
        None,
        1,
        None,
    )
    .await
    .expect("check table");
    result.rows[0][0] == serde_json::json!(true)
}

#[tokio::test]
#[ignore]
async fn test_read_only_query_returns_rows() {
    require_pg!();
    let result = postgres::execute_read_only_query(&pg_params(), "SELECT 1 AS x", None, 1, None)
        .await
        .expect("a read runs in read-only mode");
    assert_eq!(result.rows[0][0], serde_json::json!(1));
}

#[tokio::test]
#[ignore]
async fn test_read_only_query_rejects_select_into() {
    require_pg!();
    let outcome = postgres::execute_read_only_query(
        &pg_params(),
        "SELECT 1 AS x INTO ro_bypass_probe",
        None,
        1,
        None,
    )
    .await;
    assert!(outcome.is_err(), "SELECT INTO must be rejected");
    assert!(!table_exists("ro_bypass_probe").await);
}

#[tokio::test]
#[ignore]
async fn test_read_only_query_rejects_volatile_writes() {
    require_pg!();
    let params = pg_params();
    postgres::execute_query(
        &params,
        "CREATE SEQUENCE IF NOT EXISTS ro_probe_seq",
        None,
        1,
        None,
    )
    .await
    .expect("create sequence");
    for write in [
        "SELECT setval('ro_probe_seq', 42)",
        "SELECT nextval('ro_probe_seq')",
    ] {
        assert!(
            postgres::execute_read_only_query(&params, write, None, 1, None)
                .await
                .is_err(),
            "{write} must be rejected"
        );
    }
    postgres::execute_query(&params, "DROP SEQUENCE ro_probe_seq", None, 1, None)
        .await
        .expect("drop sequence");
}

#[tokio::test]
#[ignore]
async fn test_read_only_query_does_not_leak_into_the_pool() {
    require_pg!();
    let params = pg_params();
    let _ =
        postgres::execute_read_only_query(&params, "SELECT 1 INTO ro_leak_probe", None, 1, None)
            .await;
    let _ = postgres::execute_read_only_query(&params, "SELECT 1", None, 1, None).await;
    // Ordinary writes on the next pooled connections are not read-only.
    for _ in 0..3 {
        postgres::execute_query(
            &params,
            "CREATE TABLE ro_leak_probe (id int)",
            None,
            1,
            None,
        )
        .await
        .expect("writes still work after a read-only query");
        postgres::execute_query(&params, "DROP TABLE ro_leak_probe", None, 1, None)
            .await
            .expect("drop probe table");
    }
}

#[tokio::test]
#[ignore]
async fn a_write_statement_on_a_read_only_postgres_connection_is_rejected_before_any_row_is_sent() {
    use tabularis_lib::drivers::driver_trait::QueryChunk;
    use tabularis_lib::models::ConnectionParams;
    require_pg!();
    postgres::execute_query(
        &pg_params(),
        "CREATE SEQUENCE IF NOT EXISTS ro_stream_seq",
        None,
        1,
        None,
    )
    .await
    .expect("create sequence");
    let read_only = ConnectionParams {
        read_only: true,
        ..pg_params()
    };
    // The driver's read-only transaction alone, then with the protected pool too.
    for params in [pg_params(), read_only] {
        let mut chunks: Vec<QueryChunk> = Vec::new();
        let outcome = postgres::execute_read_only_query_stream(
            &params,
            "SELECT x, nextval('ro_stream_seq') FROM generate_series(1, 1200) AS x",
            None,
            &mut |chunk| chunks.push(chunk),
        )
        .await;
        let error = outcome.expect_err("nextval must be rejected");
        assert!(error.contains("read-only transaction"), "{error}");
        assert!(chunks.is_empty(), "sent before the rejection: {chunks:?}");
    }
    postgres::execute_query(&pg_params(), "DROP SEQUENCE ro_stream_seq", None, 1, None)
        .await
        .expect("drop sequence");
}
