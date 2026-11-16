use super::*;

fn state() -> DumpCancellationState {
    DumpCancellationState::default()
}

#[test]
fn cancel_reports_when_nothing_is_running() {
    assert!(cancel(&state(), None, "missing").is_err());
}

#[test]
fn cancel_flags_only_the_matching_transfer() {
    let state = state();
    let mine = Arc::new(AtomicBool::new(false));
    let other = Arc::new(AtomicBool::new(false));
    {
        let mut flags = state.table_transfers.lock().unwrap();
        flags.insert(transfer_key(None, "a"), mine.clone());
        flags.insert(transfer_key(None, "b"), other.clone());
    }
    cancel(&state, None, "a").unwrap();
    assert!(mine.load(Ordering::SeqCst));
    assert!(!other.load(Ordering::SeqCst));
}

#[test]
fn session_cleanup_only_touches_that_sessions_transfers() {
    let state = state();
    let session = Uuid::new_v4();
    let theirs = Arc::new(AtomicBool::new(false));
    let ours = Arc::new(AtomicBool::new(false));
    {
        let mut flags = state.table_transfers.lock().unwrap();
        flags.insert(transfer_key(Some(session), "a"), ours.clone());
        flags.insert(transfer_key(Some(Uuid::new_v4()), "a"), theirs.clone());
    }
    cancel_session_transfers(&state, session);
    assert!(ours.load(Ordering::SeqCst));
    assert!(!theirs.load(Ordering::SeqCst));
}

#[test]
fn dropping_the_registration_cancels_and_unregisters() {
    let state = state();
    let flag = Arc::new(AtomicBool::new(false));
    let key = transfer_key(None, "x");
    state.table_transfers.lock().unwrap().insert(key.clone(), flag.clone());
    drop(Registration { state: state.table_transfers.clone(), key, flag: flag.clone() });
    assert!(flag.load(Ordering::SeqCst));
    assert!(state.table_transfers.lock().unwrap().is_empty());
}

fn binding(name: &str, kind: crate::table_transfer::SourceKind) -> ColumnBinding {
    use crate::table_transfer::*;
    let target = TargetType::Pg(PgTarget::Int(32));
    ColumnBinding {
        source_column: name.into(),
        source_kind: kind,
        target_column: name.into(),
        conversion: types_plan(kind, &target),
        target_type: target,
    }
}

fn types_plan(
    kind: crate::table_transfer::SourceKind,
    target: &crate::table_transfer::TargetType,
) -> crate::table_transfer::Conversion {
    let _ = (kind, target);
    crate::table_transfer::Conversion {
        op: crate::table_transfer::Op::Copy,
        out: crate::table_transfer::OutKind::Int,
        rule: crate::table_transfer::ConversionRule::Exact,
    }
}

#[test]
fn generated_sql_quotes_identifiers_and_never_truncates_or_upserts() {
    use crate::table_transfer::SourceKind;
    let bindings = [binding("id", SourceKind::Int), binding("we\"ird", SourceKind::Int)];
    let sql = postgres::insert_sql("public", "t", &bindings, 2, ConflictMode::Fail);
    assert_eq!(
        sql,
        "INSERT INTO \"public\".\"t\" (\"id\", \"we\"\"ird\") VALUES \
         (CAST($1 AS integer), CAST($2 AS integer)), (CAST($3 AS integer), CAST($4 AS integer))"
    );
    let skip = postgres::insert_sql("public", "t", &bindings, 1, ConflictMode::Skip);
    assert!(skip.ends_with("ON CONFLICT DO NOTHING"));
    assert!(!skip.contains("UPDATE") && !skip.to_uppercase().contains("TRUNCATE"));
    let select = postgres::select_sql("s", "t", &[binding("n", SourceKind::Decimal)]);
    assert_eq!(select, "SELECT \"n\"::text FROM \"s\".\"t\"");
}

// --- Real PostgreSQL / SQLite transfers -------------------------------------
//
// Same fixture as `tests/postgres_integration` (127.0.0.1:54320, testdb). The
// tests skip when PostgreSQL is not reachable. Each test works in its own
// uniquely named schema / temp file and removes it afterwards.

use crate::table_transfer::TableSelection;
use std::sync::Mutex as StdMutex;

struct Events {
    cancel_when_written: Option<(Arc<AtomicBool>, u64)>,
    progress: StdMutex<Vec<serde_json::Value>>,
}

impl crate::runtime::events::RuntimeEvents for Events {
    fn emit(&self, _event: &str, payload: serde_json::Value) -> Result<(), String> {
        if let Some((flag, threshold)) = &self.cancel_when_written {
            if payload["rows_written"].as_u64().unwrap_or(0) >= *threshold {
                flag.store(true, Ordering::SeqCst);
            }
        }
        self.progress.lock().unwrap().push(payload);
        Ok(())
    }

    fn emit_to(&self, _: Uuid, event: &str, payload: serde_json::Value) -> Result<(), String> {
        self.emit(event, payload)
    }
}

fn pg_params() -> ConnectionParams {
    ConnectionParams {
        driver: "postgres".into(),
        host: Some("127.0.0.1".into()),
        port: Some(54320),
        username: Some("postgres".into()),
        password: Some("password".into()),
        database: DatabaseSelection::Single("testdb".into()),
        ..Default::default()
    }
}

async fn endpoint(params: ConnectionParams, schema: &str) -> Endpoint {
    crate::drivers::registry::register_driver(crate::drivers::postgres::PostgresDriver::new()).await;
    crate::drivers::registry::register_driver(crate::drivers::sqlite::SqliteDriver::new()).await;
    let driver = params.driver.clone();
    Endpoint {
        dialect: dialect_for_driver(&driver).unwrap(),
        drv: crate::drivers::registry::get_connection_driver(&params).await.unwrap(),
        schema: schema.to_string(),
        driver,
        params,
    }
}

async fn pg_exec(sql: &str) {
    let pool = get_postgres_pool(&pg_params()).await.unwrap();
    let client = pool.get().await.unwrap();
    client.batch_execute(sql).await.unwrap();
}

async fn pg_scalar(sql: &str) -> String {
    let pool = get_postgres_pool(&pg_params()).await.unwrap();
    let client = pool.get().await.unwrap();
    client.query_one(sql, &[]).await.unwrap().get::<_, String>(0)
}

const SOURCE_ROWS: i64 = 1_250;

/// Pooled connections belong to the runtime that opened them, so tests that
/// share the PostgreSQL fixture run one at a time.
static FIXTURE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

async fn seed_source(schema: &str) -> Option<tokio::sync::MutexGuard<'static, ()>> {
    let guard = FIXTURE_LOCK.lock().await;
    crate::pool_manager::close_pool(&pg_params()).await;
    let available = match get_postgres_pool(&pg_params()).await {
        Ok(pool) => pool.get().await.is_ok(),
        Err(_) => false,
    };
    if !available {
        eprintln!("SKIPPING: PostgreSQL not available on port 54320");
        return None;
    }
    pg_exec(&format!(
        "DROP SCHEMA IF EXISTS {schema} CASCADE; CREATE SCHEMA {schema};
         CREATE TABLE {schema}.src (
            id integer PRIMARY KEY, name text, amount numeric(12,2), big numeric(30,10),
            payload bytea, note text, created timestamptz, flag boolean, meta jsonb, uid uuid);
         INSERT INTO {schema}.src
         SELECT g, 'Zoë 日本語 ' || g, g * 1.25, 12345678901234567890.1234567891 + g,
                '\\x00ff00'::bytea || int4send(g), CASE WHEN g % 2 = 0 THEN NULL ELSE 'n' END,
                timestamptz '2024-01-02 03:04:05.123456+00' + g * interval '1 second',
                g % 2 = 0, jsonb_build_object('n', g), gen_random_uuid()
         FROM generate_series(1, {SOURCE_ROWS}) g;"
    ))
    .await;
    Some(guard)
}

fn selection() -> TableSelection {
    TableSelection {
        source_table: "src".into(),
        target_table: "dst".into(),
        columns: vec![],
    }
}

async fn job(
    schema: &str,
    target: Endpoint,
    conflict: ConflictMode,
    cancel: Arc<AtomicBool>,
    cancel_after: Option<u64>,
) -> (TableTransferResult, Arc<Events>, Vec<PlannedTable>) {
    let source = endpoint(pg_params(), schema).await;
    let (tables, issues) = plan_tables(&source, &target, &[selection()]).await.unwrap();
    assert!(issues.is_empty());
    let dir = tempfile::tempdir().unwrap();
    let events = Arc::new(Events {
        cancel_when_written: cancel_after.map(|n| (cancel.clone(), n)),
        progress: StdMutex::default(),
    });
    let runtime = RuntimeContext::new(
        Arc::new(crate::runtime::paths::FixedRuntimePaths::new(
            dir.path().to_path_buf(),
            dir.path().to_path_buf(),
        )),
        events.clone(),
        Arc::new(crate::runtime::secrets::KeyringRuntimeSecrets),
    );
    let job = Job {
        runtime,
        session_id: None,
        transfer_id: "t1".into(),
        cancel,
        source,
        target,
        conflict,
        batch_rows: 500,
        total_tables: 1,
    };
    let result = run_job(job, tables.clone()).await;
    (result, events, tables)
}

fn sqlite_params(path: &std::path::Path) -> ConnectionParams {
    ConnectionParams {
        driver: "sqlite".into(),
        database: DatabaseSelection::Single(path.to_string_lossy().into()),
        ..Default::default()
    }
}

async fn sqlite_target(path: &std::path::Path, ddl: &str) -> Endpoint {
    let params = sqlite_params(path);
    std::fs::File::create(path).unwrap();
    let pool = get_sqlite_pool(&params).await.unwrap();
    sqlx::query(ddl).execute(&pool).await.unwrap();
    endpoint(params, "").await
}

const SQLITE_DDL: &str = "CREATE TABLE dst (id INTEGER PRIMARY KEY, name TEXT, amount NUMERIC, \
    big TEXT, payload BLOB, note TEXT, created TEXT, flag INTEGER, meta TEXT, uid TEXT)";

async fn sqlite_count(path: &std::path::Path) -> i64 {
    let pool = get_sqlite_pool(&sqlite_params(path)).await.unwrap();
    sqlx::query_scalar("SELECT count(*) FROM dst").fetch_one(&pool).await.unwrap()
}

#[tokio::test]
async fn postgres_to_sqlite_copies_every_row_exactly() {
    let schema = "tt_sqlite_ok";
    let Some(_fixture) = seed_source(schema).await else {
        return;
    };
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("target.db");
    let target = sqlite_target(&path, SQLITE_DDL).await;
    let (result, events, _) =
        job(schema, target, ConflictMode::Fail, Arc::new(AtomicBool::new(false)), None).await;

    assert_eq!(result.status, TransferStatus::Completed, "{:?}", result.tables[0].error);
    assert_eq!(result.tables[0].rows_read, SOURCE_ROWS as u64);
    assert_eq!(result.tables[0].rows_written, SOURCE_ROWS as u64);
    assert_eq!(sqlite_count(&path).await, SOURCE_ROWS);
    assert!(events.progress.lock().unwrap().len() >= 4, "per-batch progress");
    let progress = events.progress.lock().unwrap().last().unwrap().to_string();
    assert!(!progress.contains("Zoë"), "progress events carry no row data");

    let pool = get_sqlite_pool(&sqlite_params(&path)).await.unwrap();
    let row = sqlx::query("SELECT name, big, payload, note, flag, meta, amount FROM dst WHERE id = 2")
        .fetch_one(&pool)
        .await
        .unwrap();
    use sqlx::Row;
    assert_eq!(row.get::<String, _>("name"), "Zoë 日本語 2");
    assert_eq!(row.get::<String, _>("big"), "12345678901234567892.1234567891");
    assert_eq!(row.get::<Vec<u8>, _>("payload"), vec![0, 255, 0, 0, 0, 0, 2]);
    assert_eq!(row.get::<Option<String>, _>("note"), None);
    assert_eq!(row.get::<i64, _>("flag"), 1);
    assert_eq!(row.get::<String, _>("meta"), "{\"n\": 2}");
    assert_eq!(row.get::<f64, _>("amount"), 2.5);
    pg_exec(&format!("DROP SCHEMA {schema} CASCADE")).await;
}

#[tokio::test]
async fn postgres_to_postgres_preserves_precision_and_timestamps() {
    let schema = "tt_pg_ok";
    let Some(_fixture) = seed_source(schema).await else {
        return;
    };
    pg_exec(&format!(
        "CREATE TABLE {schema}.dst (LIKE {schema}.src INCLUDING ALL)"
    ))
    .await;
    let target = endpoint(pg_params(), schema).await;
    let (result, _, _) =
        job(schema, target, ConflictMode::Fail, Arc::new(AtomicBool::new(false)), None).await;
    assert_eq!(result.status, TransferStatus::Completed, "{:?}", result.tables[0].error);
    let diff = pg_scalar(&format!(
        "SELECT count(*)::text FROM {schema}.src s FULL JOIN {schema}.dst d USING (id)
         WHERE s.* IS DISTINCT FROM d.*"
    ))
    .await;
    assert_eq!(diff, "0", "source and target rows must be identical");
    pg_exec(&format!("DROP SCHEMA {schema} CASCADE")).await;
}

#[tokio::test]
async fn failing_batch_rolls_back_only_that_batch() {
    let schema = "tt_fail";
    let Some(_fixture) = seed_source(schema).await else {
        return;
    };
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("target.db");
    let target = sqlite_target(&path, SQLITE_DDL).await;
    let pool = get_sqlite_pool(&sqlite_params(&path)).await.unwrap();
    sqlx::query("INSERT INTO dst (id) VALUES (1100)").execute(&pool).await.unwrap();

    let (result, _, _) =
        job(schema, target, ConflictMode::Fail, Arc::new(AtomicBool::new(false)), None).await;
    let table = &result.tables[0];
    assert_eq!(result.status, TransferStatus::Failed);
    assert_eq!(table.rows_written, 1000, "two earlier batches stay committed");
    assert_eq!(table.rows_failed, 250);
    assert_eq!(sqlite_count(&path).await, 1001);
    let error = table.error.clone().unwrap();
    assert!(error.contains("UNIQUE"), "{error}");
    assert!(!error.contains("Zoë"));
    pg_exec(&format!("DROP SCHEMA {schema} CASCADE")).await;
}

#[tokio::test]
async fn skip_mode_ignores_only_duplicates() {
    let schema = "tt_skip";
    let Some(_fixture) = seed_source(schema).await else {
        return;
    };
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("target.db");
    let target = sqlite_target(&path, SQLITE_DDL).await;
    let pool = get_sqlite_pool(&sqlite_params(&path)).await.unwrap();
    sqlx::query("INSERT INTO dst (id) VALUES (7), (1100)").execute(&pool).await.unwrap();

    let (result, _, _) =
        job(schema, target, ConflictMode::Skip, Arc::new(AtomicBool::new(false)), None).await;
    assert_eq!(result.status, TransferStatus::Completed);
    assert_eq!(result.tables[0].rows_skipped, 2);
    assert_eq!(result.tables[0].rows_written, SOURCE_ROWS as u64 - 2);
    assert_eq!(sqlite_count(&path).await, SOURCE_ROWS);
    pg_exec(&format!("DROP SCHEMA {schema} CASCADE")).await;
}

#[tokio::test]
async fn lossy_values_are_rejected_instead_of_coerced() {
    let schema = "tt_lossy";
    let Some(_fixture) = seed_source(schema).await else {
        return;
    };
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("target.db");
    let ddl = SQLITE_DDL.replace("amount NUMERIC", "amount INTEGER");
    let target = sqlite_target(&path, &ddl).await;
    let (result, _, _) =
        job(schema, target, ConflictMode::Fail, Arc::new(AtomicBool::new(false)), None).await;
    let table = &result.tables[0];
    assert_eq!(result.status, TransferStatus::Failed);
    assert_eq!(table.rows_written, 0);
    assert_eq!(sqlite_count(&path).await, 0);
    let error = table.error.clone().unwrap();
    assert!(error.contains("column \"amount\"") && error.contains("lossy"), "{error}");
    pg_exec(&format!("DROP SCHEMA {schema} CASCADE")).await;
}

#[tokio::test]
async fn cancellation_keeps_committed_batches_and_reports_them() {
    let schema = "tt_cancel";
    let Some(_fixture) = seed_source(schema).await else {
        return;
    };
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("target.db");
    let target = sqlite_target(&path, SQLITE_DDL).await;
    let cancel = Arc::new(AtomicBool::new(false));
    let (result, _, _) = job(schema, target, ConflictMode::Fail, cancel, Some(500)).await;
    let table = &result.tables[0];
    assert_eq!(result.status, TransferStatus::Cancelled);
    assert_eq!(table.rows_written, 500);
    assert_eq!(sqlite_count(&path).await, 500, "committed work remains in the target");
    pg_exec(&format!("DROP SCHEMA {schema} CASCADE")).await;
}

#[tokio::test]
async fn plan_blocks_a_missing_target_table_and_never_creates_it() {
    let schema = "tt_plan";
    let Some(_fixture) = seed_source(schema).await else {
        return;
    };
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("target.db");
    let params = sqlite_params(&path);
    std::fs::File::create(&path).unwrap();
    get_sqlite_pool(&params).await.unwrap();
    let target = endpoint(params, "").await;
    let source = endpoint(pg_params(), schema).await;
    let (tables, _) = plan_tables(&source, &target, &[selection()]).await.unwrap();
    assert!(tables[0].plan.blocking);
    assert_eq!(tables[0].plan.issues[0].code, "targetTableNotFound");
    assert!(target.drv.get_columns(&target.params, "dst", None).await.unwrap().is_empty());
    pg_exec(&format!("DROP SCHEMA {schema} CASCADE")).await;
}

#[tokio::test]
async fn a_transfer_cancelled_before_it_starts_copies_nothing() {
    let schema = "tt_precancel";
    let Some(_fixture) = seed_source(schema).await else {
        return;
    };
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("target.db");
    let target = sqlite_target(&path, SQLITE_DDL).await;
    let (result, _, _) =
        job(schema, target, ConflictMode::Fail, Arc::new(AtomicBool::new(true)), None).await;
    assert_eq!(result.status, TransferStatus::Cancelled);
    assert_eq!(result.tables[0].status, TransferStatus::NotStarted);
    assert_eq!(sqlite_count(&path).await, 0);
    pg_exec(&format!("DROP SCHEMA {schema} CASCADE")).await;
}

#[tokio::test]
async fn detects_strict_sqlite_tables() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("strict.db");
    std::fs::File::create(&path).unwrap();
    let pool = get_sqlite_pool(&sqlite_params(&path)).await.unwrap();
    sqlx::query("CREATE TABLE plain_any (v ANY)").execute(&pool).await.unwrap();
    sqlx::query("CREATE TABLE strict_any (v ANY) STRICT").execute(&pool).await.unwrap();

    assert!(sqlite::is_strict_table(&pool, "strict_any").await);
    assert!(sqlite::is_strict_table(&pool, "STRICT_ANY").await);
    assert!(!sqlite::is_strict_table(&pool, "plain_any").await);
    assert!(!sqlite::is_strict_table(&pool, "missing").await);
}

fn saved_pg(host: &str, port: Option<u16>, database: &str) -> ConnectionParams {
    ConnectionParams {
        driver: "postgres".into(),
        host: Some(host.into()),
        port,
        database: DatabaseSelection::Single(database.into()),
        ..Default::default()
    }
}

#[test]
fn string_identity_matches_aliases_that_are_provably_one_server() {
    let a = saved_pg("db.example.com", Some(5432), "app");
    let mut b = saved_pg("DB.example.com", None, "app");
    b.username = Some("someone_else".into());
    assert!(reaches_same_database(&a, &b));
    assert!(reaches_same_database(
        &saved_pg("localhost", Some(5432), "app"),
        &saved_pg("127.0.0.1", Some(5432), "app"),
    ));
    assert!(!reaches_same_database(&a, &saved_pg("db.example.com", Some(5432), "other")));
    assert!(!reaches_same_database(&a, &saved_pg("db2", Some(5432), "app")));
    assert!(!reaches_same_database(&a, &saved_pg("db.example.com", Some(6543), "app")));
}

#[test]
fn tunnels_only_match_when_provably_the_same_route() {
    let mut a = saved_pg("db", Some(5432), "app");
    let mut b = a.clone();
    a.ssh_enabled = Some(true);
    a.ssh_connection_id = Some("bastion-1".into());
    assert!(!reaches_same_database(&a, &b), "tunnel vs direct");
    b.ssh_enabled = Some(true);
    b.ssh_connection_id = Some("bastion-2".into());
    assert!(!reaches_same_database(&a, &b), "different bastions");
    b.ssh_connection_id = Some("bastion-1".into());
    assert!(reaches_same_database(&a, &b));
}

#[test]
fn sqlite_aliases_of_one_file_are_one_database() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("a.db");
    std::fs::File::create(&path).unwrap();
    let a = sqlite_params(&path);
    assert!(reaches_same_database(&a, &sqlite_params(&dir.path().join(".").join("a.db"))));
    let other = dir.path().join("b.db");
    std::fs::File::create(&other).unwrap();
    assert!(!reaches_same_database(&a, &sqlite_params(&other)));
}

fn identity(system_id: Option<&str>, address: Option<(&str, i32)>, database: &str) -> ServerIdentity {
    ServerIdentity {
        system_id: system_id.map(str::to_string),
        address: address.map(|(host, port)| (host.to_string(), port)),
        database: database.to_string(),
    }
}

#[test]
fn server_identity_ignores_the_name_used_to_reach_it() {
    // `localhost.` reaches the server over ::1, `127.0.0.1` over IPv4.
    let v6 = identity(Some("77"), Some(("::1", 54320)), "testdb");
    let v4 = identity(Some("77"), Some(("127.0.0.1", 54320)), "testdb");
    assert_eq!(compare_identities(&v6, &v4), Some(true));
    // Another cluster is a different database even with the same name and address.
    let other = identity(Some("88"), Some(("127.0.0.1", 54320)), "testdb");
    assert_eq!(compare_identities(&v4, &other), Some(false));
    assert_eq!(compare_identities(&v4, &identity(Some("77"), None, "other")), Some(false));
}

#[test]
fn without_a_cluster_id_only_the_same_address_proves_identity() {
    let a = identity(None, Some(("10.0.0.5", 5432)), "app");
    assert_eq!(compare_identities(&a, &identity(None, Some(("10.0.0.5", 5432)), "app")), Some(true));
    let v6 = identity(None, Some(("::1", 5432)), "app");
    let v4 = identity(None, Some(("127.0.0.1", 5432)), "app");
    assert_eq!(compare_identities(&v6, &v4), Some(true));
    // Different addresses might still be one server, so nothing is proven.
    assert_eq!(compare_identities(&a, &identity(None, Some(("10.0.0.6", 5432)), "app")), None);
    assert_eq!(compare_identities(&a, &identity(None, None, "app")), None);
    // One unreadable cluster id cannot be settled by the other side.
    assert_eq!(compare_identities(&a, &identity(Some("1"), Some(("10.0.0.5", 5432)), "app")), None);
}

// --- Plan / run through two saved connections -------------------------------

struct SavedPair {
    _dir: tempfile::TempDir,
    runtime: RuntimeContext,
}

/// A runtime whose connections file holds saved connections `a` and `b`.
fn runtime_with(a: ConnectionParams, b: ConnectionParams) -> SavedPair {
    let dir = tempfile::tempdir().unwrap();
    let runtime = RuntimeContext::new(
        Arc::new(crate::runtime::paths::FixedRuntimePaths::new(
            dir.path().to_path_buf(),
            dir.path().to_path_buf(),
        )),
        Arc::new(Events { cancel_when_written: None, progress: StdMutex::default() }),
        Arc::new(crate::runtime::secrets::KeyringRuntimeSecrets),
    );
    let saved = |id: &str, params: ConnectionParams| crate::models::SavedConnection {
        id: id.into(),
        name: id.into(),
        params,
        plugin_secret_keys: vec![],
        group_id: None,
        sort_order: None,
        detect_json_in_text_columns: None,
        appearance: None,
        tag_ids: None,
        environment: None,
        managed: false,
    };
    let file = crate::models::ConnectionsFile {
        connections: vec![saved("conn-a", a), saved("conn-b", b)],
        ..Default::default()
    };
    crate::persistence::save_connections_file(&runtime.paths.connections_file(), &file).unwrap();
    SavedPair { _dir: dir, runtime }
}

fn self_copy_request(schema: &str, table: &str) -> TableTransferRequest {
    TableTransferRequest {
        source_connection_id: "conn-a".into(),
        target_connection_id: "conn-b".into(),
        source_schema: Some(schema.into()),
        target_schema: Some(schema.into()),
        tables: vec![TableSelection {
            source_table: table.into(),
            target_table: table.into(),
            columns: vec![],
        }],
        source_database: None,
        target_database: None,
        conflict: ConflictMode::Fail,
        batch_rows: None,
        transfer_id: Some("self-copy".into()),
    }
}

async fn alias_copy_fixture(schema: &str) -> Option<tokio::sync::MutexGuard<'static, ()>> {
    let guard = FIXTURE_LOCK.lock().await;
    crate::pool_manager::close_pool(&pg_params()).await;
    if get_postgres_pool(&pg_params()).await.ok()?.get().await.is_err() {
        eprintln!("SKIPPING: PostgreSQL not available on port 54320");
        return None;
    }
    pg_exec(&format!(
        "DROP SCHEMA IF EXISTS {schema} CASCADE; CREATE SCHEMA {schema};
         CREATE TABLE {schema}.alias_copy_test(id integer, note text);
         INSERT INTO {schema}.alias_copy_test VALUES (1, 'first'), (2, 'second');"
    ))
    .await;
    Some(guard)
}

/// Two saved connections to the same server, one spelled `localhost.` (which
/// resolves over ::1 here) and one `127.0.0.1`, must not copy a table into itself.
async fn assert_self_copy_is_rejected(host_a: &str, host_b: &str, schema: &str) {
    let Some(_fixture) = alias_copy_fixture(schema).await else {
        return;
    };
    let mut a = pg_params();
    a.host = Some(host_a.into());
    let mut b = pg_params();
    b.host = Some(host_b.into());
    crate::drivers::registry::register_driver(crate::drivers::postgres::PostgresDriver::new()).await;
    let reachable = match get_postgres_pool(&a).await {
        Ok(pool) => pool.get().await.is_ok(),
        Err(_) => false,
    };
    if !reachable {
        eprintln!("SKIPPING: {host_a} is not reachable");
        pg_exec(&format!("DROP SCHEMA {schema} CASCADE")).await;
        return;
    }
    let pair = runtime_with(a, b);
    let request = self_copy_request(schema, "alias_copy_test");

    let plan = plan(&pair.runtime, None, request.clone()).await.unwrap();
    assert!(plan.blocking);
    assert_eq!(plan.tables[0].issues[0].code, "sourceEqualsTarget");

    let state = state();
    let error = run(&pair.runtime, &state, None, request).await.unwrap_err();
    assert!(error.contains("blocking issues"), "{error}");
    assert_eq!(
        pg_scalar(&format!("SELECT count(*)::text FROM {schema}.alias_copy_test")).await,
        "2",
        "nothing is written back into the source"
    );
    pg_exec(&format!("DROP SCHEMA {schema} CASCADE")).await;
}

#[tokio::test]
async fn two_saved_connections_through_dns_dot_and_ip_cannot_copy_a_table_into_itself() {
    assert_self_copy_is_rejected("localhost.", "127.0.0.1", "tt_alias_dot").await;
}

#[tokio::test]
async fn two_saved_connections_with_loopback_spellings_cannot_copy_a_table_into_itself() {
    assert_self_copy_is_rejected("localhost", "127.0.0.1", "tt_alias_loop").await;
}

#[test]
fn a_table_with_the_same_name_on_another_server_is_still_allowed() {
    // Same database, schema and table names, but a different cluster: a legitimate copy.
    let a = identity(Some("1"), Some(("10.0.0.5", 5432)), "app");
    let b = identity(Some("2"), Some(("10.0.0.6", 5432)), "app");
    assert_eq!(compare_identities(&a, &b), Some(false));
}

fn read_only(mut params: ConnectionParams) -> ConnectionParams {
    params.read_only = true;
    params
}

fn copy_request(schema: &str, target_schema: Option<&str>) -> TableTransferRequest {
    TableTransferRequest {
        source_schema: Some(schema.into()),
        target_schema: target_schema.map(Into::into),
        tables: vec![selection()],
        transfer_id: Some("read-only-target".into()),
        ..self_copy_request(schema, "src")
    }
}

async fn assert_read_only_target_is_rejected(pair: &SavedPair, request: TableTransferRequest) {
    let plan = plan(&pair.runtime, None, request.clone()).await.unwrap();
    assert!(plan.blocking);
    assert!(plan.issues.iter().any(|i| i.code == "targetReadOnly"), "{:?}", plan.issues);

    let error = run(&pair.runtime, &state(), None, request).await.unwrap_err();
    assert!(error.contains("blocking issues"), "{error}");
}

#[tokio::test]
async fn a_saved_read_only_postgres_target_is_rejected_by_plan_and_run() {
    let schema = "tt_ro_pg";
    let Some(_fixture) = seed_source(schema).await else {
        return;
    };
    pg_exec(&format!(
        "CREATE TABLE {schema}.dst (id integer PRIMARY KEY, name text, amount numeric(12,2), big numeric(30,10),
            payload bytea, note text, created timestamptz, flag boolean, meta jsonb, uid uuid);"
    ))
    .await;
    crate::drivers::registry::register_driver(crate::drivers::postgres::PostgresDriver::new()).await;
    let pair = runtime_with(pg_params(), read_only(pg_params()));
    assert_read_only_target_is_rejected(&pair, copy_request(schema, Some(schema))).await;
    assert_eq!(pg_scalar(&format!("SELECT count(*)::text FROM {schema}.dst")).await, "0");
    pg_exec(&format!("DROP SCHEMA {schema} CASCADE")).await;
}

#[tokio::test]
async fn a_saved_read_only_sqlite_target_is_rejected_by_plan_and_run() {
    let schema = "tt_ro_sqlite";
    let Some(_fixture) = seed_source(schema).await else {
        return;
    };
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("target.db");
    sqlite_target(&path, SQLITE_DDL).await;
    let pair = runtime_with(pg_params(), read_only(sqlite_params(&path)));
    let mut request = copy_request(schema, None);
    request.target_connection_id = "conn-b".into();
    assert_read_only_target_is_rejected(&pair, request).await;
    assert_eq!(sqlite_count(&path).await, 0);
    pg_exec(&format!("DROP SCHEMA {schema} CASCADE")).await;
}

#[tokio::test]
async fn a_saved_read_only_source_stays_usable() {
    let schema = "tt_ro_source";
    let Some(_fixture) = seed_source(schema).await else {
        return;
    };
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("target.db");
    sqlite_target(&path, SQLITE_DDL).await;
    let pair = runtime_with(read_only(pg_params()), sqlite_params(&path));
    let plan = plan(&pair.runtime, None, copy_request(schema, None)).await.unwrap();
    assert!(!plan.blocking, "{:?}", plan.issues);
    pg_exec(&format!("DROP SCHEMA {schema} CASCADE")).await;
}
