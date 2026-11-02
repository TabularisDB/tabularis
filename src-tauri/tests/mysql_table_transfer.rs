//! Opt-in coverage of "Export table to SQL" and "Import table from SQL"
//! (#709) against a real MySQL/MariaDB server: a table exported from one
//! database and imported into another comes back with the same values,
//! including binary columns past the read preview size, JSON, text with
//! quotes, backslashes and line breaks, and a commented definition.
//!
//! Run against a disposable, TLS-enabled local MySQL/MariaDB server:
//! `cargo test --test mysql_table_transfer -- --ignored --nocapture`
//! Set TABULARIS_TEST_MYSQL=1 and TABULARIS_TEST_MYSQL_HOST, _PORT, _USER,
//! and _PASSWORD explicitly. The account must be able to create databases.
//! Each run creates two UUID-named databases and drops only those.

use futures::FutureExt;
use sqlx::mysql::{MySqlConnectOptions, MySqlSslMode};
use sqlx::{Connection, Executor, MySqlConnection, Row};
use std::net::IpAddr;
use std::panic::AssertUnwindSafe;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use tabularis_lib::application::database_transfers::DumpCancellationState;
use tabularis_lib::application::table_transfers::{
    export_table, import_table, IfTableExists, TableExportDestination, TableExportOptions,
    TableImportOptions, TableImportSource,
};
use tabularis_lib::drivers::mysql;
use tabularis_lib::export::ExportCancellationState;
use tabularis_lib::models::{
    ConnectionParams, ConnectionsFile, DatabaseSelection, SavedConnection,
};
use tabularis_lib::pool_manager::close_pool;
use tabularis_lib::runtime::events::NoopRuntimeEvents;
use tabularis_lib::runtime::paths::FixedRuntimePaths;
use tabularis_lib::runtime::RuntimeContext;
use tabularis_lib::table_sql::TableSqlContent;

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

struct NoSecrets;

impl tabularis_lib::runtime::secrets::RuntimeSecrets for NoSecrets {
    fn get(&self, _account: &str) -> Result<Option<String>, String> {
        Ok(None)
    }

    fn set(&self, _account: &str, _value: &str) -> Result<(), String> {
        Ok(())
    }

    fn delete(&self, _account: &str) -> Result<(), String> {
        Ok(())
    }
}

/// A runtime whose only saved connection, `mysql`, is the test server.
fn runtime(dir: &Path, params: &ConnectionParams) -> RuntimeContext {
    let runtime = RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(dir.to_path_buf(), dir.to_path_buf())),
        Arc::new(NoopRuntimeEvents),
        Arc::new(NoSecrets),
    );
    let connection = SavedConnection {
        id: "mysql".to_string(),
        name: "mysql".to_string(),
        params: params.clone(),
        plugin_secret_keys: Vec::new(),
        group_id: None,
        sort_order: None,
        detect_json_in_text_columns: None,
        appearance: None,
        tag_ids: None,
        environment: None,
    };
    tabularis_lib::persistence::save_connections_file(
        &runtime.paths.connections_file(),
        &ConnectionsFile {
            connections: vec![connection],
            ..Default::default()
        },
    )
    .expect("save the test connection");
    runtime
}

/// Every column as text, binary ones as hex, so the two tables compare exactly.
async fn rows(connection: &mut MySqlConnection, database: &str) -> Vec<Vec<Option<String>>> {
    let sql = format!(
        "SELECT CAST(id AS CHAR), note, CAST(price AS CHAR), CAST(paid AS CHAR), \
         CAST(at AS CHAR), CAST(meta AS CHAR), HEX(raw), CAST(raw IS NULL AS CHAR), kind, \
         CAST(f AS CHAR), v FROM {}.orders ORDER BY id",
        quoted(database)
    );
    connection
        .fetch_all(sqlx::raw_sql(&sql))
        .await
        .expect("read the table back")
        .iter()
        .map(|row| {
            (0..row.len())
                .map(|index| row.try_get::<Option<String>, _>(index).unwrap())
                .collect()
        })
        .collect()
}

async fn exercise_round_trip(
    connection: &mut MySqlConnection,
    params: &ConnectionParams,
    source: &str,
    target: &str,
) {
    execute(
        connection,
        &format!(
            "CREATE TABLE {}.orders (id int AUTO_INCREMENT PRIMARY KEY, note text, \
             price decimal(10,2), paid tinyint(1), at datetime, meta json, raw blob, \
             kind enum('a','b'), f double, -- the user's comment; kept by SHOW CREATE\n \
             v varchar(20) DEFAULT 'x;y') COMMENT='orders; it''s'",
            quoted(source)
        ),
    )
    .await;
    execute(
        connection,
        &format!(
            "INSERT INTO {}.orders (note, price, paid, at, meta, raw, kind, f, v) VALUES \
             ('it''s; a \\\\ back\\nslash \"q\"', 12.50, 1, '2026-01-02 03:04:05', \
              '{{\"k\": [1, \"x\"]}}', X'DEADBEEF00', 'b', 1.5, 'q'), \
             (NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL), \
             ('', 0, NULL, NULL, '\"text\"', UNHEX(REPEAT('AB', 20000)), 'a', -0.25, ''), \
             ('empty blob', NULL, NULL, NULL, NULL, X'', NULL, NULL, NULL)",
            quoted(source)
        ),
    )
    .await;

    let temp = tempfile::tempdir().unwrap();
    let runtime = runtime(temp.path(), params);
    let path = temp.path().join("orders.sql");
    let exported = export_table(
        &runtime,
        &ExportCancellationState::default(),
        None,
        "mysql".to_string(),
        TableExportOptions {
            table: "orders".to_string(),
            content: TableSqlContent::StructureAndData,
            schema: None,
            database: Some(source.to_string()),
        },
        TableExportDestination::ServerPath(path.clone()),
    )
    .await
    .expect("export");
    assert_eq!(exported.rows, 4);
    let imported = import_table(
        &runtime,
        &DumpCancellationState::default(),
        None,
        "mysql".to_string(),
        TableImportSource::ServerPath(path),
        TableImportOptions {
            if_exists: IfTableExists::Fail,
            schema: None,
            database: Some(target.to_string()),
        },
    )
    .await
    .expect("import");
    assert_eq!(imported.rows, 4);
    assert_eq!(
        rows(connection, target).await,
        rows(connection, source).await
    );
}

#[tokio::test]
#[ignore = "requires an explicitly configured disposable local MySQL/MariaDB server with TLS"]
async fn table_round_trips_into_another_database() {
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

    tabularis_lib::drivers::registry::register_driver(mysql::MysqlDriver::new()).await;
    let suffix = uuid::Uuid::new_v4().simple().to_string();
    let source = format!("tabularis_table_src_{suffix}");
    let target = format!("tabularis_table_dst_{suffix}");
    let params = ConnectionParams {
        driver: "mysql".into(),
        host: Some(host),
        port: Some(port),
        username: Some(username),
        password: Some(password),
        database: DatabaseSelection::Single(source.clone()),
        ssl_mode: Some("required".into()),
        ..Default::default()
    };
    let mut created = Vec::new();
    // Catch assertion/DDL failures so cleanup still runs. No IF NOT EXISTS:
    // an unexpected collision must never grant ownership of another database.
    let outcome = AssertUnwindSafe(async {
        for database in [&source, &target] {
            execute(
                &mut connection,
                &format!("CREATE DATABASE {} CHARACTER SET utf8mb4", quoted(database)),
            )
            .await;
            created.push(database.clone());
        }
        exercise_round_trip(&mut connection, &params, &source, &target).await;
    })
    .catch_unwind()
    .await;

    close_pool(&params).await;
    close_pool(&ConnectionParams {
        database: DatabaseSelection::Single(target.clone()),
        ..params.clone()
    })
    .await;
    let mut cleanup_errors = Vec::new();
    for database in &created {
        let sql = format!("DROP DATABASE {}", quoted(database));
        if let Err(error) = connection.execute(sqlx::raw_sql(&sql)).await {
            cleanup_errors.push(error);
        }
    }
    if let Err(panic) = outcome {
        for error in &cleanup_errors {
            eprintln!("fixture cleanup failed: {error}");
        }
        std::panic::resume_unwind(panic);
    }
    assert!(
        cleanup_errors.is_empty(),
        "fixture cleanup failed: {cleanup_errors:?}"
    );
}
