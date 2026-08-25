use super::*;
use crate::logger::{create_log_buffer, LogEntry};
use crate::runtime::events::NoopRuntimeEvents;
use crate::runtime::paths::FixedRuntimePaths;
use crate::runtime::secrets::RuntimeSecrets;
use crate::runtime::RuntimeContext;
use std::sync::Arc;
use tokio::io::AsyncReadExt;

struct NoopSecrets;

impl RuntimeSecrets for NoopSecrets {
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

fn fixture() -> (tempfile::TempDir, RuntimeContext) {
    let temp = tempfile::tempdir().unwrap();
    let runtime = RuntimeContext::new(
        Arc::new(FixedRuntimePaths::new(
            temp.path().to_path_buf(),
            temp.path().to_path_buf(),
        )),
        Arc::new(NoopRuntimeEvents),
        Arc::new(NoopSecrets),
    );
    (temp, runtime)
}

#[test]
fn browser_export_writer_enforces_the_transfer_limit_while_streaming() {
    let mut writer = LimitedWriter::new(Vec::new(), 8);
    writer.write_all(b"1234").unwrap();
    writer.write_all(b"5678").unwrap();
    let error = writer.write_all(b"9").unwrap_err();
    assert!(error.to_string().contains("8 byte browser download limit"));
    assert_eq!(writer.inner, b"12345678");
}

#[tokio::test]
async fn large_query_exports_stream_through_disk_backed_single_use_downloads() {
    crate::drivers::registry::register_driver(crate::drivers::sqlite::SqliteDriver::new()).await;
    let (_temp, runtime) = fixture();
    let database_path = runtime.paths.data_dir().join("large-export.sqlite");
    File::create(&database_path).unwrap();
    let params = crate::models::ConnectionParams {
        driver: "sqlite".to_string(),
        database: DatabaseSelection::Single(database_path.to_string_lossy().into_owned()),
        ..Default::default()
    };
    crate::drivers::sqlite::execute_query(
        &params,
        "CREATE TABLE numbers (value INTEGER PRIMARY KEY, label TEXT NOT NULL)",
        None,
        1,
    )
    .await
    .unwrap();
    crate::drivers::sqlite::execute_query(
        &params,
        "WITH RECURSIVE seq(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM seq WHERE value < 50000) INSERT INTO numbers SELECT value, printf('row-%08d', value) FROM seq",
        None,
        1,
    )
    .await
    .unwrap();
    crate::persistence::save_connections_file(
        &runtime.paths.connections_file(),
        &crate::models::ConnectionsFile {
            connections: vec![crate::models::SavedConnection {
                id: "large-export".to_string(),
                name: "Large export".to_string(),
                params,
                group_id: None,
                sort_order: None,
                detect_json_in_text_columns: None,
                appearance: None,
                tag_ids: None,
                environment: None,
            }],
            ..Default::default()
        },
    )
    .unwrap();

    let owner = Uuid::new_v4();
    let result = export_query(
        &runtime,
        &ExportCancellationState::default(),
        Some(owner),
        "large-export".to_string(),
        "SELECT value, label FROM numbers ORDER BY value".to_string(),
        ExportDestination::SessionDownload(owner),
        "csv".to_string(),
        None,
        None,
    )
    .await
    .unwrap()
    .unwrap();
    let GeneratedFile::Download { token, size, .. } = result else {
        panic!("browser query exports must use a download token");
    };
    assert!(size > 500_000, "fixture must exercise a large export");
    assert_eq!(
        fs::read_dir(runtime.paths.data_dir().join("query-export-jobs"))
            .unwrap()
            .count(),
        0,
        "the intermediate export must be removed after token creation",
    );

    let mut reader = FileTransferStore::new(runtime.paths.data_dir())
        .consume_download(owner, &token)
        .await
        .unwrap();
    let mut chunk = [0_u8; 8192];
    let mut streamed = 0_u64;
    loop {
        let read = reader.read(&mut chunk).await.unwrap();
        if read == 0 {
            break;
        }
        streamed += read as u64;
    }
    assert_eq!(streamed, size);
    drop(reader);
    assert!(FileTransferStore::new(runtime.paths.data_dir())
        .consume_download(owner, &token)
        .await
        .is_err());
}

#[tokio::test]
async fn log_exports_stream_to_downloads_and_remove_intermediate_files() {
    let (_temp, runtime) = fixture();
    let logs = create_log_buffer(10);
    logs.lock().unwrap().push(LogEntry {
        timestamp: "2026-08-22 00:00:00.000".to_string(),
        level: "INFO".to_string(),
        message: "Started".to_string(),
        target: Some("fixture".to_string()),
    });
    let owner = Uuid::new_v4();
    let result = export_logs(&runtime, logs, ExportDestination::SessionDownload(owner))
        .await
        .unwrap()
        .unwrap();
    let GeneratedFile::Download { token, .. } = result else {
        panic!("browser log exports must use a download token");
    };
    assert_eq!(
        fs::read_dir(runtime.paths.data_dir().join("log-export-jobs"))
            .unwrap()
            .count(),
        0,
    );
    let mut reader = FileTransferStore::new(runtime.paths.data_dir())
        .consume_download(owner, &token)
        .await
        .unwrap();
    let mut content = String::new();
    reader.read_to_string(&mut content).await.unwrap();
    assert!(content.contains("[INFO] Started (target: fixture)"));
}

#[tokio::test]
async fn interrupted_export_registrations_abort_jobs_and_remove_handles() {
    let state = ExportCancellationState::default();
    let task = tokio::spawn(std::future::pending::<()>());
    let registration = ExportRegistration::new(
        state.handles.clone(),
        "interrupted".to_string(),
        Arc::new(task.abort_handle()),
    );
    drop(registration);

    assert!(task.await.unwrap_err().is_cancelled());
    assert!(state.handles.lock().unwrap().is_empty());
}

#[tokio::test]
async fn session_cleanup_aborts_only_the_owners_exports() {
    let state = ExportCancellationState::default();
    let owner = Uuid::new_v4();
    let other = Uuid::new_v4();
    let owned_task = tokio::spawn(std::future::pending::<()>());
    let other_task = tokio::spawn(std::future::pending::<()>());
    register_abort_handle(
        &state.handles,
        export_key(Some(owner), "connection"),
        Arc::new(owned_task.abort_handle()),
    );
    register_abort_handle(
        &state.handles,
        export_key(Some(other), "connection"),
        Arc::new(other_task.abort_handle()),
    );

    cancel_session_exports(&state, owner);
    assert!(owned_task.await.unwrap_err().is_cancelled());
    assert!(!other_task.is_finished());
    other_task.abort();
}
