use super::*;

const PLUGIN: &str = r#"while IFS= read -r line; do
  printf '%s\n' "$line" >> 'LOG'
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9]*\)}*$/\1/p')
  case "$line" in
    *'"method":"cancel"'*) CANCEL ;;
    *'"method":"execute_query_stream"'*) STREAM ;;
    *) printf '{"jsonrpc":"2.0","id":%s,"result":{"columns":["n"],"rows":[[1]],"affected_rows":0}}\n' "$id" ;;
  esac
done
"#;

/// The current request id, spliced into a single-quoted shell string.
const ID: &str = r#"'"$id"'"#;

/// Shell command that writes a `query_rows` notification.
fn rows_line(request_id: &str, body: &str) -> String {
    format!(
        r#"echo '{{"jsonrpc":"2.0","method":"query_rows","params":{{"request_id":{request_id},{body}}}}}'"#
    )
}

/// Shell command that writes the reply to the current request.
fn reply_line(result: &str) -> String {
    format!(r#"echo '{{"jsonrpc":"2.0","id":{ID},"result":{result}}}'"#)
}

/// Spawns a shell plugin with `streaming_results` that logs every stdin line.
/// `stream` and `cancel` are shell commands run for those messages; `$id` is
/// the request id.
#[cfg(unix)]
async fn streaming_plugin(
    dir: &std::path::Path,
    stream: &str,
    cancel: &str,
) -> (RpcDriver, PathBuf) {
    let log = dir.join("stdin.log");
    let script = dir.join("plugin.sh");
    let source = PLUGIN
        .replace("LOG", &log.display().to_string())
        .replace("STREAM", stream)
        .replace("CANCEL", cancel);
    std::fs::write(&script, source).unwrap();
    let mut manifest = test_manifest();
    manifest.capabilities.streaming_results = true;
    let driver = RpcDriver::new(
        manifest,
        script,
        Some("/bin/sh".into()),
        vec![],
        HashMap::new(),
    )
    .await
    .expect("spawn sh");
    (driver, log)
}

#[cfg(unix)]
fn logged_requests(log: &std::path::Path) -> Vec<Value> {
    std::fs::read_to_string(log)
        .unwrap_or_default()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

#[cfg(unix)]
#[tokio::test]
async fn streaming_plugin_delivers_query_rows_in_order_then_the_final_result() {
    let dir = tempfile::tempdir().unwrap();
    let stream = [
        rows_line(ID, r#""columns":["id"],"rows":[[1],[2]]"#),
        rows_line(ID, r#""rows":[[3]]"#),
        rows_line(ID, r#""columns":["total"],"rows":[[3]]"#),
        reply_line(r#"{"affected_rows":0,"server_time_ms":1.5,"in_transaction":true}"#),
    ]
    .join("; ");
    let (driver, log) = streaming_plugin(dir.path(), &stream, ":").await;

    let mut chunks = Vec::new();
    let summary = driver
        .execute_query_stream(
            &ConnectionParams::default(),
            "SELECT id FROM t",
            None,
            Some("stream-tab"),
            &mut |chunk| chunks.push(chunk),
        )
        .await
        .unwrap();
    driver.shutdown().await;

    assert_eq!(
        chunks,
        vec![
            QueryChunk::Columns(vec!["id".into()]),
            QueryChunk::Rows(vec![vec![json!(1)], vec![json!(2)]]),
            QueryChunk::Rows(vec![vec![json!(3)]]),
            QueryChunk::Columns(vec!["total".into()]),
            QueryChunk::Rows(vec![vec![json!(3)]]),
        ]
    );
    assert_eq!(
        summary,
        StreamSummary {
            affected_rows: 0,
            server_time_ms: Some(1.5),
            fetch_time_ms: None,
            in_transaction: true,
        }
    );
    let request = logged_requests(&log)
        .into_iter()
        .find(|line| line["method"] == "execute_query_stream")
        .unwrap();
    assert_eq!(request["params"]["session_id"], "stream-tab");
    assert!(request["params"].get("limit").is_none());
}

#[tokio::test]
async fn plugin_without_streaming_results_delivers_one_batch() {
    let driver = test_driver(|rpc| {
        assert_eq!(rpc.method, "execute_query");
        json!({"columns":["id"],"rows":[[1],[2],[3]],"affected_rows":0})
    });

    let mut chunks = Vec::new();
    driver
        .execute_query_stream(
            &ConnectionParams::default(),
            "SELECT id FROM t",
            None,
            None,
            &mut |chunk| chunks.push(chunk),
        )
        .await
        .unwrap();

    assert_eq!(
        chunks,
        vec![
            QueryChunk::Columns(vec!["id".into()]),
            QueryChunk::Rows(vec![vec![json!(1)], vec![json!(2)], vec![json!(3)]]),
        ]
    );
}

#[cfg(unix)]
#[tokio::test]
async fn query_rows_with_an_unknown_request_id_is_ignored() {
    let dir = tempfile::tempdir().unwrap();
    let stream = [
        rows_line("999", r#""columns":["other"],"rows":[[0]]"#),
        rows_line(ID, r#""columns":["id"],"rows":[[1]]"#),
        reply_line(r#"{"affected_rows":0}"#),
    ]
    .join("; ");
    let (driver, _log) = streaming_plugin(dir.path(), &stream, ":").await;

    let mut chunks = Vec::new();
    let result = driver
        .execute_query_stream(
            &ConnectionParams::default(),
            "SELECT id FROM t",
            None,
            None,
            &mut |chunk| chunks.push(chunk),
        )
        .await;
    driver.shutdown().await;

    assert!(result.is_ok(), "{result:?}");
    assert_eq!(
        chunks,
        vec![
            QueryChunk::Columns(vec!["id".into()]),
            QueryChunk::Rows(vec![vec![json!(1)]]),
        ]
    );
}

#[cfg(unix)]
#[tokio::test]
async fn cancelled_stream_stops_delivery_and_the_plugin_serves_the_next_query() {
    let dir = tempfile::tempdir().unwrap();
    // The stream never replies; after the cancel the plugin still sends a late row.
    let stream = rows_line(ID, r#""columns":["id"],"rows":[]"#);
    let cancel = rows_line(ID, r#""rows":[[99]]"#);
    let (driver, log) = streaming_plugin(dir.path(), &stream, &cancel).await;
    let driver = Arc::new(driver);

    let (tx, mut rx) = mpsc::unbounded_channel();
    let task = tokio::spawn({
        let driver = driver.clone();
        async move {
            driver
                .execute_query_stream(
                    &ConnectionParams::default(),
                    "SELECT id FROM t",
                    None,
                    None,
                    &mut |chunk| {
                        let _ = tx.send(chunk);
                    },
                )
                .await
        }
    });
    assert_eq!(
        rx.recv().await,
        Some(QueryChunk::Columns(vec!["id".into()]))
    );
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    assert_eq!(rx.recv().await, None);

    let next = tokio::time::timeout(
        Duration::from_secs(5),
        driver.execute_query(&ConnectionParams::default(), "SELECT 1", None, 1, None),
    )
    .await
    .expect("plugin must answer the next query")
    .unwrap();
    driver.shutdown().await;

    assert_eq!(next.rows, vec![vec![json!(1)]]);
    let requests = logged_requests(&log);
    let stream_id = requests
        .iter()
        .find(|line| line["method"] == "execute_query_stream")
        .unwrap()["id"]
        .clone();
    assert!(requests
        .iter()
        .any(|line| line["method"] == "cancel" && line["params"]["id"] == stream_id));
}
