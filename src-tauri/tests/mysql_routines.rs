//! Opt-in coverage of routine parameter discovery against a real server.
//!
//! Run against a disposable, TLS-enabled local MySQL/MariaDB server:
//! `cargo test --test mysql_routines -- --ignored --nocapture`
//! Set TABULARIS_TEST_MYSQL=1 and TABULARIS_TEST_MYSQL_HOST, _PORT, _USER,
//! and _PASSWORD explicitly. The account must be able to create databases.
//! Each run creates a UUID-named database and drops only the database it created.
//! CI runs it against MySQL 8.4 and 5.7 in `.github/workflows/mysql-integration.yml`.

use futures::FutureExt;
use sqlx::mysql::{MySqlConnectOptions, MySqlSslMode};
use sqlx::{Connection, Executor, MySqlConnection};
use std::net::IpAddr;
use std::panic::AssertUnwindSafe;
use std::time::Duration;
use tabularis_lib::drivers::mysql;
use tabularis_lib::models::{ConnectionParams, DatabaseSelection, RoutineParameter};
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

fn params_for_protocol(params: &ConnectionParams, text_protocol: bool) -> ConnectionParams {
    let mut selected = params.clone();
    selected.enable_cleartext_plugin = Some(text_protocol);
    selected
}

async fn parameters(
    params: &ConnectionParams,
    routine: &str,
    schema: &str,
) -> Vec<RoutineParameter> {
    tokio::time::timeout(
        Duration::from_secs(30),
        mysql::get_routine_parameters(params, routine, Some(schema)),
    )
    .await
    .expect("parameter discovery timed out")
    .expect("parameter discovery failed")
}

async fn exercise_routine_parameters(
    connection: &mut MySqlConnection,
    params: &ConnectionParams,
    schema: &str,
) {
    let db = quoted(schema);
    // The procedure from issue #903, plus a function: MySQL lists a function's
    // return value at position 0, ahead of its parameters.
    execute(
        connection,
        &format!(
            "CREATE TABLE {db}.departments (id INT AUTO_INCREMENT PRIMARY KEY, \
             name VARCHAR(100), budget DECIMAL(12,2), location VARCHAR(100))"
        ),
    )
    .await;
    execute(
        connection,
        &format!(
            "CREATE PROCEDURE {db}.add_department(IN p_name VARCHAR(100), IN p_budget DECIMAL(12,2))
             BEGIN
               INSERT INTO {db}.departments (name, budget, location) VALUES (p_name, p_budget, 'Remote');
               SELECT * FROM {db}.departments ORDER BY id DESC LIMIT 5;
             END"
        ),
    )
    .await;
    execute(
        connection,
        &format!(
            "CREATE FUNCTION {db}.with_tax(p_amount DECIMAL(12,2), p_rate DECIMAL(5,2))
             RETURNS DECIMAL(12,2) DETERMINISTIC
             RETURN p_amount * (1 + p_rate / 100)"
        ),
    )
    .await;

    for text_protocol in [false, true] {
        let selected = params_for_protocol(params, text_protocol);
        let procedure: Vec<_> = parameters(&selected, "add_department", schema)
            .await
            .iter()
            .map(|p| {
                format!(
                    "{} {} {} {}",
                    p.ordinal_position, p.name, p.mode, p.data_type
                )
            })
            .collect();
        assert_eq!(
            procedure,
            ["1 p_name IN varchar", "2 p_budget IN decimal"],
            "procedure parameters (text protocol: {text_protocol})"
        );
        let function = parameters(&selected, "with_tax", schema).await;
        let positions: Vec<_> = function
            .iter()
            .map(|p| (p.ordinal_position, p.name.as_str()))
            .collect();
        assert_eq!(
            positions,
            [(0, ""), (1, "p_amount"), (2, "p_rate")],
            "function return value and parameters (text protocol: {text_protocol})"
        );
    }
}

#[tokio::test]
#[ignore = "requires an explicitly configured disposable local MySQL/MariaDB server with TLS"]
async fn routine_parameters_keep_their_positions() {
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

    let schema = format!("tabularis_routines_{}", uuid::Uuid::new_v4().simple());
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
        exercise_routine_parameters(&mut connection, &params, &schema).await;
    })
    .catch_unwind()
    .await;

    for text_protocol in [false, true] {
        close_pool(&params_for_protocol(&params, text_protocol)).await;
    }
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
