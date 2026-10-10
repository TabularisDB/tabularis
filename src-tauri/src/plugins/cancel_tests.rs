use super::*;

/// Spawns a plugin that never answers and records every stdin line in a file.
/// fd 3 keeps the stdout pipe open, otherwise the host sees EOF and treats
/// the plugin as exited.
#[cfg(unix)]
async fn silent_recording_plugin(dir: &std::path::Path) -> (PluginProcess, PathBuf) {
    let log = dir.join("stdin.log");
    let script = dir.join("plugin.sh");
    std::fs::write(&script, format!("exec 3>&1 cat > '{}'\n", log.display())).unwrap();
    let process = PluginProcess::new("test-plugin".to_string(), script, Some("/bin/sh".into()))
        .await
        .expect("spawn sh");
    (process, log)
}

#[cfg(unix)]
async fn wait_for_lines(log: &std::path::Path, count: usize, within: Duration) -> Vec<Value> {
    let deadline = tokio::time::Instant::now() + within;
    loop {
        let lines: Vec<Value> = std::fs::read_to_string(log)
            .unwrap_or_default()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        if lines.len() >= count || tokio::time::Instant::now() >= deadline {
            return lines;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

#[cfg(unix)]
#[tokio::test]
async fn timed_out_call_sends_a_cancel_notification_for_its_id() {
    let dir = tempfile::tempdir().unwrap();
    let (process, log) = silent_recording_plugin(dir.path()).await;

    let error = process
        .send_request(
            "execute_query",
            json!({ "query": "SELECT pg_sleep(330)" }),
            Some(Duration::from_millis(100)),
        )
        .await
        .unwrap_err();
    assert!(error.to_string().contains("timed out"));

    let lines = wait_for_lines(&log, 2, Duration::from_secs(5)).await;
    process.shutdown().await;

    assert_eq!(lines.len(), 2, "expected request + cancel, got {lines:?}");
    assert_eq!(lines[0]["method"], "execute_query");
    let id = lines[0]["id"].as_u64().unwrap();
    assert_eq!(
        lines[1],
        json!({ "jsonrpc": "2.0", "method": "cancel", "params": { "id": id } })
    );
}

#[cfg(unix)]
#[tokio::test]
async fn call_without_timeout_never_sends_a_cancel() {
    let dir = tempfile::tempdir().unwrap();
    let (process, log) = silent_recording_plugin(dir.path()).await;
    let process = Arc::new(process);

    let call = tokio::spawn({
        let process = process.clone();
        async move {
            process
                .send_request("execute_query", json!({ "query": "SELECT 1" }), None)
                .await
        }
    });

    let lines = wait_for_lines(&log, 1, Duration::from_secs(5)).await;
    let lines_later = wait_for_lines(&log, 2, Duration::from_millis(300)).await;
    assert!(!call.is_finished(), "an unlimited call must keep waiting");
    call.abort();
    process.shutdown().await;

    assert_eq!(lines.len(), 1);
    assert_eq!(
        lines_later.len(),
        1,
        "no cancel expected, got {lines_later:?}"
    );
}


#[cfg(unix)]
#[tokio::test]
async fn shutdown_allows_an_inflight_plugin_response() {
    let dir = tempfile::tempdir().unwrap();
    let log = dir.path().join("requests.log");
    let script = dir.path().join("respond.sh");
    std::fs::write(
        &script,
        format!(
            "read -r request\nprintf '%s\\n' \"$request\" > '{}'\nsleep 0.2\nprintf '%s\\n' '{{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{{\"ok\":true}}}}'\nexec cat >/dev/null\n",
            log.display()
        ),
    ).unwrap();

    let process = Arc::new(PluginProcess::new(
        "test-plugin".to_string(), script, Some("/bin/sh".into()),
    ).await.expect("spawn responsive plugin"));

    let call = tokio::spawn({
        let process = process.clone();
        async move { process.send_request("execute_query", json!({}), None).await }
    });
    let received = wait_for_lines(&log, 1, Duration::from_secs(5)).await;
    assert_eq!(received.len(), 1, "plugin must receive the call before shutdown");

    process.shutdown().await;
    assert_eq!(call.await.unwrap().unwrap(), json!({"ok": true}));
    assert!(process.send_request("execute_query", json!({}), None).await
        .unwrap_err().to_string().contains("shutting down"));
}

#[cfg(unix)]
#[tokio::test]
async fn shutdown_bounds_a_hung_plugin_and_reports_a_specific_error() {
    let dir = tempfile::tempdir().unwrap();
    let (process, log) = silent_recording_plugin(dir.path()).await;
    let process = Arc::new(process);
    let call = tokio::spawn({
        let process = process.clone();
        async move { process.send_request("execute_query", json!({}), None).await }
    });
    let received = wait_for_lines(&log, 1, Duration::from_secs(5)).await;
    assert_eq!(received.len(), 1, "plugin must receive the call before shutdown");

    let started = std::time::Instant::now();
    process.shutdown().await;
    assert!(started.elapsed() < PLUGIN_SHUTDOWN_GRACE + Duration::from_secs(2));
    let error = call.await.unwrap().unwrap_err().to_string();
    assert!(error.contains("shutdown grace period"), "got {error}");
}
