//! Run only against disposable local databases: the MySQL test clears its auth cache.
#![cfg(unix)]

use tabularis_lib::drivers::driver_trait::DatabaseDriver;
use tabularis_lib::drivers::mysql::MysqlDriver;
use tabularis_lib::drivers::registry;
use tabularis_lib::models::{ConnectionParams, DatabaseSelection};
use tabularis_lib::pool_manager::{close_pool_with_id, get_mysql_pool_with_id};

fn params(driver: &str, port: u16) -> ConnectionParams {
    ConnectionParams {
        driver: driver.to_string(),
        host: Some("127.0.0.1".to_string()),
        port: Some(port),
        username: Some(
            if driver == "mysql" {
                "root"
            } else {
                "postgres"
            }
            .to_string(),
        ),
        password: Some("password".to_string()),
        database: DatabaseSelection::Single("testdb".to_string()),
        ..Default::default()
    }
}

#[tokio::test]
#[ignore = "requires disposable MySQL on port 33060 and MYSQL_UNIX_SOCKET"]
async fn mysql_socket_auth_and_tcp_regression() {
    let driver = MysqlDriver::new();
    let tcp = params("mysql", 33060);
    driver
        .test_connection(&tcp)
        .await
        .expect("TCP authentication");
    let admin = get_mysql_pool_with_id(&tcp, Some("socket-regression-admin"))
        .await
        .expect("TCP pool");
    sqlx::query("FLUSH PRIVILEGES")
        .execute(&admin)
        .await
        .expect("clear auth cache");

    let mut socket = tcp.clone();
    socket.unix_socket_path = Some(std::env::var("MYSQL_UNIX_SOCKET").expect("MYSQL_UNIX_SOCKET"));
    socket.host = Some("ignored.invalid".to_string());
    socket.ssl_mode = Some("verify-full".to_string());
    let missing = tempfile::tempdir().unwrap();
    socket.ssl_ca = Some(missing.path().join("ca.pem").display().to_string());
    socket.ssl_cert = Some(missing.path().join("cert.pem").display().to_string());
    socket.ssl_key = Some(missing.path().join("key.pem").display().to_string());
    socket.startup_script = Some("SET @socket_probe = 'started'".to_string());

    let mut wrong = socket.clone();
    wrong.password = Some("incorrect-password".to_string());
    assert!(
        driver.test_connection(&wrong).await.is_err(),
        "socket must authenticate passwords"
    );
    driver
        .test_connection(&socket)
        .await
        .expect("cold-cache socket authentication");
    driver
        .test_connection(&socket)
        .await
        .expect("repeat socket authentication");
    for _ in 0..2 {
        let pool = get_mysql_pool_with_id(&socket, Some("socket-regression"))
            .await
            .expect("socket pool");
        let probe: String = sqlx::query_scalar("SELECT @socket_probe")
            .fetch_one(&pool)
            .await
            .expect("startup script on socket pool");
        assert_eq!(probe, "started");
        close_pool_with_id(&socket, Some("socket-regression")).await;
    }
    // A local socket must not disable TLS checks when switching back to TCP.
    socket.unix_socket_path = None;
    socket.host = tcp.host.clone();
    socket.port = tcp.port;
    assert!(
        driver.test_connection(&socket).await.is_err(),
        "TCP must validate TLS files"
    );
    driver
        .test_connection(&tcp)
        .await
        .expect("TCP still works after socket use");
    close_pool_with_id(&tcp, Some("socket-regression-admin")).await;
}

/// Verifies the `postgresql` plugin honors `unix_socket_path`: when a socket
/// path is set, the plugin must dial the socket (not TCP) and ignore the
/// `host`/`port` fields. The built-in postgres driver did this in
/// `pool_manager.rs` (`split_postgres_socket_path` + `build_postgres_configurations`);
/// the plugin must mirror that logic.
///
/// This test **will fail** against plugin rc.14, which does not honor
/// `unix_socket_path` — it dials TCP from `host`/`port` instead. The test
/// documents the expected behavior and will pass once the plugin adds
/// socket support. See the issue filed on tabularis-postgresql-plugin.
///
/// Run with:
///   PG_UNIX_SOCKET=/var/run/postgresql cargo test --test socket_integration \
///     postgresql_plugin_honors_unix_socket -- --ignored --nocapture
#[tokio::test]
#[ignore = "requires disposable PostgreSQL on port 54320, PG_UNIX_SOCKET, and the postgresql plugin installed"]
async fn postgresql_plugin_honors_unix_socket_path() {
    // Bootstrap with external plugins so the postgresql plugin registers.
    tabularis_lib::runtime::bootstrap::install_process_prerequisites();
    let _ = tabularis_lib::runtime::bootstrap::bootstrap_application(
        tabularis_lib::runtime::RuntimeContext::system(),
        tabularis_lib::runtime::bootstrap::BootstrapOptions {
            load_external_plugins: true,
            run_connection_migrations: false,
        },
    )
    .await;

    let drv = registry::get_driver("postgresql")
        .await
        .expect("postgresql plugin must be registered");

    // TCP works (sanity check).
    let tcp = ConnectionParams {
        driver: "postgresql".to_string(),
        host: Some("127.0.0.1".to_string()),
        port: Some(54320),
        username: Some("postgres".to_string()),
        password: Some("password".to_string()),
        database: DatabaseSelection::Single("testdb".to_string()),
        ssl_mode: Some("disable".to_string()),
        ..Default::default()
    };
    drv.test_connection(&tcp)
        .await
        .expect("TCP authentication via postgresql plugin");

    // Socket: set unix_socket_path + a bogus host. If the plugin honors the
    // socket, test_connection succeeds despite the unreachable host. If it
    // dials TCP, it fails to resolve ignored.invalid. The port stays at the
    // server's: for a socket directory the port names the socket file
    // (`.s.PGSQL.<port>`), so changing it would probe a different socket.
    let socket_path = std::env::var("PG_UNIX_SOCKET")
        .expect("PG_UNIX_SOCKET env var must point at the socket dir");
    let mut socket = tcp.clone();
    socket.unix_socket_path = Some(socket_path);
    socket.host = Some("ignored.invalid".to_string());
    socket.port = Some(1);
    socket.ssl_mode = Some("disable".to_string());

    drv.test_connection(&socket).await.expect(
        "postgresql plugin must dial the Unix socket, not TCP — \
                 if this fails, the plugin is ignoring unix_socket_path",
    );

    // TCP still works after the socket test (no state corruption).
    drv.test_connection(&tcp)
        .await
        .expect("TCP still works after socket use");
}
