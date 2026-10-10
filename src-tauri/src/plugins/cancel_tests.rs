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
