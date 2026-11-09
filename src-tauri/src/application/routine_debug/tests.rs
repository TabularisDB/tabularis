use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

#[tokio::test]
async fn rejected_inspection_does_not_resume_or_cancel_execution() {
    let legacy = crate::plugins::driver::test_driver(|_| serde_json::Value::Null);
    let mut manifest = legacy.manifest().clone();
    manifest.capabilities.routine_debug = Some(1);
    let actions = Arc::new(Mutex::new(Vec::new()));
    let recorded = actions.clone();
    let driver = Arc::new(crate::plugins::driver::test_driver_with_manifest(
        manifest,
        move |request| {
            recorded.lock().unwrap().push(
                request.params["command"]["action"]
                    .as_str()
                    .unwrap()
                    .to_string(),
            );
            Err("Invalid variable name".into())
        },
    ));
    let owner = Some(Uuid::new_v4());
    let id = Uuid::new_v4().to_string();
    sessions().lock().unwrap().insert(
        id.clone(),
        Session {
            owner,
            connection_id: "inspection".into(),
            driver,
            params: ConnectionParams::default(),
            preview_id: "p".into(),
            created: Instant::now(),
            started: true,
            terminal: None,
        },
    );
    let command = DebugCommand::ReadVariables {
        session_id: id,
        frame_id: "1:2".into(),
        names: vec!["F()".into()],
    };
    assert!(
        execute(&RuntimeContext::system(), owner, "inspection", 1, command)
            .await
            .is_err()
    );
    assert_eq!(*actions.lock().unwrap(), vec!["read_variables"]);
    release(owner, Some("inspection")).await;
    assert_eq!(*actions.lock().unwrap(), vec!["read_variables", "stop"]);
}

#[tokio::test]
async fn closing_a_preview_and_observing_cancelled_cleanup_never_execute_native_code() {
    for completed in [false, true] {
        let id = Uuid::new_v4().to_string();
        let owner = Some(Uuid::new_v4());
        let driver = Arc::new(crate::plugins::driver::test_driver(|_| {
            panic!("must not execute native code")
        }));
        let unavailable = serde_json::json!({"state": "unavailable", "reason": "Not started"});
        let terminal = if completed {
            Some(serde_json::from_value(serde_json::json!({
            "session_id": id, "revision": 2, "execution": "cancelled", "transaction": "unknown", "resources": "released",
            "source": unavailable, "stop": unavailable, "stack": unavailable, "variables": unavailable,
            "outputs": unavailable, "breakpoints": unavailable, "error": null
        })).unwrap())
        } else {
            None
        };
        sessions().lock().unwrap().insert(
            id.clone(),
            Session {
                owner,
                connection_id: "connection".into(),
                driver,
                params: ConnectionParams::default(),
                preview_id: "native-preview".into(),
                created: Instant::now(),
                started: completed,
                terminal,
            },
        );
        let command = if completed {
            DebugCommand::Status {
                session_id: id.clone(),
            }
        } else {
            DebugCommand::Stop {
                session_id: id.clone(),
            }
        };
        let response = execute(&RuntimeContext::system(), owner, "connection", 1, command)
            .await
            .unwrap();
        assert!(
            matches!(response, DebugResponse::Session { session, .. } if matches!(session.resources, DebugResources::Released)
            && matches!(session.transaction, crate::routine_debug::DebugTransaction::Unknown))
        );
        assert!(!sessions().lock().unwrap().contains_key(&id));
    }
}

#[tokio::test]
async fn sessions_are_owned_and_failed_start_cannot_be_replayed() {
    let calls = Arc::new(AtomicUsize::new(0));
    let counter = calls.clone();
    let stops = Arc::new(AtomicUsize::new(0));
    let stop_counter = stops.clone();
    let legacy = crate::plugins::driver::test_driver(|_| serde_json::Value::Null);
    let mut manifest = legacy.manifest().clone();
    manifest.capabilities.routine_debug = Some(1);
    let driver = Arc::new(crate::plugins::driver::test_driver_with_manifest(
        manifest,
        move |request| {
            assert_eq!(request.method, "routine_debug");
            if request.params["command"]["action"] == "start" {
                counter.fetch_add(1, Ordering::SeqCst);
            } else if request.params["command"]["action"] == "stop" {
                stop_counter.fetch_add(1, Ordering::SeqCst);
            }
            Err("lost native reply".into())
        },
    ));
    let owner = Some(Uuid::new_v4());
    let id = Uuid::new_v4().to_string();
    sessions().lock().unwrap().insert(
        id.clone(),
        Session {
            owner,
            connection_id: "connection".into(),
            driver,
            params: ConnectionParams::default(),
            preview_id: "native-preview".into(),
            created: Instant::now(),
            started: false,
            terminal: None,
        },
    );
    let runtime = RuntimeContext::system();
    let command = || DebugCommand::Start {
        preview_id: id.clone(),
        session_id: id.clone(),
    };
    assert!(
        execute(&runtime, Some(Uuid::new_v4()), "connection", 1, command())
            .await
            .is_err()
    );
    assert!(execute(&runtime, owner, "other", 1, command())
        .await
        .is_err());
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    assert!(execute(&runtime, owner, "connection", 1, command())
        .await
        .is_err());
    assert!(execute(&runtime, owner, "connection", 1, command())
        .await
        .unwrap_err()
        .contains("already requested"));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    release(owner, Some("connection")).await;
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert!(stops.load(Ordering::SeqCst) >= 1);
    assert!(!sessions().lock().unwrap().contains_key(&id));
}
