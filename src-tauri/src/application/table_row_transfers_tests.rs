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
    state
        .table_transfers
        .lock()
        .unwrap()
        .insert(key.clone(), flag.clone());
    drop(Registration {
        state: state.table_transfers.clone(),
        key,
        flag: flag.clone(),
    });
    assert!(flag.load(Ordering::SeqCst));
    assert!(state.table_transfers.lock().unwrap().is_empty());
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

fn selection() -> TableSelection {
    TableSelection {
        source_table: "src".into(),
        target_table: "dst".into(),
        columns: vec![],
    }
}

fn sqlite_params(path: &std::path::Path) -> ConnectionParams {
    ConnectionParams {
        driver: "sqlite".into(),
        database: DatabaseSelection::Single(path.to_string_lossy().into()),
        ..Default::default()
    }
}

async fn sqlite_endpoint(path: &std::path::Path) -> Endpoint {
    std::fs::File::create(path).unwrap();
    let pool = get_sqlite_pool(&sqlite_params(path)).await.unwrap();
    for table in ["a", "b", "dst"] {
        sqlx::query(&format!("CREATE TABLE IF NOT EXISTS {table} (id INTEGER)"))
            .execute(&pool)
            .await
            .unwrap();
    }
    Endpoint {
        driver: "sqlite".into(),
        dialect: TransferDialect::Sqlite,
        params: sqlite_params(path),
        schema: String::new(),
        drv: Arc::new(crate::drivers::sqlite::SqliteDriver::new()),
    }
}

fn pick(source: &str, target: &str) -> TableSelection {
    TableSelection {
        source_table: source.into(),
        target_table: target.into(),
        columns: vec![],
    }
}

#[tokio::test]
async fn targets_differing_only_by_ascii_case_are_duplicates() {
    let dir = tempfile::tempdir().unwrap();
    let source = sqlite_endpoint(&dir.path().join("src.db")).await;
    let target = sqlite_endpoint(&dir.path().join("dst.db")).await;

    let (_, issues) = plan_tables(&source, &target, &[pick("a", "dst"), pick("b", "DST")])
        .await
        .unwrap();

    assert!(issues.iter().any(|i| i.code == "duplicateTargetTable"));
}

#[tokio::test]
async fn distinct_targets_are_not_flagged_as_duplicates() {
    let dir = tempfile::tempdir().unwrap();
    let source = sqlite_endpoint(&dir.path().join("src.db")).await;
    let target = sqlite_endpoint(&dir.path().join("dst.db")).await;

    let (_, issues) = plan_tables(&source, &target, &[pick("a", "dst"), pick("b", "a")])
        .await
        .unwrap();

    assert!(issues.iter().all(|i| i.code != "duplicateTargetTable"));
}

#[tokio::test]
async fn copying_a_table_onto_its_own_case_variant_is_a_self_copy() {
    let dir = tempfile::tempdir().unwrap();
    let endpoint = sqlite_endpoint(&dir.path().join("one.db")).await;

    assert_eq!(
        same_table(&endpoint, &endpoint, &pick("a", "A")).await,
        SameTable::Yes
    );
    assert_eq!(
        same_table(&endpoint, &endpoint, &pick("a", "b")).await,
        SameTable::No
    );
}

struct NoSecrets;

impl crate::runtime::secrets::RuntimeSecrets for NoSecrets {
    fn get(&self, _account: &str) -> Result<Option<String>, String> {
        Ok(None)
    }

    fn set(&self, _account: &str, _secret: &str) -> Result<(), String> {
        Ok(())
    }

    fn delete(&self, _account: &str) -> Result<(), String> {
        Ok(())
    }
}

fn runtime(dir: &std::path::Path) -> RuntimeContext {
    RuntimeContext::new(
        Arc::new(crate::runtime::paths::FixedRuntimePaths::new(
            dir.to_path_buf(),
            dir.to_path_buf(),
        )),
        Arc::new(crate::runtime::events::NoopRuntimeEvents),
        Arc::new(NoSecrets),
    )
}

/// Source and target SQLite files, each with an empty `big(id, name)` table;
/// the source gets `rows` rows (`name` is NULL on every 7th).
async fn copy_fixture(dir: &std::path::Path, rows: i64) -> (Endpoint, Endpoint) {
    let source = sqlite_endpoint(&dir.join("src.db")).await;
    let target = sqlite_endpoint(&dir.join("dst.db")).await;
    for endpoint in [&source, &target] {
        let pool = get_sqlite_pool(&endpoint.params).await.unwrap();
        sqlx::query("CREATE TABLE big (id INTEGER PRIMARY KEY, name TEXT)")
            .execute(&pool)
            .await
            .unwrap();
    }
    let pool = get_sqlite_pool(&source.params).await.unwrap();
    sqlx::query(
        "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?) \
         INSERT INTO big SELECT i, CASE WHEN i % 7 = 0 THEN NULL ELSE 'row-' || i END \
         FROM n WHERE i <= ?",
    )
    .bind(rows)
    .bind(rows)
    .execute(&pool)
    .await
    .unwrap();
    (source, target)
}

async fn big_job(
    dir: &std::path::Path,
    source: Endpoint,
    target: Endpoint,
    batch_rows: usize,
    cancel: bool,
) -> (Job, Vec<PlannedTable>) {
    let (tables, issues) = plan_tables(&source, &target, &[pick("big", "big")])
        .await
        .unwrap();
    assert!(issues.is_empty());
    assert!(!tables[0].plan.blocking);
    let job = Job {
        runtime: runtime(dir),
        session_id: None,
        transfer_id: "copy-test".into(),
        cancel: Arc::new(AtomicBool::new(cancel)),
        source,
        target,
        conflict: ConflictMode::default(),
        batch_rows,
        total_tables: 1,
    };
    (job, tables)
}

async fn copy_big(
    dir: &std::path::Path,
    source: Endpoint,
    target: Endpoint,
    batch_rows: usize,
) -> TableTransferTableResult {
    let (job, tables) = big_job(dir, source, target, batch_rows, false).await;
    run_job(job, tables).await.tables.remove(0)
}

async fn assert_copied_exactly(source: &Endpoint, target: &Endpoint, rows: i64) {
    let source_pool = get_sqlite_pool(&source.params).await.unwrap();
    let target_pool = get_sqlite_pool(&target.params).await.unwrap();
    let read = |pool: sqlx::Pool<sqlx::Sqlite>| async move {
        sqlx::query_as::<_, (i64, Option<String>)>("SELECT id, name FROM big ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap()
    };
    let copied = read(target_pool).await;
    assert_eq!(copied.len() as i64, rows);
    assert_eq!(copied, read(source_pool).await);
}

#[tokio::test]
async fn a_multi_batch_copy_moves_every_row_once_in_order() {
    let dir = tempfile::tempdir().unwrap();
    // 2,300 rows at 500 per batch: four full batches and a partial one.
    let (source, target) = copy_fixture(dir.path(), 2_300).await;

    let result = copy_big(dir.path(), source.clone(), target.clone(), 500).await;

    assert_eq!(result.status, TransferStatus::Completed);
    assert_eq!(result.rows_read, 2_300);
    assert_eq!(result.rows_written, 2_300);
    assert_copied_exactly(&source, &target, 2_300).await;
}

#[tokio::test]
async fn a_row_count_that_is_an_exact_multiple_of_the_batch_copies_cleanly() {
    let dir = tempfile::tempdir().unwrap();
    let (source, target) = copy_fixture(dir.path(), 1_000).await;

    let result = copy_big(dir.path(), source.clone(), target.clone(), 500).await;

    assert_eq!(result.status, TransferStatus::Completed);
    assert_eq!(result.rows_written, 1_000);
    assert_copied_exactly(&source, &target, 1_000).await;
}

#[tokio::test]
async fn an_empty_source_table_completes_with_nothing_written() {
    let dir = tempfile::tempdir().unwrap();
    let (source, target) = copy_fixture(dir.path(), 0).await;

    let result = copy_big(dir.path(), source.clone(), target.clone(), 500).await;

    assert_eq!(result.status, TransferStatus::Completed);
    assert_eq!((result.rows_read, result.rows_written), (0, 0));
}

#[tokio::test]
async fn a_batch_of_one_row_still_streams_every_row() {
    let dir = tempfile::tempdir().unwrap();
    let (source, target) = copy_fixture(dir.path(), 25).await;

    let result = copy_big(dir.path(), source.clone(), target.clone(), 1).await;

    assert_eq!(result.status, TransferStatus::Completed);
    assert_copied_exactly(&source, &target, 25).await;
}

#[tokio::test]
async fn a_cancel_raised_before_the_first_batch_stops_the_stream_without_writing() {
    let dir = tempfile::tempdir().unwrap();
    let (source, target) = copy_fixture(dir.path(), 2_300).await;
    let (job, tables) = big_job(dir.path(), source, target.clone(), 500, true).await;
    let mut result = TableTransferTableResult {
        source_table: "big".into(),
        target_table: "big".into(),
        status: TransferStatus::Running,
        rows_read: 0,
        rows_written: 0,
        rows_skipped: 0,
        rows_failed: 0,
        error: None,
    };

    let status = copy_table(&job, 0, &tables[0], &mut result).await.unwrap();

    assert_eq!(status, TransferStatus::Cancelled);
    assert_eq!((result.rows_read, result.rows_written), (0, 0));
    let pool = get_sqlite_pool(&target.params).await.unwrap();
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM big")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
}

/// Copies `big(id, v <declared>)` between two SQLite files, seeding the source
/// with `values` (SQL literals, so each keeps its own storage class), and
/// returns `(id, typeof(v), hex(v))` for source and target.
async fn copy_typed_column(
    dir: &std::path::Path,
    declared: &str,
    values: &[&str],
) -> (
    TableTransferTableResult,
    Vec<(i64, String, String)>,
    Vec<(i64, String, String)>,
) {
    let source = sqlite_endpoint(&dir.join("typed-src.db")).await;
    let target = sqlite_endpoint(&dir.join("typed-dst.db")).await;
    for endpoint in [&source, &target] {
        let pool = get_sqlite_pool(&endpoint.params).await.unwrap();
        sqlx::query(&format!(
            "CREATE TABLE big (id INTEGER PRIMARY KEY, v {declared})"
        ))
        .execute(&pool)
        .await
        .unwrap();
    }
    let pool = get_sqlite_pool(&source.params).await.unwrap();
    for (id, value) in values.iter().enumerate() {
        sqlx::query(&format!("INSERT INTO big VALUES ({}, {value})", id + 1))
            .execute(&pool)
            .await
            .unwrap();
    }
    let result = copy_big(dir, source.clone(), target.clone(), 2).await;
    let read = |endpoint: Endpoint| async move {
        let pool = get_sqlite_pool(&endpoint.params).await.unwrap();
        sqlx::query_as::<_, (i64, String, String)>(
            "SELECT id, typeof(v), hex(v) FROM big ORDER BY id",
        )
        .fetch_all(&pool)
        .await
        .unwrap()
    };
    (result, read(source).await, read(target).await)
}

#[tokio::test]
async fn a_blob_column_keeps_the_storage_class_of_every_value() {
    let dir = tempfile::tempdir().unwrap();

    // A BLOB column has no affinity, so it can hold a blob, text, an integer
    // or a real. `typeof` and the bytes must survive the copy.
    let (result, source, target) = copy_typed_column(
        dir.path(),
        "BLOB",
        &["x'00ff10'", "'abc'", "NULL", "7", "2.5", "x''"],
    )
    .await;

    assert_eq!(result.error, None);
    assert_eq!(result.status, TransferStatus::Completed);
    assert_eq!(target, source);
    assert_eq!(
        target.iter().map(|r| r.1.as_str()).collect::<Vec<_>>(),
        ["blob", "text", "null", "integer", "real", "blob"]
    );
}

#[tokio::test]
async fn text_stored_in_a_blob_column_stays_text() {
    let dir = tempfile::tempdir().unwrap();

    let (result, source, target) =
        copy_typed_column(dir.path(), "BLOB", &["'abc'", "x'616263'"]).await;

    assert_eq!(result.error, None);
    assert_eq!(source[0].1, "text");
    assert_eq!(target, source);
}
#[tokio::test]
async fn a_numeric_column_copies_integer_and_real_values_unchanged() {
    let dir = tempfile::tempdir().unwrap();

    let (result, source, target) =
        copy_typed_column(dir.path(), "NUMERIC", &["42", "1.5", "NULL", "-7", "2.25"]).await;

    assert_eq!(result.error, None);
    assert_eq!(result.status, TransferStatus::Completed);
    assert_eq!(target, source);
}

#[tokio::test]
async fn numeric_values_copy_into_other_column_types_or_fail_loudly() {
    // A NUMERIC source column holds integers, reals and text natively. Each
    // target type either stores the value exactly or the copy reports an error;
    // nothing is rounded or reclassified silently.
    for (target_type, values, expect_ok) in [
        ("TEXT", &["42", "1.5"][..], true),
        ("INTEGER", &["42", "-7"][..], true),
        ("INTEGER", &["1.5"][..], false),
        ("REAL", &["42", "1.5", "0.1"][..], true),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let source = sqlite_endpoint(&dir.path().join("s.db")).await;
        let target = sqlite_endpoint(&dir.path().join("t.db")).await;
        for (endpoint, declared) in [(&source, "NUMERIC"), (&target, target_type)] {
            let pool = get_sqlite_pool(&endpoint.params).await.unwrap();
            sqlx::query(&format!(
                "CREATE TABLE big (id INTEGER PRIMARY KEY, v {declared})"
            ))
            .execute(&pool)
            .await
            .unwrap();
        }
        let pool = get_sqlite_pool(&source.params).await.unwrap();
        for (id, value) in values.iter().enumerate() {
            sqlx::query(&format!("INSERT INTO big VALUES ({}, {value})", id + 1))
                .execute(&pool)
                .await
                .unwrap();
        }

        let result = copy_big(dir.path(), source, target.clone(), 500).await;

        if expect_ok {
            assert_eq!(result.error, None, "NUMERIC -> {target_type}");
            assert_eq!(result.rows_written, values.len() as u64);
        } else {
            assert_eq!(
                result.status,
                TransferStatus::Failed,
                "NUMERIC -> {target_type}"
            );
            let pool = get_sqlite_pool(&target.params).await.unwrap();
            let count: i64 = sqlx::query_scalar("SELECT count(*) FROM big")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(count, 0, "a rejected batch must write nothing");
        }
    }
}

#[tokio::test]
async fn a_real_in_a_numeric_column_round_trips_exactly_into_a_text_column() {
    let dir = tempfile::tempdir().unwrap();
    let source = sqlite_endpoint(&dir.path().join("s.db")).await;
    let target = sqlite_endpoint(&dir.path().join("t.db")).await;
    for (endpoint, declared) in [(&source, "NUMERIC"), (&target, "TEXT")] {
        let pool = get_sqlite_pool(&endpoint.params).await.unwrap();
        sqlx::query(&format!(
            "CREATE TABLE big (id INTEGER PRIMARY KEY, v {declared})"
        ))
        .execute(&pool)
        .await
        .unwrap();
    }
    let pool = get_sqlite_pool(&source.params).await.unwrap();
    // Values whose shortest text needs 16-17 significant digits: a copy that
    // rendered a real with 15 would store a different number.
    sqlx::query(
        "INSERT INTO big VALUES (1, 1.2345678901234567), (2, 42), (3, 0.1), \
         (4, 0.30000000000000004), (5, 3.141592653589793), (6, NULL)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let result = copy_big(dir.path(), source.clone(), target.clone(), 500).await;

    assert_eq!(result.error, None);
    let read = |endpoint: Endpoint| async move {
        let pool = get_sqlite_pool(&endpoint.params).await.unwrap();
        sqlx::query_as::<_, (i64, Option<f64>)>("SELECT id, CAST(v AS REAL) FROM big ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap()
    };
    let target_pool = get_sqlite_pool(&target.params).await.unwrap();
    let texts: Vec<(i64, Option<String>, String)> =
        sqlx::query_as("SELECT id, v, typeof(v) FROM big ORDER BY id")
            .fetch_all(&target_pool)
            .await
            .unwrap();
    assert!(texts
        .iter()
        .all(|(_, v, kind)| v.is_none() == (kind == "null")));
    assert!(texts
        .iter()
        .filter(|(_, v, _)| v.is_some())
        .all(|(_, _, kind)| kind == "text"));
    // The stored text must parse back to the exact source number.
    let source_values = read(source).await;
    for ((id, original), (_, stored, _)) in source_values.iter().zip(&texts) {
        let parsed = stored.as_deref().map(|text| text.parse::<f64>().unwrap());
        assert_eq!(parsed, *original, "row {id}: stored {stored:?}");
    }
}

#[tokio::test]
async fn a_numeric_column_copied_into_an_untyped_column_keeps_its_storage_class() {
    let dir = tempfile::tempdir().unwrap();
    let source = sqlite_endpoint(&dir.path().join("s.db")).await;
    let target = sqlite_endpoint(&dir.path().join("t.db")).await;
    for (endpoint, declared) in [(&source, "NUMERIC"), (&target, "")] {
        let pool = get_sqlite_pool(&endpoint.params).await.unwrap();
        sqlx::query(&format!(
            "CREATE TABLE big (id INTEGER PRIMARY KEY, v {declared})"
        ))
        .execute(&pool)
        .await
        .unwrap();
    }
    let pool = get_sqlite_pool(&source.params).await.unwrap();
    sqlx::query("INSERT INTO big VALUES (1, 1.2345678901234567), (2, 42)")
        .execute(&pool)
        .await
        .unwrap();

    let result = copy_big(dir.path(), source, target.clone(), 500).await;

    assert_eq!(result.error, None);
    let pool = get_sqlite_pool(&target.params).await.unwrap();
    let stored: Vec<(String, f64)> =
        sqlx::query_as("SELECT typeof(v), CAST(v AS REAL) FROM big ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(stored[0], ("real".into(), 1.2345678901234567));
    assert_eq!(stored[1].0, "integer");
}
