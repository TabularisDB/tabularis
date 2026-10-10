use super::*;
use crate::logger::{create_log_buffer, init_logger};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

/// `get_logs` used to log while still holding the buffer lock. The capturing
/// logger locks that same buffer, so with `--debug` (or anything more verbose)
/// the call never returned and every other logging thread blocked behind it.
#[test]
fn get_logs_does_not_deadlock_when_its_own_logs_are_captured() {
    // The global logger cannot be replaced; isolate it from runtime audit tests.
    const CHILD: &str = "TABULARIS_LOG_DEADLOCK_TEST_CHILD";
    if std::env::var_os(CHILD).is_none() {
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "log_commands::tests::get_logs_does_not_deadlock_when_its_own_logs_are_captured",
                "--nocapture",
            ])
            .env(CHILD, "1")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        return;
    }
    let buffer = create_log_buffer(100);
    // Trace is the most verbose level, so this keeps covering `get_logs`
    // whatever level its own log lines use.
    init_logger(buffer.clone(), log::LevelFilter::Trace);

    let (tx, rx) = mpsc::channel();
    let reader = buffer.clone();
    thread::spawn(move || {
        let request = GetLogsRequest {
            limit: None,
            level_filter: None,
        };
        tx.send(operations::get_logs(&reader, request)).ok();
    });

    rx.recv_timeout(Duration::from_secs(5))
        .expect("get_logs deadlocked while logging with the buffer lock held");

    let captured = buffer.lock().unwrap().get_entries(None, None);
    assert!(
        captured
            .iter()
            .any(|entry| entry.message.starts_with("Returning ")),
        "get_logs' own log lines should reach the capturing logger"
    );
}
