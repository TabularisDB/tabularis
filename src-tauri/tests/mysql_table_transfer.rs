//! Opt-in coverage of "Export table to SQL" and "Import table from SQL"
//! (#709) against a real MySQL/MariaDB server: a table exported from one
//! database and imported into another comes back with the same values,
//! including binary columns past the read preview size, JSON, text with
//! quotes, backslashes and line breaks, a commented definition, and the
//! integer, decimal and floating-point extremes.
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
    text_rows(connection, &sql).await
}

/// The result of `sql`, every value as text.
async fn text_rows(connection: &mut MySqlConnection, sql: &str) -> Vec<Vec<Option<String>>> {
    connection
        .fetch_all(sqlx::raw_sql(sql))
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

/// Exports `{source}.{table}` and imports it into `target`; the row counts.
async fn transfer(
    params: &ConnectionParams,
    table: &str,
    source: &str,
    target: &str,
) -> (u64, u64) {
    let (exported, imported, _) = transfer_file(params, table, source, target).await;
    (exported, imported)
}

/// [`transfer`], also returning the exported file.
async fn transfer_file(
    params: &ConnectionParams,
    table: &str,
    source: &str,
    target: &str,
) -> (u64, u64, String) {
    let temp = tempfile::tempdir().unwrap();
    let runtime = runtime(temp.path(), params);
    let path = temp.path().join(format!("{table}.sql"));
    let exported = export_table(
        &runtime,
        &ExportCancellationState::default(),
        None,
        "mysql".to_string(),
        TableExportOptions {
            table: table.to_string(),
            content: TableSqlContent::StructureAndData,
            schema: None,
            database: Some(source.to_string()),
        },
        TableExportDestination::ServerPath(path.clone()),
    )
    .await
    .expect("export");
    let file = std::fs::read_to_string(&path).expect("read the export");
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
    (exported.rows, imported.rows, file)
}

/// Integer limits (signed and unsigned), `DECIMAL` with more digits than a
/// double holds, and the double and float extremes come back unchanged.
async fn exercise_numeric_extremes(
    connection: &mut MySqlConnection,
    params: &ConnectionParams,
    source: &str,
    target: &str,
) {
    execute(
        connection,
        &format!(
            "CREATE TABLE {}.numbers (id int PRIMARY KEY, tiny tinyint, small smallint, \
             big bigint, ubig bigint unsigned, uint int unsigned, exact decimal(65,30), \
             d double, f float, b bit(64))",
            quoted(source)
        ),
    )
    .await;
    execute(
        connection,
        &format!(
            "INSERT INTO {}.numbers VALUES \
             (1, 127, 32767, 9223372036854775807, 18446744073709551615, 4294967295, \
              '12345678901234567890123456789012345.123456789012345678901234567890', \
              1.7976931348623157e308, 3.40282e38, b'1111111111111111111111111111111111111111111111111111111111111111'), \
             (2, -128, -32768, -9223372036854775808, 0, 0, \
              '-12345678901234567890123456789012345.123456789012345678901234567890', \
              -1.7976931348623157e308, -3.40282e38, b'0'), \
             (3, 0, 0, 9007199254740993, 9007199254740993, 1, \
              '0.000000000000000000000000000001', 2.2250738585072014e-308, 1.17549e-38, NULL), \
             (4, NULL, NULL, -9007199254740993, NULL, NULL, NULL, -0.0, -0.0, NULL), \
             (5, 1, 1, 0, 1, 1, 0.1, 0.30000000000000004, 0.1, b'101')",
            quoted(source)
        ),
    )
    .await;

    // The export dialog's estimate, from the table statistics.
    execute(
        connection,
        &format!("ANALYZE TABLE {}.numbers", quoted(source)),
    )
    .await;
    assert_eq!(
        mysql::get_approximate_row_count(params, "numbers", Some(source)).await,
        Ok(Some(5))
    );
    assert_eq!(
        mysql::get_approximate_row_count(params, "missing", Some(source)).await,
        Ok(None)
    );

    assert_eq!(transfer(params, "numbers", source, target).await, (5, 5));
    let compare = |database: &str| {
        format!(
            "SELECT CAST(id AS CHAR), CAST(tiny AS CHAR), CAST(small AS CHAR), \
             CAST(big AS CHAR), CAST(ubig AS CHAR), CAST(uint AS CHAR), \
             CAST(exact AS CHAR), CAST(d AS CHAR), CAST(f AS CHAR), HEX(b) \
             FROM {}.numbers ORDER BY id",
            quoted(database)
        )
    };
    let target_rows = text_rows(connection, &compare(target)).await;
    let source_rows = text_rows(connection, &compare(source)).await;
    assert_eq!(target_rows, source_rows);
    assert_eq!(
        source_rows[0][4].as_deref(),
        Some("18446744073709551615"),
        "the unsigned maximum is in the source"
    );

    // Rows come out in key order, not in the order of the key's text (a
    // DECIMAL key is read as text).
    execute(
        connection,
        &format!(
            "CREATE TABLE {}.keyed (id decimal(5,0) PRIMARY KEY, v int)",
            quoted(source)
        ),
    )
    .await;
    let values = (1..=12)
        .rev()
        .map(|id| format!("({id}, {id})"))
        .collect::<Vec<_>>()
        .join(", ");
    execute(
        connection,
        &format!("INSERT INTO {}.keyed VALUES {values}", quoted(source)),
    )
    .await;
    let (_, imported, file) = transfer_file(params, "keyed", source, target).await;
    assert_eq!(imported, 12);
    let keys = file
        .lines()
        .filter_map(|line| line.strip_prefix('('))
        .map(|line| {
            line.split(',')
                .next()
                .unwrap()
                .trim_matches('\'')
                .to_string()
        })
        .collect::<Vec<_>>();
    assert_eq!(keys, (1..=12).map(|id| id.to_string()).collect::<Vec<_>>());

    // Dates and times at their limits and with fractional seconds.
    execute(
        connection,
        &format!(
            "CREATE TABLE {}.moments (id int PRIMARY KEY, d date, dt datetime(6), \
             ts timestamp(6) NULL, t time(6), y year)",
            quoted(source)
        ),
    )
    .await;
    execute(
        connection,
        &format!(
            "INSERT INTO {}.moments VALUES \
             (1, '1000-01-01', '1000-01-01 00:00:00.000000', '1970-01-01 00:00:01.000001', \
              '-838:59:59.000000', 1901), \
             (2, '9999-12-31', '9999-12-31 23:59:59.999999', '2038-01-19 03:14:07.999999', \
              '838:59:59.000000', 2155), \
             (3, '2026-02-03', '2026-02-03 04:05:06.123456', NULL, '-00:00:00.500000', 0)",
            quoted(source)
        ),
    )
    .await;
    assert_eq!(transfer(params, "moments", source, target).await, (3, 3));
    let compare = |database: &str| {
        format!(
            "SELECT CAST(id AS CHAR), CAST(d AS CHAR), CAST(dt AS CHAR), CAST(ts AS CHAR), \
             CAST(t AS CHAR), CAST(y AS CHAR) FROM {}.moments ORDER BY id",
            quoted(database)
        )
    };
    assert_eq!(
        text_rows(connection, &compare(target)).await,
        text_rows(connection, &compare(source)).await
    );

    // Spatial values with their SRID.
    execute(
        connection,
        &format!(
            "CREATE TABLE {}.shapes (id int PRIMARY KEY, g geometry, p point)",
            quoted(source)
        ),
    )
    .await;
    execute(
        connection,
        &format!(
            "INSERT INTO {}.shapes VALUES \
             (1, ST_GeomFromText('POLYGON((0 0, 1 0, 1 1, 0 0))', 4326), ST_GeomFromText('POINT(1.5 -2.25)')), \
             (2, NULL, NULL)",
            quoted(source)
        ),
    )
    .await;
    assert_eq!(transfer(params, "shapes", source, target).await, (2, 2));
    let compare = |database: &str| {
        format!(
            "SELECT CAST(id AS CHAR), HEX(g), HEX(p) FROM {}.shapes ORDER BY id",
            quoted(database)
        )
    };
    assert_eq!(
        text_rows(connection, &compare(target)).await,
        text_rows(connection, &compare(source)).await
    );
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
             ('empty blob', NULL, NULL, NULL, NULL, X'', NULL, NULL, NULL), \
             ('caf\u{e9} \u{1f600} \u{4e2d}\u{6587}', NULL, NULL, NULL, NULL, NULL, NULL, NULL, '\u{1f600}')",
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
    assert_eq!(exported.rows, 5);
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
    assert_eq!(imported.rows, 5);
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
        exercise_numeric_extremes(&mut connection, &params, &source, &target).await;
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
