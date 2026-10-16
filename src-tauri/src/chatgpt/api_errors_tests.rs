use super::from_body;

#[test]
fn identifies_the_rejected_request_field() {
    let result = from_body(400, br#"{"error":{"type":"invalid_request_error","code":"invalid_type","param":"input","message":"Echoed private request content"}}"#);
    assert!(result.contains("HTTP 400"));
    assert!(result.contains("invalid_type"));
    assert!(result.contains("parameter: input"));
    assert!(!result.contains("Echoed"));
}

#[test]
fn explains_the_chatgpt_input_list_requirement() {
    let result = from_body(400, br#"{"detail":"Input must be a list"}"#);
    assert!(result.contains("input must be an array of messages"));
}

#[test]
fn never_returns_raw_server_messages_or_non_json_bodies() {
    for body in [
        br#"{"error":{"message":"Bearer secret-token and private SQL"}}"#.as_slice(),
        br#"<html>secret-token</html>"#,
        b"not-json",
        b"",
    ] {
        let result = from_body(400, body);
        assert_eq!(result, crate::chatgpt::protocol::api_error(400));
        assert!(!result.contains("secret-token"));
    }
}

#[test]
fn rejects_unbounded_or_non_identifier_diagnostics() {
    let result = from_body(400, br#"{"error":{"code":"Bearer secret-token","param":"https://example.com/?access_token=secret-token"}}"#);
    assert_eq!(result, crate::chatgpt::protocol::api_error(400));
    let body = serde_json::json!({"error":{"code":"x".repeat(129)}}).to_string();
    assert_eq!(
        from_body(400, body.as_bytes()),
        crate::chatgpt::protocol::api_error(400)
    );
}

#[test]
fn retains_authentication_and_usage_recovery_actions() {
    assert!(from_body(401, b"{}").contains("Continue with ChatGPT"));
    assert!(from_body(
        429,
        br#"{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}"#
    )
    .contains("Manage usage"));
}
