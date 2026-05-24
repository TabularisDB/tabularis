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

// ---------------------------------------------------------------------------
// execute_batch — session-state continuity across statements.
// Each test invokes the driver-level `execute_batch` directly; the Tauri
// command layer is a thin wrapper so verifying the driver contract is
// sufficient.
// ---------------------------------------------------------------------------

async fn wait_for_mysql(params: &ConnectionParams) -> bool {
    for _ in 0..10 {
        if mysql::get_tables(params, None).await.is_ok() {
            return true;
        }
        sleep(Duration::from_millis(500)).await;
    }
    false
}

async fn wait_for_postgres(params: &ConnectionParams) -> bool {
    for _ in 0..10 {
        if postgres::get_tables(params, "public").await.is_ok() {
            return true;
        }
        sleep(Duration::from_millis(500)).await;
    }
    false
}

/// `SET @pid = LAST_INSERT_ID()` must survive into the two following
/// INSERT statements so the children link to the freshly inserted parent.
#[tokio::test]
#[ignore]
async fn test_mysql_batch_preserves_user_variable_and_last_insert_id() {
    let params = get_mysql_params();
    if !wait_for_mysql(&params).await {
        eprintln!("SKIPPING: MySQL not reachable on 33060");
        return;
    }

    // Ensure a clean slate. Child first because of the FK-shaped dependency.
    let _ = mysql::execute_query(
        &params,
        "DROP TABLE IF EXISTS test_batch_child",
        None,
        1,
        None,
    )
    .await;
    let _ = mysql::execute_query(
        &params,
        "DROP TABLE IF EXISTS test_batch_parent",
        None,
        1,
        None,
    )
    .await;

    let queries: Vec<String> = [
        "CREATE TABLE test_batch_parent (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(50))",
        "CREATE TABLE test_batch_child (id INT AUTO_INCREMENT PRIMARY KEY, parent_id INT, name VARCHAR(50))",
        "INSERT INTO test_batch_parent (name) VALUES ('A')",
        "SET @pid = LAST_INSERT_ID()",
        "INSERT INTO test_batch_child (parent_id, name) VALUES (@pid, 'A-1')",
        "INSERT INTO test_batch_child (parent_id, name) VALUES (@pid, 'A-2')",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();

    let results = mysql::execute_batch(&params, &queries, None, 1, None)
        .await
        .expect("batch setup should succeed");

    assert_eq!(results.len(), queries.len(), "one result per statement");
    for (i, r) in results.iter().enumerate() {
        assert!(
            r.error.is_none(),
            "stmt {} ({}) failed: {:?}",
            i,
            queries[i],
            r.error
        );
    }

    let select = mysql::execute_query(
        &params,
        "SELECT id, parent_id FROM test_batch_child ORDER BY id",
        None,
        1,
        None,
    )
    .await
    .expect("select should succeed");
    assert_eq!(select.rows.len(), 2, "both children should be inserted");
    let parent_id_col = select
        .columns
        .iter()
        .position(|c| c == "parent_id")
        .expect("parent_id column");
    let pid1 = select.rows[0][parent_id_col].as_i64();
    let pid2 = select.rows[1][parent_id_col].as_i64();
    assert!(
        pid1.is_some(),
        "child 1 parent_id must not be NULL — @pid didn't survive across statements"
    );
    assert_eq!(
        pid1, pid2,
        "both children must reference the same parent (got {:?} and {:?})",
        pid1, pid2
    );

    // Cleanup
    let _ =
        mysql::execute_query(&params, "DROP TABLE test_batch_child", None, 1, None).await;
    let _ =
        mysql::execute_query(&params, "DROP TABLE test_batch_parent", None, 1, None).await;
}

/// Explicit `BEGIN`/`COMMIT` must span the batch — both inserts commit
/// atomically inside the transaction.
#[tokio::test]
#[ignore]
async fn test_mysql_batch_preserves_transaction_atomicity() {
    let params = get_mysql_params();
    if !wait_for_mysql(&params).await {
        eprintln!("SKIPPING: MySQL not reachable on 33060");
        return;
    }

    let _ = mysql::execute_query(&params, "DROP TABLE IF EXISTS test_batch_tx", None, 1, None)
        .await;

    let queries: Vec<String> = [
        "CREATE TABLE test_batch_tx (id INT AUTO_INCREMENT PRIMARY KEY, val VARCHAR(20))",
        "BEGIN",
        "INSERT INTO test_batch_tx (val) VALUES ('tx-1')",
        "INSERT INTO test_batch_tx (val) VALUES ('tx-2')",
        "COMMIT",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();

    let results = mysql::execute_batch(&params, &queries, None, 1, None)
        .await
        .expect("batch setup should succeed");
    for (i, r) in results.iter().enumerate() {
        assert!(
            r.error.is_none(),
            "stmt {} ({}) failed: {:?}",
            i,
            queries[i],
            r.error
        );
    }

    let select = mysql::execute_query(
        &params,
        "SELECT val FROM test_batch_tx ORDER BY id",
        None,
        1,
        None,
    )
    .await
    .expect("select should succeed");
    assert_eq!(select.rows.len(), 2, "both inserts must be committed");
    let val_col = select
        .columns
        .iter()
        .position(|c| c == "val")
        .expect("val column");
    assert_eq!(select.rows[0][val_col].as_str(), Some("tx-1"));
    assert_eq!(select.rows[1][val_col].as_str(), Some("tx-2"));

    let _ = mysql::execute_query(&params, "DROP TABLE test_batch_tx", None, 1, None).await;
}

/// A `TEMP TABLE` created inside a transaction must be visible to a
/// subsequent `SELECT` in the same batch — i.e. all statements observe
/// the same session.
#[tokio::test]
#[ignore]
async fn test_postgres_batch_preserves_temp_table_and_transaction() {
    let params = get_postgres_params();
    if !wait_for_postgres(&params).await {
        eprintln!("SKIPPING: Postgres not reachable on 54320");
        return;
    }

    let queries: Vec<String> = [
        "BEGIN",
        "CREATE TEMP TABLE test_batch_tmp (id SERIAL PRIMARY KEY, val TEXT)",
        "INSERT INTO test_batch_tmp (val) VALUES ('a'), ('b'), ('c')",
        "SELECT COUNT(*)::int AS n FROM test_batch_tmp",
        "COMMIT",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();

    let results = postgres::execute_batch(&params, &queries, None, 1, None)
        .await
        .expect("batch setup should succeed");

    assert_eq!(results.len(), queries.len());
    for (i, r) in results.iter().enumerate() {
        assert!(
            r.error.is_none(),
            "stmt {} ({}) failed: {:?}",
            i,
            queries[i],
            r.error
        );
    }

    // The SELECT is at index 3; verify the temp table was visible and held 3 rows.
    let count_result = results[3]
        .result
        .as_ref()
        .expect("SELECT statement must return a result set");
    assert_eq!(count_result.rows.len(), 1);
    let n = count_result.rows[0][0].as_i64();
    assert_eq!(
        n,
        Some(3),
        "temp table must contain 3 rows and be visible to the SELECT (got {:?})",
        n
    );
}

// ---------------------------------------------------------------------------
// affected_rows — drivers must report the real INSERT/UPDATE/DELETE row
// count rather than a constant zero.
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_mysql_affected_rows_reported_correctly() {
    let params = get_mysql_params();
    if !wait_for_mysql(&params).await {
        eprintln!("SKIPPING: MySQL not reachable on 33060");
        return;
    }

    let _ = mysql::execute_query(
        &params,
        "DROP TABLE IF EXISTS test_affected",
        None,
        1,
        None,
    )
    .await;

    let queries: Vec<String> = [
        "CREATE TABLE test_affected (id INT AUTO_INCREMENT PRIMARY KEY, v INT)",
        "INSERT INTO test_affected (v) VALUES (1), (2), (3)",
        "UPDATE test_affected SET v = v + 10 WHERE v >= 2",
        "DELETE FROM test_affected WHERE v >= 12",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();

    let results = mysql::execute_batch(&params, &queries, None, 1, None)
        .await
        .expect("batch setup should succeed");

    for (i, r) in results.iter().enumerate() {
        assert!(
            r.error.is_none(),
            "stmt {} ({}) failed: {:?}",
            i,
            queries[i],
            r.error
        );
    }

    // Index 1: INSERT 3 rows → 3
    let insert_result = results[1]
        .result
        .as_ref()
        .expect("INSERT should return a QueryResult");
    assert_eq!(
        insert_result.affected_rows, 3,
        "INSERT of 3 rows should report 3 affected"
    );

    // Index 2: UPDATE matching 2 rows → 2
    let update_result = results[2]
        .result
        .as_ref()
        .expect("UPDATE should return a QueryResult");
    assert_eq!(
        update_result.affected_rows, 2,
        "UPDATE matching 2 rows should report 2 affected"
    );

    // Index 3: DELETE matching 2 rows → 2
    let delete_result = results[3]
        .result
        .as_ref()
        .expect("DELETE should return a QueryResult");
    assert_eq!(
        delete_result.affected_rows, 2,
        "DELETE matching 2 rows should report 2 affected"
    );

    let _ = mysql::execute_query(&params, "DROP TABLE test_affected", None, 1, None).await;
}

#[tokio::test]
#[ignore]
async fn test_postgres_affected_rows_reported_correctly() {
    let params = get_postgres_params();
    if !wait_for_postgres(&params).await {
        eprintln!("SKIPPING: Postgres not reachable on 54320");
        return;
    }

    let _ = postgres::execute_query(
        &params,
        "DROP TABLE IF EXISTS test_affected",
        None,
        1,
        None,
    )
    .await;

    let queries: Vec<String> = [
        "CREATE TABLE test_affected (id SERIAL PRIMARY KEY, v INT)",
        "INSERT INTO test_affected (v) VALUES (1), (2), (3)",
        "UPDATE test_affected SET v = v + 10 WHERE v >= 2",
        "DELETE FROM test_affected WHERE v >= 12",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();

    let results = postgres::execute_batch(&params, &queries, None, 1, None)
        .await
        .expect("batch setup should succeed");

    for (i, r) in results.iter().enumerate() {
        assert!(
            r.error.is_none(),
            "stmt {} ({}) failed: {:?}",
            i,
            queries[i],
            r.error
        );
    }

    let insert_result = results[1].result.as_ref().expect("INSERT result");
    assert_eq!(insert_result.affected_rows, 3, "INSERT should report 3");

    let update_result = results[2].result.as_ref().expect("UPDATE result");
    assert_eq!(update_result.affected_rows, 2, "UPDATE should report 2");

    let delete_result = results[3].result.as_ref().expect("DELETE result");
    assert_eq!(delete_result.affected_rows, 2, "DELETE should report 2");

    let _ = postgres::execute_query(&params, "DROP TABLE test_affected", None, 1, None).await;
}

// ---------------------------------------------------------------------------
// cancel_query — when several queries share the same connection_id slot,
// a single cancel must abort all of them, not just the most recently
// registered handle. This guards against the prior bug where the second
// `handles.insert(connection_id, ...)` orphaned the first abort handle.
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore]
async fn test_concurrent_cancel_aborts_all_in_flight_queries() {
    use std::sync::Arc;
    use tabularis_lib::commands::QueryCancellationState;
    use tokio::task::AbortHandle;

    let params = get_mysql_params();
    if mysql::get_tables(&params, None).await.is_err() {
        eprintln!("SKIPPING concurrent-cancel test: MySQL container not reachable on 33060");
        return;
    }

    let state = QueryCancellationState::default();
    let connection_id = "concurrent-cancel-test".to_string();

    let p_a = params.clone();
    let task_a = tokio::spawn(async move {
        mysql::execute_query(&p_a, "SELECT SLEEP(5)", None, 1, None).await
    });
    let p_b = params.clone();
    let task_b = tokio::spawn(async move {
        mysql::execute_query(&p_b, "SELECT SLEEP(5)", None, 1, None).await
    });

    let handle_a: Arc<AbortHandle> = Arc::new(task_a.abort_handle());
    let handle_b: Arc<AbortHandle> = Arc::new(task_b.abort_handle());
    {
        let mut guard = state.handles.lock().unwrap();
        guard
            .entry(connection_id.clone())
            .or_default()
            .push(handle_a.clone());
        guard
            .entry(connection_id.clone())
            .or_default()
            .push(handle_b.clone());
    }

    sleep(Duration::from_millis(300)).await;

    let drained: Vec<Arc<AbortHandle>> = state
        .handles
        .lock()
        .unwrap()
        .remove(&connection_id)
        .unwrap_or_default();
    assert_eq!(
        drained.len(),
        2,
        "Both abort handles must survive in the slot; only one survived = handles map was overwritten"
    );
    for h in &drained {
        h.abort();
    }

    let r_a = task_a.await.expect_err("task A must be cancelled");
    let r_b = task_b.await.expect_err("task B must be cancelled");
    assert!(r_a.is_cancelled(), "task A should report cancellation");
    assert!(r_b.is_cancelled(), "task B should report cancellation");

    assert!(
        state.handles.lock().unwrap().get(&connection_id).is_none(),
        "slot should be cleared after cancellation"
    );
}
