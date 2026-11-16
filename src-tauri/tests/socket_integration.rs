//! Run only against disposable local databases: the MySQL test clears its auth cache.
#![cfg(unix)]

use tabularis_lib::drivers::driver_trait::DatabaseDriver;
use tabularis_lib::drivers::{mysql::MysqlDriver, postgres::PostgresDriver};
use tabularis_lib::models::{ConnectionParams, DatabaseSelection};
use tabularis_lib::pool_manager::{
    close_pool_with_id, get_mysql_pool_with_id, get_postgres_pool_with_id,
};

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
    socket.port = Some(1);
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

#[tokio::test]
#[ignore = "requires disposable PostgreSQL on port 54320 and PG_UNIX_SOCKET"]
async fn postgres_socket_tls_and_tcp_regression() {
    let driver = PostgresDriver::new();
    let mut tcp = params("postgres", 54320);
    driver
        .test_connection(&tcp)
        .await
        .expect("TCP authentication");
    let missing = tempfile::tempdir().unwrap();
    tcp.ssl_mode = Some("verify-full".to_string());
    tcp.ssl_ca = Some(missing.path().join("ca.pem").display().to_string());
    tcp.ssl_cert = Some(missing.path().join("cert.pem").display().to_string());
    tcp.ssl_key = Some(missing.path().join("key.pem").display().to_string());
    assert!(
        driver.test_connection(&tcp).await.is_err(),
        "TCP must validate TLS files"
    );
    let mut socket = tcp.clone();
    socket.unix_socket_path = Some(std::env::var("PG_UNIX_SOCKET").expect("PG_UNIX_SOCKET"));
    socket.host = Some("ignored.invalid".to_string());
    socket.port = Some(1);
    socket.startup_script = Some("SET application_name = 'socket_probe'".to_string());
    driver
        .test_connection(&socket)
        .await
        .expect("socket ignores inactive TLS files");
    for _ in 0..2 {
        let pool = get_postgres_pool_with_id(&socket, Some("socket-regression"))
            .await
            .expect("socket pool");
        let client = pool.get().await.expect("socket checkout");
        let row = client
            .query_one("SELECT current_setting('application_name')", &[])
            .await
            .expect("startup script on socket pool");
        assert_eq!(row.get::<_, String>(0), "socket_probe");
        drop(client);
        close_pool_with_id(&socket, Some("socket-regression")).await;
    }
    driver
        .test_connection(&params("postgres", 54320))
        .await
        .expect("TCP still works after socket use");
}
