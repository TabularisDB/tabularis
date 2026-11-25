//! Opt-in coverage of view lookups on a connection with several databases.
//!
//! Run against a disposable, TLS-enabled local MySQL/MariaDB server:
//! `cargo test --test mysql_views -- --ignored --nocapture`
//! Set TABULARIS_TEST_MYSQL=1 and TABULARIS_TEST_MYSQL_HOST, _PORT, _USER,
//! and _PASSWORD explicitly. The account must be able to create databases.
//! Each run creates two UUID-named databases and drops only the ones it created.
//! CI runs it against MySQL 8.4 and 5.7 in `.github/workflows/mysql-integration.yml`.

use futures::FutureExt;
use sqlx::mysql::{MySqlConnectOptions, MySqlSslMode};
use sqlx::{Connection, Executor, MySqlConnection, Row};
use std::net::IpAddr;
use std::panic::AssertUnwindSafe;
use std::time::Duration;
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

async fn view_count(connection: &mut MySqlConnection, schema: &str, view: &str) -> i64 {
    sqlx::query(
        "SELECT COUNT(*) FROM information_schema.views WHERE table_schema = ? AND table_name = ?",
    )
    .bind(schema)
    .bind(view)
    .fetch_one(connection)
    .await
    .expect("count views")
    .get(0)
}

fn params_for_protocol(params: &ConnectionParams, text_protocol: bool) -> ConnectionParams {
    let mut selected = params.clone();
    selected.enable_cleartext_plugin = Some(text_protocol);
    selected
}

async fn exercise_views(
    connection: &mut MySqlConnection,
    params: &ConnectionParams,
    first: &str,
    second: &str,
) {
    let (a, b) = (quoted(first), quoted(second));
    // The same view name in both databases, so a lookup in the wrong one
    // returns the wrong definition instead of failing.
    execute(
        connection,
        &format!("CREATE VIEW {a}.v_test AS SELECT 1 AS x"),
    )
    .await;
    execute(
        connection,
        &format!("CREATE VIEW {b}.v_test AS SELECT 2 AS x"),
    )
    .await;
    execute(
        connection,
        &format!("CREATE VIEW {b}.only_b AS SELECT 3 AS x"),
    )
    .await;

    for text_protocol in [false, true] {
        let selected = params_for_protocol(params, text_protocol);
        let only_b = mysql::get_view_definition(&selected, "only_b", Some(second))
            .await
            .expect("view outside the first database loads");
        assert!(
            only_b.contains("select 3 AS"),
            "only_b definition: {only_b}"
        );

        let in_b = mysql::get_view_definition(&selected, "v_test", Some(second))
            .await
            .expect("view in the second database loads");
        assert!(
            in_b.contains("select 2 AS"),
            "v_test from the second database (text protocol: {text_protocol}): {in_b}"
        );
        let in_a = mysql::get_view_definition(&selected, "v_test", None)
            .await
            .expect("view in the first database loads without a schema");
        assert!(
            in_a.contains("select 1 AS"),
            "v_test without a schema stays on the first database: {in_a}"
        );
    }

    mysql::alter_view(params, "v_test", "SELECT 20 AS x", Some(second))
        .await
        .expect("alter view in the second database");
    let in_b = mysql::get_view_definition(params, "v_test", Some(second))
        .await
        .unwrap();
    let in_a = mysql::get_view_definition(params, "v_test", Some(first))
        .await
        .unwrap();
    assert!(in_b.contains("select 20 AS"), "altered view: {in_b}");
    assert!(
        in_a.contains("select 1 AS"),
        "view in the first database untouched: {in_a}"
    );

    mysql::create_view(params, "new_b", "SELECT 4 AS x", Some(second))
        .await
        .expect("create view in the second database");
    assert_eq!(view_count(connection, second, "new_b").await, 1);
    assert_eq!(view_count(connection, first, "new_b").await, 0);

    mysql::drop_view(params, "v_test", Some(second))
        .await
        .expect("drop view in the second database");
    assert_eq!(view_count(connection, second, "v_test").await, 0);
    assert_eq!(view_count(connection, first, "v_test").await, 1);
}

#[tokio::test]
#[ignore = "requires an explicitly configured disposable local MySQL/MariaDB server with TLS"]
async fn view_operations_use_the_database_they_are_listed_under() {
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

    let suffix = uuid::Uuid::new_v4().simple().to_string();
    let first = format!("tabularis_views_a_{suffix}");
    let second = format!("tabularis_views_b_{suffix}");
    let params = ConnectionParams {
        driver: "mysql".into(),
        host: Some(host),
        port: Some(port),
        username: Some(username),
        password: Some(password),
        database: DatabaseSelection::Multiple(vec![first.clone(), second.clone()]),
        ssl_mode: Some("required".into()),
        ..Default::default()
    };
    let mut created = Vec::new();
    // Catch assertion/DDL failures so cleanup still runs. No IF NOT EXISTS:
    // an unexpected collision must never grant ownership of another database.
    let outcome = AssertUnwindSafe(async {
        for schema in [&first, &second] {
            execute(
                &mut connection,
                &format!("CREATE DATABASE {} CHARACTER SET utf8mb4", quoted(schema)),
            )
            .await;
            created.push(schema.clone());
        }
        exercise_views(&mut connection, &params, &first, &second).await;
    })
    .catch_unwind()
    .await;

    for text_protocol in [false, true] {
        close_pool(&params_for_protocol(&params, text_protocol)).await;
    }
    let mut cleanup_error = None;
    for schema in &created {
        let sql = format!("DROP DATABASE {}", quoted(schema));
        if let Err(error) = connection.execute(sqlx::raw_sql(&sql)).await {
            cleanup_error.get_or_insert(error);
        }
    }
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
