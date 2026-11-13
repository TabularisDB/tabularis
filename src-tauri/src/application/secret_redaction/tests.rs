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
fn ignores_values_too_short_to_scrub_safely() {
    let redactor = SecretRedactor::new(["a".to_string(), "ab".to_string(), "abc".to_string()]);
    assert!(redactor.is_empty());
    assert_eq!(redactor.redact("abc"), "abc");
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
