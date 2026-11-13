use super::*;
use serde_json::json;

#[test]
fn an_empty_redactor_leaves_text_untouched() {
    let redactor = SecretRedactor::default();
    assert!(redactor.is_empty());
    assert_eq!(redactor.redact("plain text"), "plain text");
}

#[test]
fn removes_every_occurrence_of_a_secret() {
    let redactor = SecretRedactor::new(["s3cr3t-pw".to_string()]);
    assert_eq!(
        redactor.redact("auth failed with s3cr3t-pw, retry s3cr3t-pw"),
        "auth failed with [redacted], retry [redacted]"
    );
}

#[test]
fn removes_a_secret_embedded_in_a_connection_uri() {
    let redactor = SecretRedactor::new([
        "mongodb://admin:s3cr3t-pw@db.internal/app".to_string(),
        "s3cr3t-pw".to_string(),
    ]);
    assert_eq!(
        redactor.redact("cannot reach mongodb://admin:s3cr3t-pw@db.internal/app"),
        "cannot reach [redacted]"
    );
}

#[test]
fn the_longest_secret_wins_when_one_contains_another() {
    let redactor = SecretRedactor::new(["pass".to_string(), "password-long".to_string()]);
    assert_eq!(redactor.redact("x password-long y"), "x [redacted] y");
}

#[test]
fn a_short_secret_redacts_the_whole_string_that_contains_it() {
    let redactor = SecretRedactor::new(["abc".to_string()]);
    assert!(!redactor.is_empty());
    assert_eq!(
        redactor.redact("driver rejected password abc"),
        "[redacted]"
    );
    assert_eq!(redactor.redact("abc"), "[redacted]");
}

#[test]
fn every_short_length_is_protected() {
    for secret in ["a", "ab", "abc"] {
        let redactor = SecretRedactor::new([secret.to_string()]);
        let text = format!("login failed, password {secret}, try again");
        assert_eq!(redactor.redact(&text), "[redacted]", "{secret}");
    }
}

#[test]
fn text_without_a_short_secret_is_untouched() {
    let redactor = SecretRedactor::new(["abc".to_string()]);
    assert_eq!(redactor.redact("connection refused"), "connection refused");
}

#[test]
fn a_four_character_secret_is_still_replaced_in_place() {
    let redactor = SecretRedactor::new(["root".to_string()]);
    assert_eq!(
        redactor.redact("access denied for root at host"),
        "access denied for [redacted] at host"
    );
}

#[test]
fn empty_and_whitespace_only_values_are_not_tracked() {
    let redactor = SecretRedactor::new([String::new(), " ".to_string(), "  \t".to_string()]);
    assert!(redactor.is_empty());
    assert_eq!(redactor.redact("a plain message"), "a plain message");
}

#[test]
fn short_secrets_are_replaced_whole_inside_json_values_and_keys() {
    let redactor = SecretRedactor::new(["abc".to_string()]);
    let mut value = json!({
        "error": "bad login abc",
        "nested": [{"cause": "abc"}, "fine", 123, true, null],
        "abc": "key",
        "abcd": "second key",
        "ok": "no secret here",
    });
    redactor.redact_value(&mut value);
    let text = value.to_string();
    assert!(!text.contains("abc"), "{text}");
    assert_eq!(value["error"], "[redacted]");
    assert_eq!(value["nested"][0]["cause"], "[redacted]");
    assert_eq!(value["nested"][1], "fine");
    assert_eq!(value["nested"][2], 123);
    assert_eq!(value["ok"], "no secret here");
    // Both colliding keys survive.
    assert_eq!(value.as_object().unwrap().len(), 5);
}

#[test]
fn short_and_long_secrets_work_together() {
    let redactor = SecretRedactor::new(["abc".to_string(), "long-secret-9".to_string()]);
    assert_eq!(
        redactor.redact("saw long-secret-9 only"),
        "saw [redacted] only"
    );
    assert_eq!(redactor.redact("saw abc and long-secret-9"), "[redacted]");
}

#[test]
fn replace_swaps_the_secrets() {
    let redactor = SecretRedactor::new(["old-secret".to_string()]);
    redactor.replace(["new-secret".to_string()]);
    assert_eq!(
        redactor.redact("old-secret new-secret"),
        "old-secret [redacted]"
    );
}

#[test]
fn clones_share_the_same_secrets() {
    let redactor = SecretRedactor::default();
    let clone = redactor.clone();
    redactor.replace(["shared-secret".to_string()]);
    assert_eq!(clone.redact("shared-secret"), "[redacted]");
}

#[test]
fn redacts_nested_json_strings_and_keys() {
    let redactor = SecretRedactor::new(["hunter22!".to_string()]);
    let mut value = json!({
        "message": "bad login hunter22!",
        "details": [{"cause": "hunter22!"}, 7, null, true],
        "hunter22!": "key",
    });
    redactor.redact_value(&mut value);
    assert_eq!(
        value,
        json!({
            "message": "bad login [redacted]",
            "details": [{"cause": "[redacted]"}, 7, null, true],
            "[redacted]": "key",
        })
    );
}

#[test]
fn short_secret_detection_matches_the_substring_threshold() {
    assert!(is_short_secret("abc"));
    assert!(!is_short_secret("abcd"));
}
