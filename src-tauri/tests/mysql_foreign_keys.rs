//! Opt-in coverage of the production foreign-key discovery path.
//!
//! Run against a disposable, TLS-enabled local MySQL/MariaDB server:
//! `cargo test --test mysql_foreign_keys -- --ignored --nocapture`
//! Set TABULARIS_TEST_MYSQL=1 and TABULARIS_TEST_MYSQL_HOST, _PORT, _USER,
//! and _PASSWORD explicitly. The account must be able to create databases.
//! Each run creates UUID-named databases and drops only databases it created.
//!
//! The official `mysql` images enable TLS with auto-generated certificates.
//! Stock `mariadb` images do not: mount a CA, certificate and key and start the
//! server with `--ssl-ca`, `--ssl-cert` and `--ssl-key` before running this.
//! CI runs it against MySQL 8.4 and 5.7 in `.github/workflows/mysql-integration.yml`.

use futures::FutureExt;
use sqlx::mysql::{MySqlConnectOptions, MySqlSslMode};
use sqlx::{Connection, Executor, MySqlConnection};
use std::net::IpAddr;
use std::panic::AssertUnwindSafe;
use std::time::Duration;
use tabularis_lib::drivers::mysql;
use tabularis_lib::models::{ConnectionParams, DatabaseSelection};
use tabularis_lib::pool_manager::{close_pool, has_pool_for_database};

const SQL_MODES: [Option<&str>; 4] = [
    None,
    Some("NO_BACKSLASH_ESCAPES"),
    Some("ANSI_QUOTES"),
    Some("NO_BACKSLASH_ESCAPES,ANSI_QUOTES"),
];

fn params_for_mode(
    params: &ConnectionParams,
    text_protocol: bool,
    sql_mode: Option<&str>,
) -> ConnectionParams {
    let mut selected = params.clone();
    selected.enable_cleartext_plugin = Some(text_protocol);
    selected.startup_script = sql_mode.map(|mode| format!("SET SESSION sql_mode='{mode}'"));
    selected
}

fn required_env(suffix: &str) -> String {
    let key = format!("TABULARIS_TEST_MYSQL{suffix}");
    std::env::var(&key).unwrap_or_else(|_| panic!("set {key} explicitly for the disposable server"))
}

fn quoted(identifier: &str) -> String {
    format!("`{}`", identifier.replace('`', "``"))
}

fn table(schema: &str, name: &str) -> String {
    format!("{}.{}", quoted(schema), quoted(name))
}

async fn execute(connection: &mut MySqlConnection, sql: &str) {
    connection
        .execute(sqlx::raw_sql(sql))
        .await
        .unwrap_or_else(|error| panic!("fixture SQL failed: {error}; SQL: {sql}"));
}

type ExpectedKey<'a> = (&'a str, &'a str, &'a str, &'a str, &'a str, &'a str);

async fn assert_keys(
    params: &ConnectionParams,
    table_name: &str,
    schema: Option<&str>,
    expected: &[ExpectedKey<'_>],
) {
    let keys = tokio::time::timeout(
        Duration::from_secs(30),
        mysql::get_foreign_keys(params, table_name, schema),
    )
    .await
    .expect("foreign-key discovery timed out")
    .expect("foreign-key discovery failed");
    let actual: Vec<_> = keys
        .iter()
        .map(|key| {
            (
                key.name.as_str(),
                key.column_name.as_str(),
                key.ref_table.as_str(),
                key.ref_column.as_str(),
                key.on_update.as_deref(),
                key.on_delete.as_deref(),
            )
        })
        .collect();
    let expected: Vec<_> = expected
        .iter()
        .map(|&(name, column, parent, parent_column, update, delete)| {
            (
                name,
                column,
                parent,
                parent_column,
                Some(update),
                Some(delete),
            )
        })
        .collect();
    assert_eq!(
        actual, expected,
        "table={table_name:?}, schema={schema:?}, text_protocol={:?}",
        params.enable_cleartext_plugin
    );
}

async fn exercise_foreign_keys(
    connection: &mut MySqlConnection,
    params: &ConnectionParams,
    schemas: &[String; 2],
) {
    let [first, second] = schemas;
    for schema in schemas {
        execute(connection, &format!(
            "CREATE TABLE {} (id INT PRIMARY KEY, z INT NOT NULL, a INT NOT NULL, UNIQUE (z, a)) ENGINE=InnoDB",
            table(schema, "parent")
        )).await;
    }
    let parent = table(first, "parent");
    execute(
        connection,
        &format!(
            "CREATE TABLE {} (id INT PRIMARY KEY) ENGINE=InnoDB",
            table(first, "empty")
        ),
    )
    .await;
    // The same table/constraint names in another schema have different rules.
    for (schema, update, delete) in [
        (first, "CASCADE", "SET NULL"),
        (second, "RESTRICT", "CASCADE"),
    ] {
        execute(connection, &format!(
            "CREATE TABLE {} (id INT PRIMARY KEY, parent_id INT, CONSTRAINT fk_shared FOREIGN KEY (parent_id) REFERENCES {} (id) ON UPDATE {update} ON DELETE {delete}) ENGINE=InnoDB",
            table(schema, "single"), table(schema, "parent")
        )).await;
    }
    execute(connection, &format!(
        "CREATE TABLE {} (id INT PRIMARY KEY, a_id INT, z_id INT, CONSTRAINT z_fk FOREIGN KEY (z_id) REFERENCES {parent} (id) ON UPDATE RESTRICT ON DELETE CASCADE, CONSTRAINT a_fk FOREIGN KEY (a_id) REFERENCES {parent} (id) ON UPDATE CASCADE ON DELETE SET NULL) ENGINE=InnoDB",
        table(first, "multiple")
    )).await;
    // The FK's z,a order intentionally differs from alphabetical column order.
    execute(connection, &format!(
        "CREATE TABLE {} (id INT PRIMARY KEY, a_col INT, z_col INT, CONSTRAINT fk_composite FOREIGN KEY (z_col, a_col) REFERENCES {parent} (z, a) ON UPDATE CASCADE ON DELETE RESTRICT) ENGINE=InnoDB",
        table(first, "composite")
    )).await;
    execute(connection, &format!(
        "CREATE TABLE {} (id INT PRIMARY KEY, parent_id INT, CONSTRAINT fk_self FOREIGN KEY (parent_id) REFERENCES {} (id) ON UPDATE RESTRICT ON DELETE SET NULL) ENGINE=InnoDB",
        table(first, "self_ref"), table(first, "self_ref")
    )).await;
    execute(
        connection,
        &format!(
            "CREATE TABLE {} (remote_id INT PRIMARY KEY) ENGINE=InnoDB",
            table(second, "remote_parent")
        ),
    )
    .await;
    execute(connection, &format!(
        "CREATE TABLE {} (id INT PRIMARY KEY, remote_id INT, CONSTRAINT fk_cross FOREIGN KEY (remote_id) REFERENCES {} (remote_id) ON UPDATE CASCADE ON DELETE RESTRICT) ENGINE=InnoDB",
        table(first, "cross_ref"), table(second, "remote_parent")
    )).await;
    let unusual_table = "child_'é?`";
    let unusual_column = "parent_'é?`";
    let unusual_constraint = "fk_'é?`";
    execute(connection, &format!(
        "CREATE TABLE {} (id INT PRIMARY KEY, {} INT, CONSTRAINT {} FOREIGN KEY ({}) REFERENCES {parent} (id) ON UPDATE CASCADE ON DELETE SET NULL) ENGINE=InnoDB",
        table(first, unusual_table), quoted(unusual_column), quoted(unusual_constraint), quoted(unusual_column)
    )).await;

    let version: String = sqlx::query_scalar("SELECT VERSION()")
        .fetch_one(&mut *connection)
        .await
        .expect("read server version");
    let numeric: Vec<u32> = version
        .trim_start_matches("5.5.5-")
        .split(['.', '-'])
        .take(2)
        .map(|part| part.parse().expect("numeric server version"))
        .collect();
    let table_scoped_names =
        version.contains("MariaDB") && numeric.as_slice() >= [12, 1].as_slice();
    if table_scoped_names {
        execute(connection, &format!(
            "CREATE TABLE {} (id INT PRIMARY KEY, parent_id INT, CONSTRAINT fk_shared FOREIGN KEY (parent_id) REFERENCES {parent} (id) ON UPDATE RESTRICT ON DELETE RESTRICT) ENGINE=InnoDB",
            table(first, "same_constraint_other_table")
        )).await;
    }
    eprintln!("foreign-key fixture server: {version}; table-scoped FK names: {table_scoped_names}");

    for text_protocol in [false, true] {
        for sql_mode in SQL_MODES {
            let selected = params_for_mode(params, text_protocol, sql_mode);
            eprintln!("foreign-key coverage: text_protocol={text_protocol}, sql_mode={sql_mode:?}");
            assert_keys(&selected, "empty", None, &[]).await;
            assert_keys(&selected, "missing_table", None, &[]).await;
            assert_keys(
                &selected,
                "single",
                None,
                &[(
                    "fk_shared",
                    "parent_id",
                    "parent",
                    "id",
                    "CASCADE",
                    "SET NULL",
                )],
            )
            .await;
            assert_keys(
                &selected,
                "single",
                Some(second),
                &[(
                    "fk_shared",
                    "parent_id",
                    "parent",
                    "id",
                    "RESTRICT",
                    "CASCADE",
                )],
            )
            .await;
            assert_keys(
                &selected,
                "multiple",
                Some(first),
                &[
                    ("a_fk", "a_id", "parent", "id", "CASCADE", "SET NULL"),
                    ("z_fk", "z_id", "parent", "id", "RESTRICT", "CASCADE"),
                ],
            )
            .await;
            assert_keys(
                &selected,
                "composite",
                None,
                &[
                    (
                        "fk_composite",
                        "z_col",
                        "parent",
                        "z",
                        "CASCADE",
                        "RESTRICT",
                    ),
                    (
                        "fk_composite",
                        "a_col",
                        "parent",
                        "a",
                        "CASCADE",
                        "RESTRICT",
                    ),
                ],
            )
            .await;
            assert_keys(
                &selected,
                "self_ref",
                None,
                &[(
                    "fk_self",
                    "parent_id",
                    "self_ref",
                    "id",
                    "RESTRICT",
                    "SET NULL",
                )],
            )
            .await;
            assert_keys(
                &selected,
                "cross_ref",
                None,
                &[(
                    "fk_cross",
                    "remote_id",
                    "remote_parent",
                    "remote_id",
                    "CASCADE",
                    "RESTRICT",
                )],
            )
            .await;
            assert_keys(
                &selected,
                unusual_table,
                Some(first),
                &[(
                    unusual_constraint,
                    unusual_column,
                    "parent",
                    "id",
                    "CASCADE",
                    "SET NULL",
                )],
            )
            .await;
            if table_scoped_names {
                assert_keys(
                    &selected,
                    "same_constraint_other_table",
                    None,
                    &[(
                        "fk_shared",
                        "parent_id",
                        "parent",
                        "id",
                        "RESTRICT",
                        "RESTRICT",
                    )],
                )
                .await;
            }
        }
    }
}

#[tokio::test]
#[ignore = "requires an explicitly configured disposable local MySQL/MariaDB server with TLS"]
async fn foreign_key_discovery_preserves_metadata_and_schema_isolation() {
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

    let prefix = format!("tabularis_fk_{}", uuid::Uuid::new_v4().simple());
    let schemas = [format!("{prefix}_é'?"), format!("{prefix}_other")];
    let params = ConnectionParams {
        driver: "mysql".into(),
        host: Some(host),
        port: Some(port),
        username: Some(username),
        password: Some(password),
        database: DatabaseSelection::Single(schemas[0].clone()),
        ssl_mode: Some("required".into()),
        ..Default::default()
    };
    let mut missing_database_params = params.clone();
    missing_database_params.database = DatabaseSelection::Single(format!("{prefix}_missing"));
    let mut created = Vec::new();
    // Catch assertion/DDL failures so cleanup still runs. No IF NOT EXISTS:
    // an unexpected collision must never grant ownership of another database.
    let outcome = AssertUnwindSafe(async {
        for schema in &schemas {
            execute(
                &mut connection,
                &format!("CREATE DATABASE {} CHARACTER SET utf8mb4", quoted(schema)),
            )
            .await;
            created.push(schema.clone());
        }
        exercise_foreign_keys(&mut connection, &params, &schemas).await;
        for text_protocol in [false, true] {
            let selected = params_for_mode(&missing_database_params, text_protocol, None);
            let error = tokio::time::timeout(
                Duration::from_secs(30),
                mysql::get_foreign_keys(&selected, "single", None),
            )
            .await
            .expect("missing-database connection timed out instead of returning an error")
            .expect_err("connecting to an uncreated database must fail");
            assert!(
                error.contains(selected.database.primary()),
                "expected the missing database in the connection error, got: {error}"
            );
            assert!(
                !has_pool_for_database(&selected, None, None).await,
                "a failed connection must not leave a cached pool"
            );
        }
    })
    .catch_unwind()
    .await;

    for text_protocol in [false, true] {
        for sql_mode in SQL_MODES {
            close_pool(&params_for_mode(&params, text_protocol, sql_mode)).await;
        }
        close_pool(&params_for_mode(
            &missing_database_params,
            text_protocol,
            None,
        ))
        .await;
    }
    let mut cleanup_errors = Vec::new();
    // The first schema references the second, so remove the first one first.
    for schema in created {
        let sql = format!("DROP DATABASE {}", quoted(&schema));
        if let Err(error) = connection.execute(sqlx::raw_sql(&sql)).await {
            cleanup_errors.push(format!("{schema}: {error}"));
        }
    }
    if let Err(panic) = outcome {
        if !cleanup_errors.is_empty() {
            eprintln!("fixture cleanup failed: {cleanup_errors:?}");
        }
        std::panic::resume_unwind(panic);
    }
    assert!(
        cleanup_errors.is_empty(),
        "fixture cleanup failed: {cleanup_errors:?}"
    );
}
