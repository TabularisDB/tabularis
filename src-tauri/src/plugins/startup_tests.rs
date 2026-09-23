use super::*;

fn process_with_settings() -> (Arc<PluginProcess>, mpsc::Receiver<PluginCommand>) {
    let (sender, receiver) = mpsc::channel(8);
    let process = PluginProcess {
        sender,
        next_id: AtomicU64::new(1),
        shutdown_tx: tokio::sync::Mutex::new(None),
        pid: None,
        initialization_settings: Some(HashMap::from([("region".into(), json!("eu"))])),
        initialized: OnceCell::new(),
    };
    (Arc::new(process), receiver)
}

#[tokio::test]
async fn concurrent_first_calls_wait_for_one_initialization() {
    let (process, mut requests) = process_with_settings();
    assert!(
        requests.try_recv().is_err(),
        "registration must not send initialize"
    );
    let first = tokio::spawn({
        let process = process.clone();
        async move { process.call("get_tables", json!({})).await }
    });
    let second = tokio::spawn({
        let process = process.clone();
        async move { process.call("get_views", json!({})).await }
    });
    let Some(PluginCommand::Call(initialize, response)) = requests.recv().await else {
        panic!("expected initialization");
    };
    assert_eq!(initialize.method, "initialize");
    assert_eq!(initialize.params, json!({ "settings": { "region": "eu" } }));
    assert!(
        requests.try_recv().is_err(),
        "operations must wait for initialization"
    );
    response.send(Ok(Value::Null)).unwrap();
    let mut methods = Vec::new();
    for _ in 0..2 {
        let Some(PluginCommand::Call(request, response)) = requests.recv().await else {
            panic!("expected operation");
        };
        methods.push(request.method);
        response.send(Ok(json!([]))).unwrap();
    }
    methods.sort();
    assert_eq!(methods, ["get_tables", "get_views"]);
    assert_eq!(first.await.unwrap().unwrap(), json!([]));
    assert_eq!(second.await.unwrap().unwrap(), json!([]));
    assert!(requests.try_recv().is_err());
}

#[tokio::test]
async fn legacy_plugin_without_initialize_still_serves_operations() {
    let (process, mut requests) = process_with_settings();
    let task = tokio::spawn(async move {
        process.call("get_tables", json!({})).await.unwrap();
        process.call("get_tables", json!({})).await.unwrap();
    });
    let Some(PluginCommand::Call(request, response)) = requests.recv().await else {
        panic!("expected initialization");
    };
    assert_eq!(request.method, "initialize");
    response
        .send(Err("Method not found (-32601)".to_string().into()))
        .unwrap();
    for _ in 0..2 {
        let Some(PluginCommand::Call(request, response)) = requests.recv().await else {
            panic!("expected operation");
        };
        assert_eq!(request.method, "get_tables");
        response.send(Ok(json!([]))).unwrap();
    }
    task.await.unwrap();
}

#[cfg(unix)]
#[tokio::test]
async fn registering_an_unresponsive_plugin_does_not_wait_for_handshake() {
    // `cat` echoes input rather than speaking JSON-RPC: an eager handshake
    // would wait for the full initialization timeout before registering.
    let driver = tokio::time::timeout(
        Duration::from_secs(2),
        RpcDriver::new(
            test_manifest(),
            PathBuf::from("/bin/cat"),
            None,
            vec![],
            HashMap::new(),
        ),
    )
    .await
    .expect("registration waited for the plugin")
    .expect("spawn cat");
    assert!(driver.process.initialized.get().is_none());
    driver.process.shutdown().await;
}

#[tokio::test]
async fn an_initializing_plugin_does_not_block_another_plugin() {
    let (slow, mut slow_requests) = process_with_settings();
    let (fast, mut fast_requests) = process_with_settings();
    let slow_task = tokio::spawn(async move { slow.call("get_tables", json!({})).await });
    let _pending_initialize = slow_requests.recv().await.expect("slow initialization");
    let fast_task = tokio::spawn(async move { fast.call("get_tables", json!({})).await });
    for method in ["initialize", "get_tables"] {
        let Some(PluginCommand::Call(request, response)) = fast_requests.recv().await else {
            panic!("expected fast plugin request");
        };
        assert_eq!(request.method, method);
        response.send(Ok(json!([]))).unwrap();
    }
    assert_eq!(fast_task.await.unwrap().unwrap(), json!([]));
    assert!(!slow_task.is_finished());
    slow_task.abort();
}
