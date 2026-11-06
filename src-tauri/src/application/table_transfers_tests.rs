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
    let (tables, issues) = plan_tables(&source, &target, false, &[selection()]).await.unwrap();
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
    let (tables, _) = plan_tables(&source, &target, false, &[selection()]).await.unwrap();
    assert!(tables[0].plan.blocking);
    assert_eq!(tables[0].plan.issues[0].code, "targetTableNotFound");
    assert!(target.drv.get_columns(&target.params, "dst", None).await.unwrap().is_empty());
    pg_exec(&format!("DROP SCHEMA {schema} CASCADE")).await;
}
