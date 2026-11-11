use super::*;
use crate::commands::{register_abort_handle, QueryCancellationState};
use std::time::Duration;

#[tokio::test]
async fn sandbox_query_rejects_incomplete_results() {
    let file = tempfile::NamedTempFile::new().unwrap();
    let params = crate::models::ConnectionParams {
        driver: "sqlite".into(),
        database: crate::models::DatabaseSelection::Single(file.path().to_string_lossy().into()),
        ..Default::default()
    };
    let driver = crate::drivers::sqlite::SqliteDriver::new();
    let result = execute_bounded_plugin_query(&driver, &params, "SELECT 42", None)
        .await
        .unwrap();
    assert_eq!(result.rows.len(), 1);
    let boundary = format!(
        "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < {}) SELECT x FROM n",
        WEB_MAX_ROWS_PER_PAGE
    );
    let result = execute_bounded_plugin_query(&driver, &params, &boundary, None)
        .await
        .unwrap();
    assert_eq!(result.rows.len(), WEB_MAX_ROWS_PER_PAGE as usize);
    let query = format!(
        "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x <= {}) SELECT x FROM n",
        WEB_MAX_ROWS_PER_PAGE
    );
    let error = execute_bounded_plugin_query(&driver, &params, &query, None)
        .await
        .unwrap_err();
    assert!(error.contains("narrow the query or add a LIMIT"));
}

async fn sleeper() -> tokio::task::JoinHandle<()> {
    tokio::spawn(async { tokio::time::sleep(Duration::from_secs(10)).await })
}

#[test]
fn web_policy_caps_rows_and_rejects_oversized_payloads() {
    assert_eq!(
        response_limit(QueryResponsePolicy::WebBounded, None),
        Some(WEB_MAX_ROWS_PER_PAGE)
    );
    assert_eq!(
        response_limit(
            QueryResponsePolicy::WebBounded,
            Some(WEB_MAX_ROWS_PER_PAGE + 1)
        ),
        Some(WEB_MAX_ROWS_PER_PAGE)
    );
    assert_eq!(response_limit(QueryResponsePolicy::Unbounded, None), None);

    let oversized = "x".repeat(WEB_MAX_RESPONSE_BYTES);
    let error = enforce_response_size(QueryResponsePolicy::WebBounded, &oversized).unwrap_err();
    assert!(error.contains("use pagination"));
    assert!(enforce_response_size(QueryResponsePolicy::Unbounded, &oversized).is_ok());
}

#[test]
fn sanitizes_editor_quotes_and_trailing_semicolons() {
    assert_eq!(
        sanitize_user_query("  SELECT ‘value’, “column”;;;  "),
        "SELECT 'value', \"column\""
    );
}

#[tokio::test]
async fn dropping_a_query_registration_aborts_and_unregisters_the_task() {
    let state = QueryCancellationState::default();
    let task = sleeper().await;
    let handle = Arc::new(task.abort_handle());
    let registration = QueryTaskRegistration::new(&state, "query-slot".to_string(), handle);
    assert!(state.handles.lock().unwrap().contains_key("query-slot"));

    drop(registration);

    assert!(task.await.unwrap_err().is_cancelled());
    assert!(!state.handles.lock().unwrap().contains_key("query-slot"));
}

#[tokio::test]
async fn session_cleanup_aborts_only_queries_owned_by_that_browser_session() {
    let state = QueryCancellationState::default();
    let owner = Uuid::new_v4();
    let other = Uuid::new_v4();
    let owner_task = sleeper().await;
    let other_task = sleeper().await;
    let owner_slot = cancellation_slot(
        QueryRequestScope {
            session_id: Some(owner),
            request_id: Some("request-owner"),
        },
        "connection-1",
    );
    let other_slot = cancellation_slot(
        QueryRequestScope {
            session_id: Some(other),
            request_id: Some("request-other"),
        },
        "connection-1",
    );
    register_abort_handle(
        &state.handles,
        owner_slot,
        Arc::new(owner_task.abort_handle()),
    );
    register_abort_handle(
        &state.handles,
        other_slot.clone(),
        Arc::new(other_task.abort_handle()),
    );

    cancel_session_queries(&state, owner);

    assert!(owner_task.await.unwrap_err().is_cancelled());
    assert!(!other_task.is_finished());
    assert!(state.handles.lock().unwrap().contains_key(&other_slot));
    other_task.abort();
}

#[tokio::test]
async fn cancellation_slots_are_isolated_by_session_and_request() {
    let state = QueryCancellationState::default();
    let session_a = Uuid::new_v4();
    let session_b = Uuid::new_v4();
    let task_a = sleeper().await;
    let task_b = sleeper().await;
    let slot_a = cancellation_slot(
        QueryRequestScope {
            session_id: Some(session_a),
            request_id: Some("request-a"),
        },
        "connection-1",
    );
    let slot_b = cancellation_slot(
        QueryRequestScope {
            session_id: Some(session_b),
            request_id: Some("request-b"),
        },
        "connection-1",
    );
    register_abort_handle(
        &state.handles,
        slot_a.clone(),
        Arc::new(task_a.abort_handle()),
    );
    register_abort_handle(
        &state.handles,
        slot_b.clone(),
        Arc::new(task_b.abort_handle()),
    );

    assert_eq!(
        cancellation_slots_for_cancel(&state, Some(session_a), "connection-1", Some("request-a")),
        vec![slot_a]
    );
    cancel_registered_queries(&state, Some(session_a), "connection-1", Some("request-a")).unwrap();

    assert!(task_a.await.unwrap_err().is_cancelled());
    assert!(!task_b.is_finished());
    assert!(state.handles.lock().unwrap().contains_key(&slot_b));
    task_b.abort();
    let _ = task_b.await;
}

struct NoSecrets;
impl crate::runtime::secrets::RuntimeSecrets for NoSecrets {
    fn get(&self, _: &str) -> Result<Option<String>, String> {
        Ok(None)
    }
    fn set(&self, _: &str, _: &str) -> Result<(), String> {
        Ok(())
    }
    fn delete(&self, _: &str) -> Result<(), String> {
        Ok(())
    }
}

#[tokio::test]
async fn cancelling_a_running_stream_with_cancel_query_stops_delivery_and_removes_its_abort_handle()
{
    use crate::drivers::driver_trait::QueryChunk;
    let temp = tempfile::tempdir().unwrap();
    let runtime = RuntimeContext::new(
        Arc::new(crate::runtime::paths::FixedRuntimePaths::new(
            temp.path().into(),
            temp.path().into(),
        )),
        Arc::new(crate::runtime::events::NoopRuntimeEvents),
        Arc::new(NoSecrets),
    );
    let database = temp.path().join("stream.sqlite");
    std::fs::File::create(&database).unwrap();
    crate::drivers::registry::register_driver(crate::drivers::sqlite::SqliteDriver::new()).await;
    let saved: crate::models::SavedConnection = serde_json::from_value(serde_json::json!({
        "id": "streamed",
        "name": "Streamed",
        "params": { "driver": "sqlite", "database": database.to_string_lossy() },
    }))
    .unwrap();
    crate::persistence::save_connections_file(
        &runtime.paths.connections_file(),
        &crate::models::ConnectionsFile {
            connections: vec![saved],
            ..Default::default()
        },
    )
    .unwrap();

    let cancellation = Arc::new(QueryCancellationState::default());
    let (sender, mut chunks) = tokio::sync::mpsc::unbounded_channel();
    let stream = tokio::spawn({
        let (runtime, cancellation) = (runtime.clone(), cancellation.clone());
        async move {
            stream_query(
                &runtime,
                &cancellation,
                QueryRequestScope::DESKTOP,
                "streamed".into(),
                "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 100000000) SELECT x FROM n"
                    .into(),
                None,
                None,
                None,
                move |chunk| {
                    let _ = sender.send(chunk);
                },
            )
            .await
        }
    });
    while !matches!(chunks.recv().await, Some(QueryChunk::Rows(_))) {}

    cancel_query(&cancellation, None, "streamed", None).unwrap();

    assert_eq!(stream.await.unwrap().unwrap_err(), "Query cancelled");
    let mut late = 0;
    while chunks.recv().await.is_some() {
        late += 1;
    }
    assert!(late < 10, "{late} batches arrived after the cancel");
    assert!(!cancellation
        .handles
        .lock()
        .unwrap()
        .contains_key("streamed"));
}
