//! Opt-in coverage of `mysql::execute_query_stream` against a real server.
//!
//! Run against a disposable, TLS-enabled local MySQL/MariaDB server:
//! `cargo test --test mysql_streaming -- --ignored --nocapture`
//! Set TABULARIS_TEST_MYSQL=1 and TABULARIS_TEST_MYSQL_HOST, _PORT, _USER,
//! and _PASSWORD explicitly. The account must be able to create databases.
//! Each test creates a UUID-named database and drops only the database it created.
//! CI runs it against MySQL 8.4 and 5.7 in `.github/workflows/mysql-integration.yml`.

use futures::FutureExt;
use sqlx::mysql::{MySqlConnectOptions, MySqlSslMode};
use sqlx::{Connection, Executor, MySqlConnection};
use std::future::Future;
use std::net::IpAddr;
use std::panic::AssertUnwindSafe;
use std::time::Duration;
use tabularis_lib::drivers::driver_trait::QueryChunk;
use tabularis_lib::drivers::mysql;
use tabularis_lib::models::{ConnectionParams, DatabaseSelection};
use tabularis_lib::pool_manager::close_pool;

fn required_env(suffix: &str) -> String {
    let key = format!("TABULARIS_TEST_MYSQL{suffix}");
    std::env::var(&key).unwrap_or_else(|_| panic!("set {key} explicitly for the disposable server"))
}

fn quoted(identifier: &str) -> String {
    format!("`{}`", identifier.replace('`', "``"))
}

async fn execute(connection: &mut MySqlConnection, sql: &str) {
    connection
        .execute(sqlx::raw_sql(sql))
        .await
        .unwrap_or_else(|error| panic!("fixture SQL failed: {error}; SQL: {sql}"));
}

/// Creates a disposable database, runs `setup(quoted name)` in it, then
/// `exercise` with params for it, and drops the database.
async fn with_database<Fut: Future<Output = ()>>(
    setup: impl FnOnce(&str) -> Vec<String>,
    exercise: impl FnOnce(ConnectionParams) -> Fut,
) {
    assert_eq!(required_env(""), "1", "set TABULARIS_TEST_MYSQL=1");
    let host = required_env("_HOST");
    assert!(
        host == "localhost" || host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback()),
        "this destructive fixture only accepts a local disposable server"
    );
    let port: u16 = required_env("_PORT")
        .parse()
        .expect("valid test server port");
    let username = required_env("_USER");
    let password = required_env("_PASSWORD");
    let mut options = MySqlConnectOptions::new()
        .host(&host)
        .port(port)
        .username(&username)
        .ssl_mode(MySqlSslMode::Required);
    if !password.is_empty() {
        options = options.password(&password);
    }
    let mut connection = tokio::time::timeout(
        Duration::from_secs(10),
        MySqlConnection::connect_with(&options),
    )
    .await
    .expect("test server connection timed out")
    .expect("cannot connect to the explicitly configured TLS test server");

    let schema = format!("tabularis_streaming_{}", uuid::Uuid::new_v4().simple());
    let params = ConnectionParams {
        driver: "mysql".into(),
        host: Some(host),
        port: Some(port),
        username: Some(username),
        password: Some(password),
        database: DatabaseSelection::Single(schema.clone()),
        ssl_mode: Some("required".into()),
        ..Default::default()
    };
    let mut created = false;
    // Catch assertion/DDL failures so cleanup still runs. No IF NOT EXISTS:
    // an unexpected collision must never grant ownership of another database.
    let outcome = AssertUnwindSafe(async {
        execute(
            &mut connection,
            &format!("CREATE DATABASE {} CHARACTER SET utf8mb4", quoted(&schema)),
        )
        .await;
        created = true;
        for sql in setup(&quoted(&schema)) {
            execute(&mut connection, &sql).await;
        }
        exercise(params.clone()).await;
    })
    .catch_unwind()
    .await;

    close_pool(&params).await;
    let cleanup_error = if created {
        let sql = format!("DROP DATABASE {}", quoted(&schema));
        connection.execute(sqlx::raw_sql(&sql)).await.err()
    } else {
        None
    };
    if let Err(panic) = outcome {
        if let Some(error) = &cleanup_error {
            eprintln!("fixture cleanup failed: {error}");
        }
        std::panic::resume_unwind(panic);
    }
    assert!(
        cleanup_error.is_none(),
        "fixture cleanup failed: {cleanup_error:?}"
    );
}

async fn stream(params: &ConnectionParams, query: &str) -> Vec<QueryChunk> {
    let mut chunks = Vec::new();
    mysql::execute_query_stream(params, query, None, &mut |chunk| chunks.push(chunk))
        .await
        .expect("execute_query_stream should succeed");
    chunks
}

#[tokio::test]
#[ignore = "requires an explicitly configured disposable local MySQL/MariaDB server with TLS"]
async fn a_mysql_query_returning_1200_rows_streams_the_columns_then_500_then_700_and_the_batches_equal_the_execute_query_result(
) {
    let values: Vec<_> = (1..=1200).map(|x| format!("({x})")).collect();
    let values = values.join(",");
    with_database(
        move |db| {
            vec![
                format!("CREATE TABLE {db}.items (x INT PRIMARY KEY)"),
                format!("INSERT INTO {db}.items VALUES {values}"),
            ]
        },
        |params| async move {
            let query = "SELECT x, CONCAT('row ', x) AS label FROM items ORDER BY x";
            let chunks = stream(&params, query).await;
            let expected = mysql::execute_query(&params, query, None, 1, None)
                .await
                .expect("execute_query should succeed");

            let [QueryChunk::Columns(columns), QueryChunk::Rows(first), QueryChunk::Rows(rest)] =
                chunks.as_slice()
            else {
                panic!("unexpected chunks: {chunks:?}");
            };
            assert_eq!(columns, &expected.columns);
            assert_eq!((first.len(), rest.len()), (500, 700));
            assert_eq!([first.as_slice(), rest.as_slice()].concat(), expected.rows);
        },
    )
    .await;
}

#[tokio::test]
#[ignore = "requires an explicitly configured disposable local MySQL/MariaDB server with TLS"]
async fn a_mysql_call_that_returns_two_result_sets_streams_the_first_sets_columns_and_rows_then_the_second_sets_columns_and_rows_in_order(
) {
    with_database(
        |db| {
            vec![format!(
                "CREATE PROCEDURE {db}.two_sets() BEGIN SELECT 1 AS a; SELECT 'b' AS b, 2 AS c; END"
            )]
        },
        |params| async move {
            let chunks = stream(&params, "CALL two_sets()").await;
            let expected = mysql::execute_query(&params, "CALL two_sets()", None, 1, None)
                .await
                .expect("execute_query should succeed");
            let second = &expected
                .additional_results
                .as_deref()
                .expect("a second set")[0];

            assert_eq!(expected.columns, ["a"]);
            assert_eq!(second.columns, ["b", "c"]);
            assert_eq!(
                chunks,
                [
                    QueryChunk::Columns(expected.columns.clone()),
                    QueryChunk::Rows(expected.rows.clone()),
                    QueryChunk::Columns(second.columns.clone()),
                    QueryChunk::Rows(second.rows.clone()),
                ]
            );
        },
    )
    .await;
}
