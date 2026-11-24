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
