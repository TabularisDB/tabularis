use std::time::Duration;
use tabularis_lib::drivers::{mysql, postgres};
use tabularis_lib::models::{ConnectionParams, DatabaseSelection};
use tokio::time::sleep;

// Helper to construct connection params
fn get_mysql_params() -> ConnectionParams {
    ConnectionParams {
        driver: "mysql".to_string(),
        host: Some("127.0.0.1".to_string()),
        port: Some(33060),
        username: Some("root".to_string()),
        password: Some("password".to_string()),
        database: DatabaseSelection::Single("testdb".to_string()),
        ssl_mode: None,
        ssl_ca: None,
        ssl_cert: None,
        ssl_key: None,
        ssh_enabled: None,
        ssh_connection_id: None,
        ssh_host: None,
        ssh_port: None,
        ssh_user: None,
        ssh_password: None,
        ssh_key_file: None,
        ssh_key_passphrase: None,
        save_in_keychain: None,
        connection_id: None,
        ..Default::default()
    }
}

fn get_postgres_params() -> ConnectionParams {
    ConnectionParams {
        driver: "postgres".to_string(),
        host: Some("127.0.0.1".to_string()),
        port: Some(54320),
        username: Some("postgres".to_string()),
        password: Some("password".to_string()),
        database: DatabaseSelection::Single("testdb".to_string()),
        ssl_mode: None,
        ssl_ca: None,
        ssl_cert: None,
        ssl_key: None,
        ssh_enabled: None,
        ssh_connection_id: None,
        ssh_host: None,
        ssh_port: None,
        ssh_user: None,
        ssh_password: None,
        ssh_key_file: None,
        ssh_key_passphrase: None,
        save_in_keychain: None,
        connection_id: None,
        ..Default::default()
    }
}

#[tokio::test]
#[ignore] // Ignored by default in CI/local unless explicitly requested with --include-ignored
async fn test_mysql_integration_flow() {
    let params = get_mysql_params();

    // 1. Wait for DB to be ready (simple retry loop)
    let mut connected = false;
    for _ in 0..10 {
        if mysql::get_tables(&params, None).await.is_ok() {
            connected = true;
            break;
        }
        sleep(Duration::from_millis(500)).await;
    }

    if !connected {
        eprintln!("SKIPPING MySQL Test: Could not connect to Docker container on port 33060");
        return;
    }

    // 2. Create Table
    let create_sql = "CREATE TABLE IF NOT EXISTS test_users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100),
        email VARCHAR(100)
    )";
    let res = mysql::execute_query(&params, create_sql, None, 1, None).await;
    assert!(
        res.is_ok(),
        "Failed to create table in MySQL: {:?}",
        res.err()
    );

    // 3. Clean table (idempotency)
    let _ = mysql::execute_query(&params, "TRUNCATE TABLE test_users", None, 1, None).await;

    // 4. Insert Data
    let insert_sql =
        "INSERT INTO test_users (name, email) VALUES ('Mario Rossi', 'mario@test.com')";
    let res = mysql::execute_query(&params, insert_sql, None, 1, None).await;
    assert!(res.is_ok(), "Failed to insert data in MySQL");

    // 5. Select Data
    let select_sql = "SELECT * FROM test_users WHERE email = 'mario@test.com'";
    let res = mysql::execute_query(&params, select_sql, None, 1, None).await;
    match res {
        Ok(data) => {
            assert_eq!(data.rows.len(), 1, "Expected 1 row");
            // Check name (column index 1 usually, but depends on schema order. Using JSON extraction logic from driver)
            // The driver returns Vec<serde_json::Value>.
            // Row structure: [id, name, email]
            // We need to find the index of "name"
            let name_idx = data
                .columns
                .iter()
                .position(|c| c == "name")
                .expect("Column 'name' not found");
            let name_val = &data.rows[0][name_idx];
            assert_eq!(name_val.as_str(), Some("Mario Rossi"));
        }
        Err(e) => panic!("Select failed: {}", e),
    }

    // 6. Cleanup
    let _ = mysql::execute_query(&params, "DROP TABLE test_users", None, 1, None).await;
}

#[tokio::test]
#[ignore] // Ignored by default
async fn test_postgres_integration_flow() {
    let params = get_postgres_params();

    // 1. Wait for DB
    let mut connected = false;
    for _ in 0..10 {
        if postgres::get_tables(&params, "public").await.is_ok() {
            connected = true;
            break;
        }
        sleep(Duration::from_millis(500)).await;
    }

    if !connected {
        eprintln!("SKIPPING Postgres Test: Could not connect to Docker container on port 54320");
        return;
    }

    // 2. Create Table
    let create_sql = "CREATE TABLE IF NOT EXISTS test_users (
        id SERIAL PRIMARY KEY,
        name TEXT,
        email TEXT
    )";
    let res = postgres::execute_query(&params, create_sql, None, 1, None).await;
    assert!(
        res.is_ok(),
        "Failed to create table in Postgres: {:?}",
        res.err()
    );

    // 3. Clean table
    let _ = postgres::execute_query(&params, "TRUNCATE TABLE test_users", None, 1, None).await;

    // 4. Insert Data
    let insert_sql =
        "INSERT INTO test_users (name, email) VALUES ('Luigi Verdi', 'luigi@test.com')";
    let res = postgres::execute_query(&params, insert_sql, None, 1, None).await;
    assert!(res.is_ok(), "Failed to insert data in Postgres");

    // 5. Select Data
    let select_sql = "SELECT * FROM test_users WHERE email = 'luigi@test.com'";
    let res = postgres::execute_query(&params, select_sql, None, 1, None).await;
    match res {
        Ok(data) => {
            assert_eq!(data.rows.len(), 1, "Expected 1 row");
            let name_idx = data
                .columns
                .iter()
                .position(|c| c == "name")
                .expect("Column 'name' not found");
            let name_val = &data.rows[0][name_idx];
            assert_eq!(name_val.as_str(), Some("Luigi Verdi"));
        }
        Err(e) => panic!("Select failed: {}", e),
    }

    // 6. Cleanup
    let _ = postgres::execute_query(&params, "DROP TABLE test_users", None, 1, None).await;
}
