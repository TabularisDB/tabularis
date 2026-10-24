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

fn postgres_dialect() -> DumpDialect {
    let pg = crate::drivers::postgres::PostgresDriver::new();
    DumpDialect::from_capabilities("postgres", &pg.manifest().capabilities)
}

fn column(name: &str, data_type: &str) -> TableColumn {
    TableColumn {
        name: name.to_string(),
        data_type: data_type.to_string(),
        is_pk: false,
        is_nullable: true,
        is_auto_increment: false,
        is_generated: false,
        default_value: None,
        character_maximum_length: None,
        comment: None,
        numeric_precision: None,
        numeric_scale: None,
        full_type: None,
    }
}

#[test]
fn test_json_column_names_matches_json_and_jsonb_case_insensitively() {
    let columns = vec![
        column("id", "integer"),
        column("payload", "jsonb"),
        column("meta", "JSON"),
        column("name", "text"),
    ];
    let json_cols = json_column_names(&columns);
    assert_eq!(json_cols.len(), 2);
    assert!(json_cols.contains("payload"));
    assert!(json_cols.contains("meta"));
    assert!(!json_cols.contains("id"));
    assert!(!json_cols.contains("name"));
}

#[test]
fn test_json_column_names_empty_for_no_json_columns() {
    let columns = vec![column("id", "integer"), column("name", "text")];
    assert!(json_column_names(&columns).is_empty());
}

#[test]
fn test_format_row_values_escapes_json_column_differently_from_plain_text() {
    // Same underlying serde_json::Value::String("hi") in two columns:
    // the plain text column keeps it literal, the JSON column re-encodes
    // it as a JSON string literal (surrounding quotes preserved) --
    // this is the whole reason json_column_names exists (#822 dump fix
    // for plugin-backed drivers: QueryResult only carries column names,
    // not types, so this can't be inferred from the value alone).
    let columns = vec!["name".to_string(), "payload".to_string()];
    let mut json_cols = HashSet::new();
    json_cols.insert("payload".to_string());

    let row = vec![json!("hi"), json!("hi")];
    assert_eq!(
        format_row_values(row, &columns, &json_cols, &postgres_dialect()),
        r#"('hi', '"hi"')"#
    );
}

#[test]
fn test_format_row_values_regression_json_object_and_null_round_trip() {
    let columns = vec!["id".to_string(), "payload".to_string(), "note".to_string()];
    let mut json_cols = HashSet::new();
    json_cols.insert("payload".to_string());

    let row = vec![json!(1), json!({"a": 1}), serde_json::Value::Null];
    assert_eq!(
        format_row_values(row, &columns, &json_cols, &postgres_dialect()),
        r#"(1, '{"a":1}', NULL)"#
    );
}

fn pagination(has_more: bool) -> Pagination {
    Pagination {
        page: 1,
        page_size: 1000,
        total_rows: None,
        has_more,
    }
}

#[test]
fn test_plugin_dump_has_more_trusts_real_pagination_over_the_fallback() {
    // A full page that the driver explicitly says is the last one must
    // not be reinterpreted as "more rows" just because it's full.
    assert!(!plugin_dump_has_more(Some(pagination(false)), 1000, 1000));
    // A short page the driver explicitly says has more must still be
    // honored, even though the fallback heuristic alone would say no.
    assert!(plugin_dump_has_more(Some(pagination(true)), 10, 1000));
}

#[test]
fn test_plugin_dump_has_more_regression_a_full_page_without_pagination_is_not_treated_as_the_end() {
    // Regression: a plugin's execute_query RPC that never populates
    // `pagination` used to default this to `false`, silently truncating
    // any table with more rows than one page.
    assert!(plugin_dump_has_more(None, 1000, 1000));
}

#[test]
fn test_plugin_dump_has_more_a_short_page_without_pagination_ends_the_fetch() {
    assert!(!plugin_dump_has_more(None, 10, 1000));
}

#[test]
fn test_plugin_dump_has_more_an_empty_page_without_pagination_ends_the_fetch() {
    assert!(!plugin_dump_has_more(None, 0, 1000));
}
