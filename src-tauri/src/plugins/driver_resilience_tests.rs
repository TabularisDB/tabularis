use super::*;

#[tokio::test]
async fn crashed_plugin_process_fails_pending_calls_without_hanging() {
    let (sender, mut receiver) = mpsc::channel::<PluginCommand>(1);
    tokio::spawn(async move {
        let _pending_call = receiver.recv().await;
    });
    let (shutdown_tx, _shutdown_rx) = oneshot::channel();
    let process = PluginProcess {
        sender,
        next_id: AtomicU64::new(1),
        shutdown_tx: tokio::sync::Mutex::new(Some(shutdown_tx)),
        pid: None,
    };

    let result = tokio::time::timeout(
        Duration::from_millis(100),
        process.call_with_timeout("ping", json!({}), Duration::from_secs(60)),
    )
    .await
    .expect("a crashed plugin must release pending callers")
    .unwrap_err();

    assert_eq!(result, "Plugin process did not respond");
}
