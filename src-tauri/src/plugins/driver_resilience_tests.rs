use super::*;

#[tokio::test]
async fn crashed_plugin_process_fails_pending_calls_without_hanging() {
    let (sender, mut receiver) = mpsc::channel::<PluginCommand>(1);
    tokio::spawn(async move {
        let _pending_call = receiver.recv().await;
    });
    let (shutdown_tx, _shutdown_rx) = oneshot::channel();
    let process = PluginProcess {
        plugin_id: "crashed-plugin-test".to_string(),
        route_selected_database: false,
        accepting_calls: std::sync::atomic::AtomicBool::new(true),
        manager_task: tokio::sync::Mutex::new(None),
        sender,
        next_id: AtomicU64::new(1),
        shutdown_tx: tokio::sync::Mutex::new(Some(shutdown_tx)),
        pid: None,
        initialization_settings: None,
        initialized: OnceCell::new(),
    };

    let result = tokio::time::timeout(Duration::from_millis(100), process.call("ping", json!({})))
        .await
        .expect("a crashed plugin must release pending callers")
        .unwrap_err();

    assert_eq!(result, "Plugin process did not respond");
}

#[tokio::test]
async fn aborted_plugin_call_sends_cancel_even_when_the_command_queue_is_full() {
    let (sender, mut receiver) = mpsc::channel::<PluginCommand>(1);
    let (shutdown_tx, _shutdown_rx) = oneshot::channel();
    let process = Arc::new(PluginProcess {
        plugin_id: "aborted-plugin-test".into(),
        route_selected_database: false,
        accepting_calls: std::sync::atomic::AtomicBool::new(true),
        manager_task: tokio::sync::Mutex::new(None),
        sender,
        next_id: AtomicU64::new(1),
        shutdown_tx: tokio::sync::Mutex::new(Some(shutdown_tx)),
        pid: None,
        initialization_settings: None,
        initialized: OnceCell::new(),
    });
    let running = process.clone();
    let call =
        tokio::spawn(async move { running.send_request("execute_query", json!({}), None).await });
    let PluginCommand::Call(request, response, _) = receiver.recv().await.unwrap() else {
        panic!("expected call")
    };
    process
        .sender
        .try_send(PluginCommand::Cancel(999))
        .ok()
        .unwrap();
    call.abort();
    assert!(call.await.unwrap_err().is_cancelled());
    assert!(response.is_closed());
    assert!(matches!(
        receiver.recv().await,
        Some(PluginCommand::Cancel(999))
    ));
    let cancellation = tokio::time::timeout(Duration::from_secs(1), receiver.recv())
        .await
        .unwrap();
    assert!(matches!(cancellation, Some(PluginCommand::Cancel(id)) if id == request.id));
}

#[tokio::test]
async fn session_state_refresh_replaces_a_stale_cached_transaction_indicator() {
    let session = "state-refresh-cancelled";
    remember_session_state(Some(session), true);
    let driver = test_driver_result(move |request| {
        assert_eq!(request.method, "get_session_state");
        assert_eq!(request.params["session_id"], session);
        Ok(json!({"in_transaction":false}))
    });
    assert_eq!(driver.session_in_transaction(session).await, Some(false));
    assert_eq!(
        plugin_session_states().lock().unwrap().remove(session),
        Some(false)
    );
}

#[tokio::test]
async fn older_plugins_keep_the_cached_state_fallback() {
    let session = "state-refresh-legacy";
    remember_session_state(Some(session), true);
    let driver = test_driver_detailed(|_| {
        Err(PluginCallError::Remote(crate::plugins::rpc::JsonRpcError {
            code: -32601,
            message: "unsupported".into(),
        }))
    });
    assert_eq!(driver.session_in_transaction(session).await, Some(true));
    plugin_session_states().lock().unwrap().remove(session);
}

#[tokio::test]
async fn unavailable_session_probe_does_not_invent_a_closed_transaction() {
    let session = "state-refresh-invalid";
    remember_session_state(Some(session), true);
    let driver = test_driver_result(|_| Ok(json!({"in_transaction":"false"})));
    assert_eq!(driver.session_in_transaction(session).await, Some(true));
    plugin_session_states().lock().unwrap().remove(session);
}

#[tokio::test]
async fn session_probe_can_recover_an_open_transaction_from_a_missed_begin_response() {
    let session = "state-refresh-open";
    remember_session_state(Some(session), false);
    let driver = test_driver_result(|_| Ok(json!({"in_transaction":true})));
    assert_eq!(driver.session_in_transaction(session).await, Some(true));
    plugin_session_states().lock().unwrap().remove(session);
}
