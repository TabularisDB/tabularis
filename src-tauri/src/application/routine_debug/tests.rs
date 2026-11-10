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
            preview_id: Some("p".into()),
            created: Instant::now(),
            started: true,
            closing_preview: false,
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
        let legacy = crate::plugins::driver::test_driver(|_| serde_json::Value::Null);
        let mut manifest = legacy.manifest().clone();
        manifest.capabilities.routine_debug = Some(1);
        let calls = Arc::new(AtomicUsize::new(0));
        let counter = calls.clone();
        let driver = Arc::new(crate::plugins::driver::test_driver_with_manifest(
            manifest,
            move |request| {
                assert_eq!(request.params["command"]["action"], "stop");
                assert_eq!(request.params["command"]["session_id"], "native-preview");
                counter.fetch_add(1, Ordering::SeqCst);
                Ok(serde_json::to_value(cancelled_preview("native-preview".into())).unwrap())
            },
        ));
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
                preview_id: Some("native-preview".into()),
                created: Instant::now(),
                started: completed,
                closing_preview: false,
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
            matches!(response, DebugResponse::Session { session, .. } if session.session_id == id && matches!(session.resources, DebugResources::Released)
            && matches!(session.transaction, crate::routine_debug::DebugTransaction::Unknown))
        );
        assert!(!sessions().lock().unwrap().contains_key(&id));
        assert_eq!(calls.load(Ordering::SeqCst), usize::from(!completed));
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
            preview_id: Some("native-preview".into()),
            created: Instant::now(),
            started: false,
            closing_preview: false,
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

fn preview_command() -> DebugCommand {
    DebugCommand::Preview {
        target: crate::routine_debug::DebugTarget {
            database: "FREEPDB1".into(),
            schema: "APP".into(),
            name: "TEST".into(),
            routine_type: "PROCEDURE".into(),
            identity_args: "".into(),
        },
        arguments: vec![],
    }
}

fn preview_reply(request: &serde_json::Value, id: &str) -> serde_json::Value {
    serde_json::json!({"kind":"preview","version":1,"preview_id":id,
        "target":request["command"]["target"],"arguments":request["command"]["arguments"],
        "source":{"state":"unavailable","reason":"No source"},"warnings":[]})
}

#[tokio::test]
async fn preview_cap_is_checked_before_native_allocation_and_disconnect_discards_previews() {
    let owner = Some(Uuid::new_v4());
    let calls = Arc::new(AtomicUsize::new(0));
    let counter = calls.clone();
    let stops = Arc::new(Mutex::new(Vec::new()));
    let discarded = stops.clone();
    let legacy = crate::plugins::driver::test_driver(|_| serde_json::Value::Null);
    let mut manifest = legacy.manifest().clone();
    manifest.capabilities.routine_debug = Some(1);
    let driver = Arc::new(crate::plugins::driver::test_driver_with_manifest(
        manifest,
        move |request| {
            if request.params["command"]["action"] == "preview" {
                let number = counter.fetch_add(1, Ordering::SeqCst);
                Ok(preview_reply(&request.params, &format!("native-{number}")))
            } else {
                assert_eq!(request.params["command"]["action"], "stop");
                let id = request.params["command"]["session_id"].as_str().unwrap();
                discarded.lock().unwrap().push(id.to_string());
                Ok(serde_json::to_value(cancelled_preview(id.into())).unwrap())
            }
        },
    ));
    for _ in 0..16 {
        create_preview(
            owner,
            "cap",
            driver.clone(),
            ConnectionParams::default(),
            &preview_command(),
        )
        .await
        .unwrap();
    }
    assert!(create_preview(
        owner,
        "cap",
        driver,
        ConnectionParams::default(),
        &preview_command()
    )
    .await
    .unwrap_err()
    .contains("Close existing"));
    assert_eq!(calls.load(Ordering::SeqCst), 16);
    release(owner, Some("cap")).await;
    let mut ids = stops.lock().unwrap().clone();
    ids.sort();
    ids.dedup();
    assert_eq!(ids.len(), 16);
}

#[tokio::test]
async fn failed_preview_releases_its_capacity_reservation() {
    let owner = Some(Uuid::new_v4());
    let legacy = crate::plugins::driver::test_driver(|_| serde_json::Value::Null);
    let mut manifest = legacy.manifest().clone();
    manifest.capabilities.routine_debug = Some(1);
    let driver = Arc::new(crate::plugins::driver::test_driver_with_manifest(
        manifest,
        |_| Err("Preview failed".into()),
    ));
    assert!(create_preview(
        owner,
        "failed",
        driver,
        ConnectionParams::default(),
        &preview_command()
    )
    .await
    .is_err());
    assert!(!sessions()
        .lock()
        .unwrap()
        .values()
        .any(|s| s.owner == owner));
}

#[tokio::test]
async fn expired_previews_are_discarded_before_the_next_native_preview() {
    let owner = Some(Uuid::new_v4());
    let calls = Arc::new(Mutex::new(Vec::new()));
    let recorded = calls.clone();
    let legacy = crate::plugins::driver::test_driver(|_| serde_json::Value::Null);
    let mut manifest = legacy.manifest().clone();
    manifest.capabilities.routine_debug = Some(1);
    let driver = Arc::new(crate::plugins::driver::test_driver_with_manifest(
        manifest,
        move |request| {
            let command = &request.params["command"];
            recorded
                .lock()
                .unwrap()
                .push(command["action"].as_str().unwrap().to_string());
            if command["action"] == "preview" {
                Ok(preview_reply(&request.params, "native-expiring"))
            } else {
                assert_eq!(command["session_id"], "native-expiring");
                Ok(serde_json::to_value(cancelled_preview("native-expiring".into())).unwrap())
            }
        },
    ));
    let response = create_preview(
        owner,
        "expiry",
        driver.clone(),
        ConnectionParams::default(),
        &preview_command(),
    )
    .await
    .unwrap();
    let DebugResponse::Preview { preview_id, .. } = response else {
        panic!("Expected preview")
    };
    sessions()
        .lock()
        .unwrap()
        .get_mut(&preview_id)
        .unwrap()
        .created = Instant::now() - Duration::from_secs(301);
    create_preview(
        owner,
        "expiry",
        driver,
        ConnectionParams::default(),
        &preview_command(),
    )
    .await
    .unwrap();
    assert_eq!(*calls.lock().unwrap(), vec!["preview", "stop", "preview"]);
    release(owner, Some("expiry")).await;
}

#[tokio::test]
async fn preview_closed_during_native_request_is_discarded_when_reply_arrives() {
    let owner = Some(Uuid::new_v4());
    let stops = Arc::new(AtomicUsize::new(0));
    let count = stops.clone();
    let legacy = crate::plugins::driver::test_driver(|_| serde_json::Value::Null);
    let mut manifest = legacy.manifest().clone();
    manifest.capabilities.routine_debug = Some(1);
    let driver = Arc::new(crate::plugins::driver::test_driver_with_manifest(
        manifest,
        move |request| {
            if request.params["command"]["action"] == "preview" {
                sessions().lock().unwrap().retain(|_, s| s.owner != owner);
                Ok(preview_reply(&request.params, "native-closed"))
            } else {
                assert_eq!(request.params["command"]["action"], "stop");
                assert_eq!(request.params["command"]["session_id"], "native-closed");
                count.fetch_add(1, Ordering::SeqCst);
                Ok(serde_json::to_value(cancelled_preview("native-closed".into())).unwrap())
            }
        },
    ));
    assert!(create_preview(
        owner,
        "closed",
        driver,
        ConnectionParams::default(),
        &preview_command()
    )
    .await
    .unwrap_err()
    .contains("closed before"));
    assert_eq!(stops.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn closing_preview_cannot_start_even_when_native_discard_fails() {
    let owner = Some(Uuid::new_v4());
    let id = Uuid::new_v4().to_string();
    let legacy = crate::plugins::driver::test_driver(|_| serde_json::Value::Null);
    let mut manifest = legacy.manifest().clone();
    manifest.capabilities.routine_debug = Some(1);
    let driver = Arc::new(crate::plugins::driver::test_driver_with_manifest(
        manifest,
        |request| {
            assert_eq!(request.params["command"]["action"], "stop");
            Err("Discard not confirmed".into())
        },
    ));
    sessions().lock().unwrap().insert(
        id.clone(),
        Session {
            owner,
            connection_id: "closing".into(),
            driver,
            params: ConnectionParams::default(),
            preview_id: Some("native-closing".into()),
            created: Instant::now(),
            started: false,
            closing_preview: false,
            terminal: None,
        },
    );
    let runtime = RuntimeContext::system();
    assert!(execute(
        &runtime,
        owner,
        "closing",
        1,
        DebugCommand::Stop {
            session_id: id.clone()
        }
    )
    .await
    .is_err());
    assert!(execute(
        &runtime,
        owner,
        "closing",
        1,
        DebugCommand::Start {
            session_id: id.clone(),
            preview_id: id.clone()
        }
    )
    .await
    .is_err());
    assert!(sessions().lock().unwrap().get(&id).unwrap().closing_preview);
    release(owner, Some("closing")).await;
}
