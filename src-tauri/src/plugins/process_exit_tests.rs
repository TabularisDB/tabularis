//! The host must stop plugin processes itself rather than rely on them
//! exiting at stdin EOF (#1280). The fixture plugin never answers and keeps
//! running after its stdin closes.

use super::*;
use crate::drivers::registry;

async fn spawn_eof_ignoring_plugin(id: &str) -> RpcDriver {
    let script =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/eof_ignoring_plugin.sh");
    let driver = RpcDriver::new(
        test_manifest(),
        script,
        Some("sh".to_string()),
        vec![],
        HashMap::new(),
    )
    .await
    .expect("spawn the fixture plugin");
    with_test_driver_id(driver, id)
}

/// Reaps `pid` if it is a finished child of this process. `false` while it
/// still runs; `true` once it is gone, whoever reaped it.
fn has_exited(pid: u32) -> bool {
    let mut status = 0;
    // SAFETY: plain syscall; WNOHANG never blocks.
    unsafe { libc::waitpid(pid as libc::pid_t, &mut status, libc::WNOHANG) != 0 }
}

fn exits_within(pid: u32, limit: Duration) -> bool {
    let deadline = std::time::Instant::now() + limit;
    while std::time::Instant::now() < deadline {
        if has_exited(pid) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    has_exited(pid)
}

/// The MCP server's clean exit: the client closes stdin, `run_mcp_server`
/// returns and the runtime that owns the plugin tasks is dropped.
#[test]
fn dropping_the_runtime_kills_a_plugin_that_ignores_stdin_eof() {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let driver = runtime.block_on(spawn_eof_ignoring_plugin("process-exit-runtime-drop"));
    let pid = driver.process.pid.expect("plugin pid");
    assert!(!has_exited(pid), "the fixture plugin should be running");

    drop(runtime);

    assert!(
        exits_within(pid, Duration::from_secs(5)),
        "plugin {pid} outlived the runtime that started it"
    );
}

#[tokio::test]
async fn terminate_kills_a_busy_plugin_without_waiting_for_the_grace() {
    let driver = Arc::new(spawn_eof_ignoring_plugin("process-exit-terminate").await);
    let pid = driver.process.pid.expect("plugin pid");
    let call = tokio::spawn({
        let driver = driver.clone();
        async move {
            driver
                .process
                .send_request("execute_query", json!({}), None)
                .await
        }
    });
    tokio::time::sleep(Duration::from_millis(50)).await;

    let started = tokio::time::Instant::now();
    driver.terminate().await;

    // `shutdown` would let the in-flight call run for the 2s default grace.
    assert!(
        started.elapsed() < Duration::from_secs(1),
        "terminate waited {:?}",
        started.elapsed()
    );
    assert!(exits_within(pid, Duration::from_secs(1)));
    assert!(call.await.unwrap().is_err(), "the in-flight call must fail");
}

/// What the MCP server runs when a client stops it with SIGTERM.
#[tokio::test]
async fn terminate_external_drivers_stops_registered_plugin_processes() {
    let _guard = registry::REGISTRY_TEST_LOCK.lock().await;
    let id = "process-exit-registry";
    registry::register_driver(spawn_eof_ignoring_plugin(id).await).await;
    let pid = registry::get_driver(id)
        .await
        .and_then(|driver| driver.pid())
        .expect("registered plugin pid");

    registry::terminate_external_drivers().await;

    assert!(exits_within(pid, Duration::from_secs(1)));
    registry::unregister_driver(id).await;
}
