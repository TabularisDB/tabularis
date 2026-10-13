use futures::FutureExt;
use sqlx::mysql::{MySqlConnectOptions, MySqlSslMode};
use sqlx::{Connection, Executor, MySqlConnection};
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

async fn exercise_float_identity(connection: &mut MySqlConnection, params: &ConnectionParams) {
    execute(connection, "CREATE TABLE float_demo (price FLOAT, unsigned_price FLOAT UNSIGNED, precise DOUBLE, marker INT, payload BLOB)").await;
    for text_protocol in [false, true] {
        let params = ConnectionParams {
            enable_cleartext_plugin: Some(text_protocol),
            ..params.clone()
        };
        execute(connection, "TRUNCATE TABLE float_demo").await;
        execute(connection, "INSERT INTO float_demo VALUES (89.9,89.9,89.9000015258789,0,X'0102'),(89.9,89.9,89.9000015258789,0,X'0102'),(59.99,59.99,59.99,0,X'0102'),(29.5,29.5,29.5,0,X'0102')").await;
        let result = mysql::execute_query(
            &params,
            "SELECT price, unsigned_price, precise FROM float_demo ORDER BY price DESC",
            None,
            1,
            None,
        )
        .await
        .expect("read FLOAT values");
        assert_eq!(result.rows.len(), 4);
        for (row, expected) in result.rows.iter().zip([89.9, 89.9, 59.99, 29.5]) {
            assert_eq!(row[0], serde_json::json!(expected));
            assert_eq!(row[1], serde_json::json!(expected));
        }
        assert_eq!(result.rows[0][2], serde_json::json!(89.9000015258789));
        let columns = mysql::get_columns(&params, "float_demo", None)
            .await
            .expect("column types");
        assert_eq!(columns[0].data_type, "float");
        assert_eq!(columns[1].data_type, "float");
        for row in [&result.rows[0], &result.rows[2], &result.rows[3]] {
            let mut identity = std::collections::HashMap::from([
                ("price".to_string(), row[0].clone()),
                ("unsigned_price".to_string(), row[1].clone()),
                ("precise".to_string(), row[2].clone()),
                ("marker".to_string(), serde_json::json!(0)),
            ]);
            let blob =
                mysql::fetch_blob_column_as_data_url(&params, "float_demo", "payload", &identity)
                    .await
                    .expect("fetch blob by displayed FLOAT identity");
            assert!(blob.ends_with("AQI="));
            assert_eq!(
                mysql::update_record(
                    &params,
                    "float_demo",
                    &identity,
                    "marker",
                    serde_json::json!(1),
                    1024
                )
                .await
                .expect("update by displayed FLOAT identity"),
                1
            );
            identity.insert("marker".to_string(), serde_json::json!(1));
            assert_eq!(
                mysql::delete_record(&params, "float_demo", &identity)
                    .await
                    .expect("delete by displayed FLOAT identity"),
                1
            );
        }
        let remaining =
            mysql::execute_query(&params, "SELECT price FROM float_demo", None, 1, None)
                .await
                .expect("duplicate survives LIMIT 1");
        assert_eq!(remaining.rows, vec![vec![serde_json::json!(89.9)]]);
        close_pool(&params).await;
    }
}

#[tokio::test]
#[ignore = "requires an explicitly configured disposable local MySQL/MariaDB server with TLS"]
async fn float_display_and_keyless_row_identity() {
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

    let schema = format!("tabularis_float_{}", uuid::Uuid::new_v4().simple());
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
        execute(&mut connection, &format!("USE {}", quoted(&schema))).await;
        exercise_float_identity(&mut connection, &params).await;
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
