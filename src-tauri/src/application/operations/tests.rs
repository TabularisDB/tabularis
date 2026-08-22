use super::*;
use crate::logger::{create_log_buffer, LogEntry};

fn entry(level: &str, message: &str) -> LogEntry {
    LogEntry {
        timestamp: "2026-08-22 09:00:00.000".to_string(),
        level: level.to_string(),
        message: message.to_string(),
        target: Some("operations-test".to_string()),
    }
}

#[test]
fn log_operations_filter_limit_resize_and_clear_the_shared_buffer() {
    let buffer = create_log_buffer(4);
    {
        let mut logs = buffer.lock().unwrap();
        logs.push(entry("INFO", "first"));
        logs.push(entry("ERROR", "second"));
        logs.push(entry("ERROR", "third"));
    }

    let errors = get_logs(
        &buffer,
        GetLogsRequest {
            limit: Some(1),
            level_filter: Some("error".to_string()),
        },
    );
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].message, "third");
    assert_eq!(get_log_settings(&buffer).current_count, 3);

    set_log_max_size(&buffer, 2).unwrap();
    assert_eq!(get_log_settings(&buffer).max_size, 2);
    assert_eq!(get_log_settings(&buffer).current_count, 2);

    clear_logs(&buffer).unwrap();
    assert_eq!(get_log_settings(&buffer).current_count, 0);
}

#[test]
fn log_operations_validate_size_and_enabled_state() {
    let buffer = create_log_buffer(4);

    assert_eq!(
        set_log_max_size(&buffer, 0).unwrap_err(),
        "Max size must be between 1 and 10000"
    );
    assert_eq!(
        set_log_max_size(&buffer, 10_001).unwrap_err(),
        "Max size must be between 1 and 10000"
    );

    set_log_enabled(&buffer, false).unwrap();
    buffer.lock().unwrap().push(entry("INFO", "disabled"));
    assert!(!get_log_settings(&buffer).enabled);
    assert!(get_logs(
        &buffer,
        GetLogsRequest {
            limit: None,
            level_filter: None,
        }
    )
    .is_empty());
}

#[test]
fn process_collectors_return_serializable_snapshots() {
    let system = refresh_and_collect_system_stats();
    assert!(system.memory_used <= system.memory_total);
    serde_json::to_value(system).unwrap();

    let children = collect_tabularis_children();
    assert!(children.windows(2).all(|pair| pair[0].pid <= pair[1].pid));
    serde_json::to_value(children).unwrap();
}
