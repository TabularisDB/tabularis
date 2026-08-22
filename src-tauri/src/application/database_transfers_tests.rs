use super::*;
use serde_json::json;
use std::io::Cursor;
use std::sync::Mutex as StdMutex;
use std::time::Duration;

#[derive(Default)]
struct RecordingEvents {
    scoped: StdMutex<Vec<(Uuid, String, serde_json::Value)>>,
}

impl crate::runtime::events::RuntimeEvents for RecordingEvents {
    fn emit(&self, _event: &str, _payload: serde_json::Value) -> Result<(), String> {
        Ok(())
    }

    fn emit_to(
        &self,
        session_id: Uuid,
        event: &str,
        payload: serde_json::Value,
    ) -> Result<(), String> {
        self.scoped
            .lock()
            .unwrap()
            .push((session_id, event.to_string(), payload));
        Ok(())
    }
}

#[test]
fn escapes_dump_values_without_losing_nulls_or_quotes() {
    assert_eq!(escape_sql_value(json!(null)), "NULL");
    assert_eq!(escape_sql_value(json!(123)), "123");
    assert_eq!(escape_sql_value(json!(true)), "1");
    assert_eq!(escape_sql_value(json!(false)), "0");
    assert_eq!(escape_sql_value(json!("O'Reilly")), "'O''Reilly'");
    assert_eq!(escape_sql_value(json!("Back\\slash")), "'Back\\\\slash'");
}

#[test]
fn streams_sql_statements_and_ignores_line_comments() {
    let input = Cursor::new(
        b"-- dump header\nCREATE TABLE users (id INTEGER);\n\nINSERT INTO users VALUES (1);\n"
            .to_vec(),
    );
    let mut stream = SqlStatementStream::new(BufReader::new(input));

    assert_eq!(
        stream.next_statement().unwrap().as_deref(),
        Some("CREATE TABLE users (id INTEGER);")
    );
    assert_eq!(
        stream.next_statement().unwrap().as_deref(),
        Some("INSERT INTO users VALUES (1);")
    );
    assert_eq!(stream.next_statement().unwrap(), None);
}

#[test]
fn reads_the_first_sql_file_from_a_zip_upload() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("database.zip");
    let file = File::create(&path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    let options: zip::write::FileOptions<()> = zip::write::FileOptions::default();
    zip.start_file("README.txt", options).unwrap();
    zip.write_all(b"ignore").unwrap();
    zip.start_file("database.sql", options).unwrap();
    zip.write_all(b"SELECT 1;").unwrap();
    zip.finish().unwrap();

    let (mut reader, extracted) =
        create_sql_reader(File::open(path).unwrap(), true, directory.path()).unwrap();
    assert!(extracted.is_some());
    let mut sql = String::new();
    reader.read_to_string(&mut sql).unwrap();
    assert_eq!(sql, "SELECT 1;");
}

#[test]
fn progress_events_are_scoped_to_the_owning_browser_session() {
    let directory = tempfile::tempdir().unwrap();
    let events = Arc::new(RecordingEvents::default());
    let runtime = RuntimeContext::new(
        Arc::new(crate::runtime::paths::FixedRuntimePaths::new(
            directory.path().to_path_buf(),
            directory.path().to_path_buf(),
        )),
        events.clone(),
        Arc::new(crate::runtime::secrets::KeyringRuntimeSecrets),
    );
    let owner = Uuid::new_v4();

    emit_progress(
        &runtime,
        Some(owner),
        "dump_progress",
        &DumpProgress {
            connection_id: "connection-1".to_string(),
            tables_processed: 1,
            total_tables: 2,
            percentage: 50.0,
            current_operation: "Dumped table users".to_string(),
        },
    );

    let recorded = events.scoped.lock().unwrap();
    assert_eq!(recorded.len(), 1);
    assert_eq!(recorded[0].0, owner);
    assert_eq!(recorded[0].1, "dump_progress");
    assert_eq!(recorded[0].2["connection_id"], "connection-1");
}

#[tokio::test]
async fn dropping_a_job_registration_aborts_and_unregisters_the_job() {
    let state = DumpCancellationState::default();
    let task = tokio::spawn(async {
        tokio::time::sleep(Duration::from_secs(60)).await;
    });
    let key = "web:test:dump:connection".to_string();
    let registration = JobRegistration::new(
        state.handles.clone(),
        key.clone(),
        Arc::new(task.abort_handle()),
    );
    assert!(state.handles.lock().unwrap().contains_key(&key));

    drop(registration);
    assert!(!state.handles.lock().unwrap().contains_key(&key));
    assert!(task.await.unwrap_err().is_cancelled());
}

#[tokio::test]
async fn session_cleanup_only_aborts_jobs_owned_by_that_session() {
    let state = DumpCancellationState::default();
    let owner = Uuid::new_v4();
    let other = Uuid::new_v4();
    let owner_task = tokio::spawn(std::future::pending::<()>());
    let other_task = tokio::spawn(std::future::pending::<()>());
    register_abort_handle(
        &state.handles,
        job_key(Some(owner), JobKind::Import, "connection"),
        Arc::new(owner_task.abort_handle()),
    );
    register_abort_handle(
        &state.handles,
        job_key(Some(other), JobKind::Import, "connection"),
        Arc::new(other_task.abort_handle()),
    );

    cancel_session_jobs(&state, owner);

    assert!(owner_task.await.unwrap_err().is_cancelled());
    assert!(!other_task.is_finished());
    other_task.abort();
}
