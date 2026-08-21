use super::*;
use crate::commands::{register_abort_handle, QueryCancellationState};
use std::time::Duration;

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
