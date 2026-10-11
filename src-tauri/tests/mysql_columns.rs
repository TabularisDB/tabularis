//! Opt-in coverage of column metadata discovery against a real server.
//!
//! Run against a disposable, TLS-enabled local MySQL/MariaDB server:
//! `cargo test --test mysql_columns -- --ignored --nocapture`
//! Set TABULARIS_TEST_MYSQL=1 and TABULARIS_TEST_MYSQL_HOST, _PORT, _USER,
//! and _PASSWORD explicitly. The account must be able to create databases.
//! Each run creates a UUID-named database and drops only the database it created.
//!
//! The official `mysql` images enable TLS with auto-generated certificates.
//! Stock `mariadb` images do not: mount a CA, certificate and key and start the
//! server with `--ssl-ca`, `--ssl-cert` and `--ssl-key` before running this.
//! CI runs it against MySQL 8.4 and 5.7 in `.github/workflows/mysql-integration.yml`.

use futures::FutureExt;
use sqlx::mysql::{MySqlConnectOptions, MySqlSslMode};
use sqlx::{Connection, Executor, MySqlConnection};
use std::future::Future;
use std::net::IpAddr;
use std::panic::AssertUnwindSafe;
use std::time::Duration;
use tabularis_lib::drivers::mysql;
use tabularis_lib::models::{ConnectionParams, DatabaseSelection, TableColumn};
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

async fn discover<T>(what: &str, discovery: impl Future<Output = Result<T, String>>) -> T {
    tokio::time::timeout(Duration::from_secs(30), discovery)
        .await
        .unwrap_or_else(|_| panic!("{what} timed out"))
        .unwrap_or_else(|error| panic!("{what} failed: {error}"))
}

/// Each column as `name length`, with `-` for columns that have no character length.
fn lengths(columns: &[TableColumn]) -> Vec<String> {
    columns
        .iter()
        .map(|column| match column.character_maximum_length {
            Some(length) => format!("{} {length}", column.name),
            None => format!("{} -", column.name),
        })
        .collect()
}

async fn exercise_column_lengths(
    connection: &mut MySqlConnection,
    params: &ConnectionParams,
    schema: &str,
) {
    let db = quoted(schema);
    execute(
        connection,
        &format!(
            "CREATE TABLE {db}.items (id INT PRIMARY KEY, name VARCHAR(100) NOT NULL, \
             code CHAR(3), uid VARBINARY(16), note TEXT, qty INT)"
        ),
    )
    .await;
    execute(
        connection,
        &format!("CREATE VIEW {db}.item_names AS SELECT id, name, uid FROM {db}.items"),
    )
    .await;

    let table = [
        "id -",
        "name 100",
        "code 3",
        "uid 16",
        "note 65535",
        "qty -",
    ];
    for text_protocol in [false, true] {
        let selected = params_for_protocol(params, text_protocol);
        let columns = discover(
            "get_columns",
            mysql::get_columns(&selected, "items", Some(schema)),
        )
        .await;
        assert_eq!(
            lengths(&columns),
            table,
            "get_columns (text protocol: {text_protocol})"
        );
        let batch = discover(
            "get_all_columns_batch",
            mysql::get_all_columns_batch(&selected, Some(schema)),
        )
        .await;
        assert_eq!(
            lengths(&batch["items"]),
            table,
            "get_all_columns_batch (text protocol: {text_protocol})"
        );
        let view = discover(
            "get_view_columns",
            mysql::get_view_columns(&selected, "item_names", Some(schema)),
        )
        .await;
        assert_eq!(
            lengths(&view),
            ["id -", "name 100", "uid 16"],
            "get_view_columns (text protocol: {text_protocol})"
        );
    }
}

#[tokio::test]
#[ignore = "requires an explicitly configured disposable local MySQL/MariaDB server with TLS"]
async fn column_lengths_are_reported() {
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

    let schema = format!("tabularis_columns_{}", uuid::Uuid::new_v4().simple());
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
        exercise_column_lengths(&mut connection, &params, &schema).await;
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
