use super::*;

#[test]
fn cancel_notification_line_is_a_newline_terminated_notification() {
    let line = cancel_notification_line(42);

    assert!(line.ends_with('\n'));
    assert_eq!(line.matches('\n').count(), 1);

    let value: Value = serde_json::from_str(line.trim_end()).unwrap();
    assert_eq!(
        value,
        serde_json::json!({ "jsonrpc": "2.0", "method": "cancel", "params": { "id": 42 } })
    );
}

#[test]
fn cancel_notification_line_omits_the_top_level_id() {
    let value: Value = serde_json::from_str(cancel_notification_line(7).trim_end()).unwrap();

    assert!(value.as_object().unwrap().get("id").is_none());
}

#[test]
fn cancel_notification_line_keeps_large_ids_exact() {
    let value: Value = serde_json::from_str(cancel_notification_line(u64::MAX).trim_end()).unwrap();

    assert_eq!(value["params"]["id"].as_u64(), Some(u64::MAX));
}
